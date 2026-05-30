// Franklin Canvas self-contained backend.
//
// Wallet, x402 payment, and image / music / video generation all run in this
// process via the @blockrun/llm SDK. The wallet file lives under
// ~/.blockrun/ (shared with Franklin if both are installed).
//
// Endpoints:
//   GET  /api/wallet                — balance + recent spend
//   GET  /api/wallet/transactions   — spend log
//   GET  /api/sessions              — (empty; canvas doesn't persist sessions)
//   POST /api/generate              — { kind, prompt, model?, durationS?, lyrics?, instrumental?, imageUrl? }
//   GET  /api/generated/<file>      — serves a generated file from ~/.franklin/web-jobs/
//   GET  /api/prompts               — scraped prompt library
//   GET  /api/health

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import {
  LLMClient,
  ImageClient,
  MusicClient,
  SolanaLLMClient,
  loadWallet,
  loadSolanaWallet,
  getWalletAddress,
  solanaPublicKey,
  getCostLogSummary,
  parsePaymentRequired,
  extractPaymentDetails,
  createPaymentPayload,
} from '@blockrun/llm';

const PORT = 3100;
const apiUrl = process.env.BLOCKRUN_API_URL || undefined;
// Gateway origin for the manual x402 video submit+poll flow.
const GATEWAY = process.env.BLOCKRUN_API_URL || 'https://blockrun.ai/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOBS_DIR = path.join(os.homedir(), '.franklin', 'web-jobs');
fs.mkdirSync(JOBS_DIR, { recursive: true });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function json(res, body, status = 200) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Resolve the wallet private key from ~/.blockrun (or env). The server boots
// even if no wallet is configured yet — generation calls just error.
function getWallet() {
  try {
    // loadWallet() returns the private-key string (or null); the address comes
    // from getWalletAddress().
    const privateKey = process.env.BLOCKRUN_WALLET_KEY || loadWallet() || null;
    let address = '';
    try { address = getWalletAddress() || ''; } catch { /* ignore */ }
    return { privateKey, address };
  } catch {
    return { privateKey: null, address: '' };
  }
}

// Solana wallet companion. Returns the bs58-encoded secret key + the base58
// public-key derived from it. SDK loads from ~/.blockrun/solana-wallet (or
// SOLANA_WALLET_KEY env). Address derivation is async because
// solanaPublicKey() needs @solana/web3.js, so we await it at call site.
async function getSolanaWallet() {
  try {
    const privateKey = process.env.SOLANA_WALLET_KEY || loadSolanaWallet() || null;
    let address = '';
    if (privateKey) {
      try { address = await solanaPublicKey(privateKey); } catch { /* ignore */ }
    }
    return { privateKey, address };
  } catch {
    return { privateKey: null, address: '' };
  }
}

const MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
};

// Download a remote URL to disk under JOBS_DIR/<base>.<ext>, streaming so a
// big video doesn't park in memory. Returns { ext }.
async function downloadTo(url, basePath, fallbackExt) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
  const ext = MIME[ct] || fallbackExt || 'bin';
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(`${basePath}.${ext}`, buf);
  return { ext };
}

// @blockrun/llm 2.x only logs cost_log entries from LLMClient. Image / video /
// music spend is mirrored here so getCostLogSummary() sees every kind.
const SHARED_COST_LOG = path.join(os.homedir(), '.blockrun', 'cost_log.jsonl');
function appendCostLog({ endpoint, costUsd, model, wallet, kind }) {
  try {
    fs.mkdirSync(path.dirname(SHARED_COST_LOG), { recursive: true });
    fs.appendFileSync(SHARED_COST_LOG, JSON.stringify({
      ts: Date.now(),
      endpoint,
      cost_usd: costUsd,
      model,
      wallet,
      client_kind: kind,
    }) + '\n');
  } catch { /* ignore */ }
}

function diffSpend(before, after) {
  const b = before?.totalUsd ?? before?.usd ?? 0;
  const a = after?.totalUsd ?? after?.usd ?? 0;
  return Math.max(0, a - b);
}

async function generateImage(body, jobId) {
  const { privateKey } = await getWallet();
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BLOCKRUN_WALLET_KEY.');
  const client = new ImageClient({ privateKey, apiUrl });
  const opts = { model: body.model || 'google/nano-banana' };
  if (body.size) opts.size = body.size;
  const before = client.getSpending?.();
  const result = body.imageUrl
    ? await client.edit(body.prompt, body.imageUrl, opts)
    : await client.generate(body.prompt, opts);
  const after = client.getSpending?.();
  const remoteUrl = result?.data?.[0]?.url;
  if (!remoteUrl) throw new Error('Image gateway returned no URL');
  const { ext } = await downloadTo(remoteUrl, path.join(JOBS_DIR, jobId), 'png');
  const costUsd = diffSpend(before, after);
  appendCostLog({ endpoint: body.imageUrl ? '/v1/images/edits' : '/v1/images/generations', costUsd, model: opts.model, wallet: client.getWalletAddress?.(), kind: 'ImageClient' });
  return { resultUrl: `/api/generated/${jobId}.${ext}`, costUsd };
}

async function generateMusic(body, jobId) {
  const { privateKey } = await getWallet();
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BLOCKRUN_WALLET_KEY.');
  const client = new MusicClient({ privateKey, apiUrl });
  const opts = { model: body.model || 'minimax/music-2.5+' };
  if (body.durationS) opts.durationSeconds = body.durationS;
  if (body.lyrics) opts.lyrics = body.lyrics;
  if (typeof body.instrumental === 'boolean') opts.instrumental = body.instrumental;
  const before = client.getSpending?.();
  const result = await client.generate(body.prompt, opts);
  const after = client.getSpending?.();
  const remoteUrl = result?.data?.[0]?.url;
  if (!remoteUrl) throw new Error('Music gateway returned no URL');
  const { ext } = await downloadTo(remoteUrl, path.join(JOBS_DIR, jobId), 'mp3');
  const costUsd = diffSpend(before, after);
  appendCostLog({ endpoint: '/v1/audio/generations', costUsd, model: opts.model, wallet: client.getWalletAddress?.(), kind: 'MusicClient' });
  return { resultUrl: `/api/generated/${jobId}.${ext}`, costUsd };
}

// Sign an x402 payment-required response into a PAYMENT-SIGNATURE header.
async function signVideoPayment(response, endpoint, privateKey, address) {
  let header = response.headers.get('payment-required');
  if (!header) {
    try {
      const b = await response.clone().json();
      if (b.x402 || b.accepts) header = Buffer.from(JSON.stringify(b)).toString('base64');
    } catch { /* ignore */ }
  }
  if (!header) return null;
  const paymentRequired = parsePaymentRequired(header);
  const details = extractPaymentDetails(paymentRequired);
  const payload = await createPaymentPayload(
    privateKey, address, details.recipient, details.amount,
    details.network || 'eip155:8453',
    {
      resourceUrl: details.resource?.url || endpoint,
      resourceDescription: details.resource?.description || 'Franklin Canvas video',
      maxTimeoutSeconds: details.maxTimeoutSeconds || 60,
      extra: details.extra,
    },
  );
  return { 'PAYMENT-SIGNATURE': payload };
}

// Video uses async submit + poll. CRITICAL: the signed PAYMENT-SIGNATURE header
// from the 402 retry must be reused on EVERY poll GET — the gateway verifies
// identity on each poll and settles on the first completed response. (The SDK's
// VideoClient.generate auto-poll omits this header → "Poll failed: HTTP 402".)
async function generateVideo(body, jobId) {
  const { privateKey, address } = getWallet();
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BLOCKRUN_WALLET_KEY.');
  const model = body.model || 'bytedance/seedance-2.0';
  const endpoint = `${GATEWAY}/v1/videos/generations`;
  const reqBody = JSON.stringify({
    model,
    prompt: body.prompt,
    ...(body.imageUrl ? { image_url: body.imageUrl } : {}),
    ...(body.durationS ? { duration_seconds: body.durationS } : {}),
    ...(body.aspectRatio ? { aspect_ratio: body.aspectRatio } : {}),
    ...(body.resolution ? { resolution: body.resolution } : {}),
    ...(typeof body.generateAudio === 'boolean' ? { generate_audio: body.generateAudio } : {}),
  });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'franklin-canvas' };

  // Phase 1: submit (first POST → 402 → sign → retry with payment header).
  let resp = await fetch(endpoint, { method: 'POST', headers, body: reqBody });
  let paymentHeaders = null;
  if (resp.status === 402) {
    paymentHeaders = await signVideoPayment(resp, endpoint, privateKey, address);
    if (!paymentHeaders) throw new Error('Payment signing failed — check wallet balance.');
    resp = await fetch(endpoint, { method: 'POST', headers: { ...headers, ...paymentHeaders }, body: reqBody });
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Video submit failed (${resp.status}): ${t.slice(0, 300)}`);
  }
  const submit = await resp.json();
  if (!submit.poll_url || !paymentHeaders) {
    throw new Error(`No poll_url returned: ${JSON.stringify(submit).slice(0, 200)}`);
  }
  const origin = new URL(GATEWAY).origin;
  const pollUrl = submit.poll_url.startsWith('http') ? submit.poll_url : `${origin}${submit.poll_url}`;

  // Phase 2: poll until completion. The gateway returns 402 on the poll while
  // the job is still running (a settlement challenge that only resolves once
  // the result is ready) — so we treat 402 as "in progress", re-sign, and keep
  // polling. Settlement happens on the completed 200 response. (The SDK's
  // built-in poll throws on this 402, which is why we poll manually.)
  const startedAt = Date.now();
  const deadline = startedAt + 20 * 60 * 1000; // Seedance cinematic/pro can run long
  let remoteUrl;
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    const pr = await fetch(pollUrl, { headers: { ...headers, ...paymentHeaders } });
    let pj = {};
    if (pr.status === 200 || pr.status === 202) { pj = await pr.json().catch(() => ({})); }
    if (++polls % 3 === 0 || pr.status !== 202) {
      console.log(`[video poll #${polls}] http=${pr.status} status=${pj.status ?? '-'} t=${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
    if (pr.status === 200 || pr.status === 202) {
      if (pj.status === 'completed' && pj.data?.[0]?.url) { remoteUrl = pj.data[0].url; break; }
      if (pj.status === 'failed') throw new Error(`Video failed upstream: ${JSON.stringify(pj.error || '').slice(0, 200)}`);
      // queued / in_progress → keep polling
    } else if (pr.status === 402) {
      const re = await signVideoPayment(pr, endpoint, privateKey, address);
      if (re) paymentHeaders = re;
    } else if (pr.status === 429 || pr.status >= 500) {
      // transient → keep polling
    } else {
      const t = await pr.text().catch(() => '');
      throw new Error(`Poll failed (${pr.status}): ${t.slice(0, 200)}`);
    }
  }
  if (!remoteUrl) throw new Error('Video generation timed out (no completion within 10min). No payment settled.');
  const { ext } = await downloadTo(remoteUrl, path.join(JOBS_DIR, jobId), 'mp4');
  const costUsd = body.durationS ? body.durationS * 0.2 : 0; // estimate for the spend log
  appendCostLog({ endpoint: '/v1/videos/generations', costUsd, model, wallet: address, kind: 'VideoClient' });
  return { resultUrl: `/api/generated/${jobId}.${ext}`, costUsd };
}

// ── Prompt library ──
// Sourced from BlockRun's curated case library, which aggregates several
// public prompt repos into ~848 normalized cases (one markdown file each with
// frontmatter: title / workflow / model / tags + an "## Original prompt").
//
// The catalog (titles + metadata) lives in a single INDEX.md, fetched once.
// The full prompt body for a case is fetched on demand (when the user clicks
// "Use") so we never pull 848 files up front.
const CASE_LIB_BASE = 'https://raw.githubusercontent.com/BlockRunAI/Claude-Code-GPT-IMAGE2-SeeDance-BlockRun/main/prompts/case-library';
const PROMPT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let promptCache = { at: 0, items: [] };

// Parse INDEX.md lines like:
//   - [Title](from-repo/123.md) — image2image · openai/gpt-image-2 [tag1, tag2]
function parseIndex(md) {
  const items = [];
  const re = /^\s*-\s*\[(.+?)\]\((from-[^)]+\.md)\)\s*—\s*(\S+)\s*·\s*(\S+)\s*(?:\[(.*?)\])?/gm;
  let m;
  while ((m = re.exec(md))) {
    const [, title, path, workflow, model, tagStr] = m;
    const tags = (tagStr || '').split(',').map((t) => t.trim()).filter(Boolean);
    items.push({
      id: path,
      title: title.trim(),
      titleCn: '',
      category: tags[0] || workflow,
      workflow,
      model,
      tags,
      prompt: '',            // filled on demand via /api/prompts/detail
      image: '',
      path,
      needsRef: workflow === 'image2image' || workflow === 'image2video',
      source: 'blockrun-case-library',
    });
  }
  return items;
}

async function getPromptLibrary() {
  if (promptCache.items.length && Date.now() - promptCache.at < PROMPT_TTL_MS) {
    return promptCache.items;
  }
  const r = await fetch(`${CASE_LIB_BASE}/INDEX.md`, { headers: { 'user-agent': 'franklin-canvas' } });
  if (!r.ok) return promptCache.items;
  const md = await r.text();
  const items = parseIndex(md);
  if (items.length) promptCache = { at: Date.now(), items };
  return items;
}

// Replace {argument name="..." default="VALUE"} (quotes may be JSON-escaped
// as \") with VALUE; drop any argument tag that has no default.
function resolveArguments(text) {
  let out = text;
  // with default
  out = out.replace(/\{\s*argument\b[^}]*?default=\\?"((?:[^"\\]|\\.)*?)\\?"[^}]*?\}/g, (_, v) => v.replace(/\\"/g, '"'));
  // leftover argument tags without a default → remove
  out = out.replace(/\{\s*argument\b[^}]*?\}/g, '');
  return out;
}

// Fetch + parse a single case file: pull the prompt body and a preview image.
async function getPromptDetail(relPath) {
  if (!relPath || relPath.includes('..') || !relPath.startsWith('from-')) {
    throw new Error('bad path');
  }
  const r = await fetch(`${CASE_LIB_BASE}/${relPath}`, { headers: { 'user-agent': 'franklin-canvas' } });
  if (!r.ok) throw new Error(`case ${r.status}`);
  const raw = await r.text();
  // Split frontmatter (between the first pair of --- lines) from the body.
  let body = raw;
  let fmImage = '';
  let title = '';
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fm) {
    body = fm[2];
    const t = fm[1].match(/^title:\s*"?(.+?)"?\s*$/m);
    if (t) title = t[1];
    const u = fm[1].match(/url:\s*"?(https?:\/\/[^"\s]+)"?/);
    if (u) fmImage = u[1];
  }
  // Image: prefer a markdown image in the body, else the frontmatter asset.
  const imgM = body.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
  const image = imgM ? imgM[1] : fmImage;
  // Prompt: the text after "## Original prompt" / "## Prompt", else the body
  // with images/headings stripped.
  let prompt = '';
  const ph = body.split(/##\s*(?:Original\s+prompt|Prompt|提示词)\s*\n/i);
  let seg = ph.length > 1 ? ph[1] : body;
  // The prompt ends at the next section heading (e.g. "## Run via Claude Code",
  // "## Credit & license") — cut there so the footer/attribution isn't included.
  seg = seg.split(/\n#{2,4}\s/)[0];
  prompt = seg
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // drop images
    .replace(/^#+\s.*$/gm, '')               // drop headings
    .replace(/```[a-z]*\n?/gi, '')           // unwrap fenced blocks
    .trim();
  // Resolve template placeholders {argument name="x" default="y"} → "y" so the
  // prompt reads as plain text instead of showing the raw template/JSON.
  prompt = resolveArguments(prompt);
  return { title, prompt, image };
}

// ── HTTP routing ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const p = (req.url || '').split('?')[0];

  try {
    if (p === '/api/wallet' && req.method === 'GET') {
      // Optional ?chain=base|solana — defaults to base. Spend history is
      // shared across chains (it lives in the BlockRun cost log) and isn't
      // chain-tagged, so both branches return the same recent/total/byModel
      // figures — only the wallet address + on-chain balance differ.
      const url = new URL(req.url, 'http://localhost');
      const chain = (url.searchParams.get('chain') || 'base').toLowerCase() === 'solana' ? 'solana' : 'base';
      try {
        const wallet = chain === 'solana' ? await getSolanaWallet() : getWallet();
        const { address, privateKey } = wallet;
        let balanceUsdc = 0;
        let recentSpendUsd = 0;   // true rolling 24h
        let totalSpendUsd = 0;    // all-time
        let spendByCategory = [];
        try {
          // Compute spend directly from the shared cost log so "24h" is really
          // 24h (getCostLogSummary returns an all-time total). Timestamps are
          // seconds (SDK) or ms (us); normalize to ms.
          if (fs.existsSync(SHARED_COST_LOG)) {
            const now = Date.now();
            const byModel = new Map();
            for (const line of fs.readFileSync(SHARED_COST_LOG, 'utf8').split('\n')) {
              if (!line.trim()) continue;
              let e; try { e = JSON.parse(line); } catch { continue; }
              const cost = Number(e.cost_usd) || 0;
              let ts = Number(e.ts) || 0;
              if (ts > 0 && ts < 1e12) ts *= 1000;
              totalSpendUsd += cost;
              if (ts && now - ts <= 24 * 60 * 60 * 1000) recentSpendUsd += cost;
              const m = e.model || 'unknown';
              byModel.set(m, (byModel.get(m) || 0) + cost);
            }
            spendByCategory = [...byModel.entries()]
              .map(([category, usd]) => ({ category, usd }))
              .sort((a, b) => b.usd - a.usd);
          }
        } catch { /* ignore */ }
        try {
          if (privateKey) {
            // getBalance() lives on both LLMClient (Base) and SolanaLLMClient
            // (Solana) and resolves to a USDC float.
            const c = chain === 'solana'
              ? new SolanaLLMClient({ privateKey })
              : new LLMClient({ privateKey, apiUrl });
            const bal = await c.getBalance();
            if (typeof bal === 'number') balanceUsdc = bal;
          }
        } catch { /* ignore — show 0 if balance lookup fails */ }
        const network = chain === 'solana' ? 'Solana' : 'Base';
        return json(res, { address, balanceUsdc, recentSpendUsd, totalSpendUsd, network, chain, spendByCategory });
      } catch (err) {
        const network = chain === 'solana' ? 'Solana' : 'Base';
        return json(res, { address: '', balanceUsdc: 0, recentSpendUsd: 0, totalSpendUsd: 0, network, chain, spendByCategory: [], error: String(err) });
      }
    }

    if (p === '/api/wallet/transactions' && req.method === 'GET') {
      try {
        const logPath = SHARED_COST_LOG;
        if (!fs.existsSync(logPath)) return json(res, []);
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
        const txs = lines
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean)
          // The cost log is SHARED across all BlockRun tools. Show generations
          // (image/video/music) AND language-model calls (/v1/messages, /v1/chat).
          .filter((e) => /\/(images|videos|audio)\/|\/(messages|chat)/.test(e.endpoint || ''))
          .map((e, i) => {
            // Normalize timestamps: SDK logs seconds (float), we log ms. Anything
            // below 1e12 is seconds → ×1000.
            const rawTs = Number(e.ts) || 0;
            const tsMs = rawTs > 0 ? (rawTs < 1e12 ? Math.round(rawTs * 1000) : rawTs) : Date.now();
            const ep = e.endpoint || '';
            const kind = ep.includes('/videos/') ? 'Video'
                       : ep.includes('/images/') ? 'Image'
                       : ep.includes('/audio/') ? 'Music'
                       : /\/(messages|chat)/.test(ep) ? 'Text' : 'Generation';
            return {
              id: `${rawTs}-${i}`,
              ts: tsMs,
              type: 'spend',
              amountUsd: e.cost_usd ?? 0,
              description: `${kind} · ${e.model || ''}`.trim().replace(/·\s*$/, '').trim(),
              model: e.model,
            };
          })
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 100);
        return json(res, txs);
      } catch {
        return json(res, []);
      }
    }

    if (p === '/api/sessions' && req.method === 'GET') {
      return json(res, []);
    }

    if (p === '/api/generate' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      if (!body.prompt) return json(res, { ok: false, error: 'prompt required' }, 400);
      if (!['image', 'video', 'music'].includes(body.kind)) {
        return json(res, { ok: false, error: 'kind must be image|video|music' }, 400);
      }
      const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const t0 = Date.now();
      try {
        const result = body.kind === 'image' ? await generateImage(body, jobId)
                     : body.kind === 'music' ? await generateMusic(body, jobId)
                     : await generateVideo(body, jobId);
        const ms = Date.now() - t0;
        const cost = result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '?';
        console.log(`[generate] ${body.kind} ${body.model || 'default'} ok ${ms}ms ${cost}`);
        return json(res, { ok: true, ...result });
      } catch (err) {
        const ms = Date.now() - t0;
        console.warn(`[generate] ${body.kind} ${body.model || 'default'} FAIL ${ms}ms: ${err.message || err}`);
        return json(res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    if (p === '/api/health' && req.method === 'GET') {
      return json(res, { ok: true });
    }

    if (p === '/api/prompts' && req.method === 'GET') {
      try {
        const items = await getPromptLibrary();
        return json(res, { ok: true, items });
      } catch (err) {
        return json(res, { ok: false, error: err.message || String(err), items: [] }, 502);
      }
    }

    if (p === '/api/prompts/detail' && req.method === 'GET') {
      try {
        const relPath = new URL(req.url, 'http://x').searchParams.get('path') || '';
        const detail = await getPromptDetail(relPath);
        return json(res, { ok: true, ...detail });
      } catch (err) {
        return json(res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    if (p.startsWith('/api/generated/') && req.method === 'GET') {
      const filename = path.basename(p.slice('/api/generated/'.length));
      if (!filename || filename.startsWith('.') || filename.includes('/')) {
        res.writeHead(400); res.end('Bad filename'); return;
      }
      const filePath = path.join(JOBS_DIR, filename);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filename).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png'
                : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                : ext === 'webp' ? 'image/webp'
                : ext === 'mp4' ? 'video/mp4'
                : ext === 'mp3' ? 'audio/mpeg'
                : 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': fs.statSync(filePath).size,
        ...cors,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Chat stream — kept as a stub so the Chat view doesn't blow up.
    if (p === '/api/chat/stream' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors });
      res.write(`data: ${JSON.stringify({ type: 'token', token: 'Chat streaming is not wired in this build.' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', model: 'none', costUsd: 0 })}\n\n`);
      res.end();
      return;
    }

    res.writeHead(404, cors); res.end('Not found');
  } catch (err) {
    json(res, { ok: false, error: String(err) }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Franklin Canvas backend on http://127.0.0.1:${PORT}`);
  console.log('  GET  /api/wallet');
  console.log('  GET  /api/wallet/transactions');
  console.log('  GET  /api/sessions');
  console.log('  POST /api/generate');
  console.log('  GET  /api/generated/<file>');
  console.log('  GET  /api/prompts');
});
