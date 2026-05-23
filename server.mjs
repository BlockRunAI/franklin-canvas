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
  VideoClient,
  loadWallet,
  getWalletAddress,
  getCostLogSummary,
} from '@blockrun/llm';

const PORT = 3100;
const apiUrl = process.env.BLOCKRUN_API_URL || undefined;
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

async function generateVideo(body, jobId) {
  const { privateKey } = await getWallet();
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BLOCKRUN_WALLET_KEY.');
  // Bump the SDK polling budget — Seedance 2.0 frequently exceeds 5min during
  // peak; the SDK doesn't take payment when it gives up, so a longer wait is free.
  const client = new VideoClient({ privateKey, timeout: 10 * 60 * 1000, apiUrl });
  const opts = { model: body.model || 'bytedance/seedance-2.0', budgetMs: 10 * 60 * 1000 };
  if (body.imageUrl) opts.imageUrl = body.imageUrl;
  if (body.durationS) opts.durationSeconds = body.durationS;
  if (body.aspectRatio) opts.aspectRatio = body.aspectRatio;
  if (body.resolution) opts.resolution = body.resolution;
  opts.generateAudio = typeof body.generateAudio === 'boolean' ? body.generateAudio : true;
  if (typeof body.seed === 'number') opts.seed = body.seed;
  if (typeof body.watermark === 'boolean') opts.watermark = body.watermark;
  if (body.returnLastFrame) opts.returnLastFrame = true;
  const before = client.getSpending?.();
  const result = await client.generate(body.prompt, opts);
  const after = client.getSpending?.();
  const remoteUrl = result?.data?.[0]?.url;
  if (!remoteUrl) throw new Error('Video gateway returned no URL');
  const { ext } = await downloadTo(remoteUrl, path.join(JOBS_DIR, jobId), 'mp4');
  const costUsd = diffSpend(before, after);
  appendCostLog({ endpoint: '/v1/videos/generations', costUsd, model: opts.model, wallet: client.getWalletAddress?.(), kind: 'VideoClient' });
  return { resultUrl: `/api/generated/${jobId}.${ext}`, costUsd };
}

// ── Prompt library (scraped from public GitHub "awesome prompts" repos) ──
const PROMPT_SOURCES = [
  {
    id: 'gpt-image2',
    url: 'https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main/prompts.json',
    imageBase: 'https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main',
  },
];
const PROMPT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let promptCache = { at: 0, items: [] };

function absImage(base, img) {
  if (!img) return '';
  if (/^https?:\/\//.test(img)) return img;
  return `${base}/${String(img).replace(/^\.?\//, '')}`;
}

async function getPromptLibrary() {
  if (promptCache.items.length && Date.now() - promptCache.at < PROMPT_TTL_MS) {
    return promptCache.items;
  }
  const all = [];
  for (const src of PROMPT_SOURCES) {
    try {
      const r = await fetch(src.url, { headers: { 'user-agent': 'franklin-canvas' } });
      if (!r.ok) continue;
      const data = await r.json();
      const list = Array.isArray(data) ? data : data.prompts || data.records || [];
      for (const it of list) {
        const prompt = it.prompt || it.content || '';
        if (!prompt) continue;
        all.push({
          id: `${src.id}-${it.id ?? all.length}`,
          title: it.title_en || it.title || it.title_cn || 'Untitled',
          titleCn: it.title_cn || '',
          category: it.category_cn || it.category || 'general',
          prompt,
          image: absImage(src.imageBase, it.image),
          needsRef: !!it.needs_ref,
          source: src.id,
        });
      }
    } catch { /* skip a failed source, keep the rest */ }
  }
  if (all.length) promptCache = { at: Date.now(), items: all };
  return all.length ? all : promptCache.items;
}

// ── HTTP routing ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const p = (req.url || '').split('?')[0];

  try {
    if (p === '/api/wallet' && req.method === 'GET') {
      try {
        const { address, privateKey } = getWallet();
        let balanceUsdc = 0;
        let recentSpendUsd = 0;
        let spendByCategory = [];
        try {
          const summary = await getCostLogSummary?.();
          if (summary) {
            recentSpendUsd = summary.totalUsd ?? summary.total_usd ?? summary.spend_24h ?? 0;
            const byModel = summary.byModel || summary.by_model || summary.spend_by_category || {};
            spendByCategory = Array.isArray(byModel)
              ? byModel
              : Object.entries(byModel).map(([category, usd]) => ({ category, usd: Number(usd) }));
          }
        } catch { /* ignore */ }
        try {
          if (privateKey) {
            // getBalance() lives on LLMClient and resolves to a USDC float.
            const c = new LLMClient({ privateKey, apiUrl });
            const bal = await c.getBalance();
            if (typeof bal === 'number') balanceUsdc = bal;
          }
        } catch { /* ignore — show 0 if balance lookup fails */ }
        return json(res, { address, balanceUsdc, recentSpendUsd, network: 'Base', spendByCategory });
      } catch (err) {
        return json(res, { address: '', balanceUsdc: 0, recentSpendUsd: 0, network: 'Base', spendByCategory: [], error: String(err) });
      }
    }

    if (p === '/api/wallet/transactions' && req.method === 'GET') {
      try {
        const logPath = SHARED_COST_LOG;
        if (!fs.existsSync(logPath)) return json(res, []);
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
        const txs = lines.slice(-100).map((l, i) => {
          const e = JSON.parse(l);
          return {
            id: String(e.ts ?? i),
            ts: e.ts ?? Date.now(),
            type: 'spend',
            amountUsd: e.cost_usd ?? 0,
            description: e.endpoint || e.client_kind || 'spend',
            model: e.model,
          };
        }).reverse();
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
