// Franklin Canvas self-contained backend.
//
// Wallet, x402 payment, and image / music / video generation all run in this
// process via the @blockrun/llm SDK. The wallet file lives under
// ~/.blockrun/ (shared with Franklin if both are installed).
//
// Endpoints:
//   GET  /api/wallet?chain=base|solana   — address, USDC balance, spend
//   GET  /api/wallet/transactions        — per-call spend log
//   POST /api/generate                   — { kind, prompt, model?, durationS?, lyrics?, instrumental?, imageUrl?, aspectRatio?, resolution?, generateAudio? }
//   GET  /api/generated/<file>           — serves a generated file from ~/.franklin/web-jobs/
//   GET  /api/prompts                    — open prompt library index
//   GET  /api/prompts/detail?path=…      — single prompt body + cover image
//   GET  /api/health

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  LLMClient,
  ImageClient,
  MusicClient,
  SolanaLLMClient,
  getOrCreateWallet,
  getOrCreateSolanaWallet,
  getCostLogSummary,
  parsePaymentRequired,
  extractPaymentDetails,
  createPaymentPayload,
} from '@blockrun/llm';
import { runAgentChat, runBackendTool, describeMedia, summarizeConversation, CANVAS_TOOL_NAMES } from './agent-tools.mjs';

const PORT = 3100;
const apiUrl = process.env.BLOCKRUN_API_URL || undefined;
// Gateway origin for the manual x402 video submit+poll flow.
const GATEWAY = process.env.BLOCKRUN_API_URL || 'https://blockrun.ai/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOBS_DIR = path.join(os.homedir(), '.franklin', 'web-jobs');
fs.mkdirSync(JOBS_DIR, { recursive: true });
// On-disk project files: each canvas (nodes+edges) is one JSON file on disk,
// so projects are portable / version-controllable / editable outside the browser.
const PROJECTS_DIR = path.join(os.homedir(), '.franklin', 'projects');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// CORS — wide open in dev so any Vite port can talk to :3100. In production,
// set ALLOWED_ORIGINS to a comma-separated list of origins (or "*" if you
// really mean any). Anything not in the list is rejected.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : null; // null => dev mode, allow any
function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allow = ALLOWED_ORIGINS === null
    ? '*'
    : (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin : '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}

function json(req, res, body, status = 200) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
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

// Wallet helpers — Franklin-style. getOrCreateWallet() reads the SDK file
// (~/.blockrun/wallet) if it exists, otherwise mints a new EVM wallet on
// the spot and writes it to disk. Same file Franklin core uses, so the two
// products share one wallet per machine. New users skip the "go install
// Franklin first" step entirely; they just need to fund the auto-generated
// address with USDC on Base to start generating.
//
// `isNew` lets the UI tell the user "we just created this for you" the
// first time, so they know where to send funds.
function getWallet() {
  try {
    const w = getOrCreateWallet();
    return { privateKey: w.privateKey, address: w.address, isNew: !!w.isNew };
  } catch {
    return { privateKey: null, address: '', isNew: false };
  }
}

// Solana version of the same auto-create flow. Async because the underlying
// @solana/web3.js helpers are lazy-loaded.
async function getSolanaWallet() {
  try {
    const w = await getOrCreateSolanaWallet();
    return { privateKey: w.privateKey, address: w.address, isNew: !!w.isNew };
  } catch {
    return { privateKey: null, address: '', isNew: false };
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
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BASE_CHAIN_WALLET_KEY.');
  const client = new ImageClient({ privateKey, apiUrl });
  const opts = { model: body.model || 'google/nano-banana' };
  // Map the node's aspect ratio to an output size, and pass quality through.
  const IMG_SIZE = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1024x768', '3:4': '768x1024' };
  if (body.aspectRatio && IMG_SIZE[body.aspectRatio]) opts.size = IMG_SIZE[body.aspectRatio];
  if (body.quality === 'standard' || body.quality === 'hd') opts.quality = body.quality;
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
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BASE_CHAIN_WALLET_KEY.');
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
  const phaseT0 = Date.now();
  const phase = {}; // submitMs / firstQueuedMs / firstProgressMs / completedMs / downloadMs
  const { privateKey, address } = getWallet();
  if (!privateKey) throw new Error('No wallet found. Run `franklin wallet init` or set BASE_CHAIN_WALLET_KEY.');
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
  phase.submitMs = startedAt - phaseT0;
  const deadline = startedAt + 20 * 60 * 1000; // Seedance cinematic/pro can run long
  let remoteUrl;
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    const pr = await fetch(pollUrl, { headers: { ...headers, ...paymentHeaders } });
    let pj = {};
    if (pr.status === 200 || pr.status === 202) { pj = await pr.json().catch(() => ({})); }
    if (pj.status === 'queued' && phase.firstQueuedMs == null) phase.firstQueuedMs = Date.now() - phaseT0;
    if (pj.status === 'in_progress' && phase.firstProgressMs == null) phase.firstProgressMs = Date.now() - phaseT0;
    if (++polls % 3 === 0 || pr.status !== 202) {
      console.log(`[video poll #${polls}] http=${pr.status} status=${pj.status ?? '-'} t=${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
    if (pr.status === 200 || pr.status === 202) {
      if (pj.status === 'completed' && pj.data?.[0]?.url) { remoteUrl = pj.data[0].url; phase.completedMs = Date.now() - phaseT0; break; }
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
  const logPhases = (note) => {
    try {
      const f = path.join(os.homedir(), '.franklin', 'video-debug.log');
      fs.appendFileSync(f, `[${new Date().toISOString()}] ${model} i2v=${body.imageUrl ? 'Y' : 'N'} dur=${body.durationS ?? '-'} polls=${polls} :: submit=${(phase.submitMs ?? 0) / 1000 | 0}s queued@${phase.firstQueuedMs != null ? (phase.firstQueuedMs / 1000 | 0) + 's' : '-'} progress@${phase.firstProgressMs != null ? (phase.firstProgressMs / 1000 | 0) + 's' : '-'} completed@${phase.completedMs != null ? (phase.completedMs / 1000 | 0) + 's' : '-'} total=${(Date.now() - phaseT0) / 1000 | 0}s :: ${note}\n`);
    } catch { /* ignore */ }
  };
  if (!remoteUrl) { logPhases('TIMEOUT/no-completion'); throw new Error('Video generation timed out (no completion within 20min). No payment settled.'); }
  const dlStart = Date.now();
  const { ext } = await downloadTo(remoteUrl, path.join(JOBS_DIR, jobId), 'mp4');
  phase.downloadMs = Date.now() - dlStart;
  logPhases(`OK download=${(phase.downloadMs / 1000) | 0}s`);
  const costUsd = body.durationS ? body.durationS * 0.2 : 0; // estimate for the spend log
  appendCostLog({ endpoint: '/v1/videos/generations', costUsd, model, wallet: address, kind: 'VideoClient' });
  return { resultUrl: `/api/generated/${jobId}.${ext}`, costUsd };
}

// ── Prompt library ──
// Sourced from BlockRun's Prompt-Case-Hub, which aggregates several public prompt
// repos into ~848 cases in one unified format (each case = one markdown file with
// YAML front-matter + a fenced ```prompt body; see the hub's FORMAT.md).
//
// The catalog (titles + metadata) lives in cases/index.json, fetched once. The
// full prompt body for a case is fetched on demand (when the user clicks "Use")
// so we never pull 848 files up front.
const CASE_LIB_BASE = 'https://raw.githubusercontent.com/BlockRunAI/Prompt-Case-Hub/main';
const PROMPT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let promptCache = { at: 0, items: [] };

// Map a Prompt-Case-Hub index.json entry → the PromptItem shape the frontend
// expects. The index is denormalized (modality/workflow/reference_images/model/
// preview) so we can build the whole catalog without fetching any case body.
function indexEntryToItem(c) {
  const tags = Array.isArray(c.tags) ? c.tags : [];
  return {
    id: c.id,
    title: c.title,
    titleCn: '',
    category: tags[0] || c.workflow,
    workflow: c.workflow,
    model: c.model || '',
    tags,
    prompt: '',              // filled on demand via /api/prompts/detail
    image: c.preview || '',
    path: c.file,            // e.g. "cases/awesome-gpt-image-2-4.md"
    needsRef: (c.reference_images || 0) > 0,
    source: 'prompt-case-hub',
  };
}

async function getPromptLibrary() {
  if (promptCache.items.length && Date.now() - promptCache.at < PROMPT_TTL_MS) {
    return promptCache.items;
  }
  const r = await fetch(`${CASE_LIB_BASE}/cases/index.json`, { headers: { 'user-agent': 'franklin-canvas' } });
  if (!r.ok) return promptCache.items;
  const data = await r.json();
  const items = (data.cases || []).map(indexEntryToItem);
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

// Fetch + parse a single unified-format case file: pull the fenced `prompt`
// body and a preview image. Files live under cases/ in Prompt-Case-Hub.
async function getPromptDetail(relPath) {
  if (!relPath || relPath.includes('..') || !relPath.startsWith('cases/') || !relPath.endsWith('.md')) {
    throw new Error('bad path');
  }
  const r = await fetch(`${CASE_LIB_BASE}/${relPath}`, { headers: { 'user-agent': 'franklin-canvas' } });
  if (!r.ok) throw new Error(`case ${r.status}`);
  const raw = await r.text();
  // Front-matter: title + preview image.
  let title = '';
  let image = '';
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    const t = fm[1].match(/^title:\s*"?(.+?)"?\s*$/m);
    if (t) title = t[1];
    const pv = fm[1].match(/^preview:\s*"?(https?:\/\/[^"\s]+)"?/m);
    if (pv) image = pv[1];
  }
  if (!image) {
    const imgM = raw.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (imgM) image = imgM[1];
  }
  // Prompt: the fenced ```prompt block. The fence can be 3+ backticks (longer
  // when the prompt itself contains ```), so capture the opening run and match
  // the same run as the close.
  const pm = raw.match(/^(`{3,})prompt[ \t]*\n([\s\S]*?)\n\1[ \t]*$/m);
  let prompt = pm ? pm[2] : '';
  // Resolve any residual {argument name="x" default="y"} → "y" (cases are
  // pre-resolved at migration, but keep this defensive for new imports).
  prompt = resolveArguments(prompt).trim();
  return { title, prompt, image };
}

// ── Comparison stitch (ffmpeg) ──
// Composite N model videos into one grid MP4 with per-cell labels. Label PNGs
// are rendered by the browser (proper fonts, no backend font deps) and passed
// in as data: URLs. Layouts: 2→1×2, 3→1×3, 4→2×2, 5→2×3 (last cell black).
// Cell at 960×540 keeps each clip near its source 720p (2×2 → 1080p output)
// instead of the old 640×360 quarter-res cells.
const CMP_CELL_W = 960;
const CMP_CELL_H = 540;
const CMP_LAYOUTS = { 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2] };

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.slice(-500)))));
  });
}

// Map a /api/generated/<file> URL to its local path; remote URLs return null
// (the caller downloads them into the temp dir).
function localGeneratedPath(url) {
  if (typeof url !== 'string') throw new Error('bad video url');
  if (url.startsWith('/api/generated/')) {
    const f = path.basename(url.slice('/api/generated/'.length).split('?')[0]);
    const fp = path.join(JOBS_DIR, f);
    if (!fs.existsSync(fp)) throw new Error('source video not found');
    return fp;
  }
  return null;
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const pp = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    pp.stdout.on('data', (d) => { out += d.toString(); });
    pp.on('close', () => resolve(parseFloat(out) || 0));
    pp.on('error', () => resolve(0));
  });
}

function probeHasAudio(file) {
  return new Promise((resolve) => {
    const pp = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    let out = '';
    pp.stdout.on('data', (d) => { out += d.toString(); });
    pp.on('close', () => resolve(out.trim().length > 0));
    pp.on('error', () => resolve(false));
  });
}

function probeDimensions(file) {
  return new Promise((resolve) => {
    const pp = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
    let out = '';
    pp.stdout.on('data', (d) => { out += d.toString(); });
    pp.on('close', () => { const [w, h] = out.trim().split(',').map(Number); resolve({ w: w || 0, h: h || 0 }); });
    pp.on('error', () => resolve({ w: 0, h: 0 }));
  });
}

// mode 'grid' (default): all cells play simultaneously.
// mode 'sequence': cells play one at a time in order — the active cell plays
// while the others hold a frozen frame (first frame before their turn, last
// frame after) — the classic side-by-side model-comparison reel.
async function stitchComparison(items, mode = 'grid', orientation = 'landscape', labelPos = { x: 0.02, y: 0.03 }) {
  const n = items.length;
  if (n < 2 || n > 5) throw new Error('need 2–5 videos');
  // landscape → grid (2×2 etc); portrait → single column stacked top-to-bottom
  // for a TikTok-style reel.
  const portrait = orientation === 'portrait';
  const cols = portrait ? 1 : CMP_LAYOUTS[n][0];
  const rows = portrait ? n : CMP_LAYOUTS[n][1];
  // Portrait fits the stack into a 9:16 phone frame (720×1280): each clip gets
  // a 1280/N-tall band (letterboxed) so the whole thing stays phone-shaped
  // instead of growing endlessly long. Landscape uses the 640×360 grid cell.
  // Dimensions must be even for yuv420p/libx264.
  // Portrait fills a 1080×1920 phone frame; each clip gets a 1920/N band.
  const cellW = portrait ? 1080 : CMP_CELL_W;
  const cellH = portrait ? (Math.round(1920 / n) - (Math.round(1920 / n) % 2)) : CMP_CELL_H;
  const jobId = `cmp_${crypto.randomUUID()}`;
  const tmp = path.join(JOBS_DIR, jobId + '_tmp');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // Resolve videos to local files (download remotes); write label PNGs.
    const videoPaths = [];
    const labelPaths = [];
    for (let i = 0; i < n; i++) {
      const it = items[i] || {};
      let vp = localGeneratedPath(it.url);
      if (!vp) { const { ext } = await downloadTo(it.url, path.join(tmp, `v${i}`), 'mp4'); vp = path.join(tmp, `v${i}.${ext}`); }
      videoPaths.push(vp);
      const m = /^data:image\/png;base64,(.+)$/s.exec(it.labelPng || '');
      if (m) { const lp = path.join(tmp, `l${i}.png`); fs.writeFileSync(lp, Buffer.from(m[1], 'base64')); labelPaths.push(lp); }
      else labelPaths.push(null);
    }

    // Sequence mode needs a fixed per-cell slot length = the longest clip.
    let slot = 0;
    if (mode === 'sequence') {
      const durs = await Promise.all(videoPaths.map(probeDuration));
      slot = Math.max(2, Math.round(Math.max(...durs, 0) * 100) / 100) || 5;
    }

    // Inputs: videos first (0..n-1), then any label PNGs. Sequence caps each
    // video to one slot with -t so cells stay aligned.
    const inputs = [];
    let nInputs = 0;
    for (const v of videoPaths) {
      if (mode === 'sequence') inputs.push('-t', String(slot));
      inputs.push('-i', v); nInputs++;
    }
    const labelIdx = [];
    for (let i = 0; i < n; i++) {
      if (labelPaths[i]) { labelIdx[i] = nInputs; inputs.push('-i', labelPaths[i]); nInputs++; }
      else labelIdx[i] = -1;
    }

    // Watermark position as a fraction of the free space in each cell: (0,0) =
    // top-left, (1,1) = bottom-right. ffmpeg's overlay (W-w)*px keeps the label
    // fully inside the cell at every position. Matches the draggable preview.
    const px = Math.min(1, Math.max(0, Number(labelPos?.x) || 0));
    const py = Math.min(1, Math.max(0, Number(labelPos?.y) || 0));
    const overlayXY = `x='(W-w)*${px.toFixed(4)}':y='(H-h)*${py.toFixed(4)}'`;

    const fit = `scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    // Per-cell: fit into the cell (+ sequence timing), then overlay its label.
    let fc = '';
    for (let i = 0; i < n; i++) {
      if (mode === 'sequence') {
        const start = (i * slot).toFixed(3);
        const stop = ((n - 1 - i) * slot).toFixed(3);
        fc += `[${i}:v]${fit},tpad=stop_mode=clone:stop_duration=${slot},trim=0:${slot},setpts=PTS-STARTPTS,tpad=start_duration=${start}:start_mode=clone:stop_duration=${stop}:stop_mode=clone[s${i}];`;
      } else {
        fc += `[${i}:v]${fit}[s${i}];`;
      }
      fc += labelIdx[i] >= 0 ? `[s${i}][${labelIdx[i]}:v]overlay=${overlayXY}[c${i}];` : `[s${i}]null[c${i}];`;
    }
    // Black fillers for any empty cells in the grid.
    const total = cols * rows;
    for (let i = n; i < total; i++) fc += `color=c=#101012:s=${cellW}x${cellH}:r=24[c${i}];`;
    // Build rows, then stack rows. A single-column (portrait) layout needs no
    // hstack — each cell is its own row.
    const rowLabels = [];
    for (let r = 0; r < rows; r++) {
      if (cols === 1) { rowLabels.push(`c${r}`); continue; }
      const cells = [];
      for (let c = 0; c < cols; c++) cells.push(`[c${r * cols + c}]`);
      fc += `${cells.join('')}hstack=inputs=${cols}[row${r}];`;
      rowLabels.push(`row${r}`);
    }
    let outLabel = rowLabels[0];
    if (rows > 1) { fc += `${rowLabels.map((l) => `[${l}]`).join('')}vstack=inputs=${rows}[out];`; outLabel = 'out'; }

    // Sequence mode: lay each clip's audio into its own time slot so you hear
    // the active model during its turn. Clips without an audio track are simply
    // skipped from the mix.
    const audioArgs = [];
    if (mode === 'sequence') {
      const hasAudio = await Promise.all(videoPaths.map(probeHasAudio));
      const withAudio = [];
      for (let i = 0; i < n; i++) {
        if (!hasAudio[i]) continue;
        fc += `[${i}:a]atrim=0:${slot},asetpts=PTS-STARTPTS,adelay=${Math.round(i * slot * 1000)}:all=1,apad=whole_dur=${(n * slot).toFixed(3)}[a${i}];`;
        withAudio.push(i);
      }
      if (withAudio.length === 1) {
        fc += `[a${withAudio[0]}]anull[aout];`;
        audioArgs.push('-map', '[aout]', '-c:a', 'aac');
      } else if (withAudio.length > 1) {
        fc += `${withAudio.map((i) => `[a${i}]`).join('')}amix=inputs=${withAudio.length}:normalize=0:duration=longest[aout];`;
        audioArgs.push('-map', '[aout]', '-c:a', 'aac');
      } else {
        audioArgs.push('-an');
      }
    } else {
      audioArgs.push('-an');
    }

    const outPath = path.join(JOBS_DIR, `${jobId}.mp4`);
    await runFfmpeg(['-y', ...inputs, '-filter_complex', fc, '-map', `[${outLabel}]`, ...audioArgs, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outPath]);
    return { resultUrl: `/api/generated/${jobId}.mp4` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Concatenate clips end-to-end into ONE continuous full-frame film (vs the grid
// comparison above). Each clip is scaled+padded into a common frame (taken from
// the first clip, capped at 1280 wide, even dims) so mismatched sizes/orientations
// still join cleanly. Audio is concatenated when EVERY clip has a track; otherwise
// the film is silent (concat needs matching stream counts).
async function concatFilms(items) {
  const urls = (Array.isArray(items) ? items : []).map((it) => (it && it.url) || it).filter(Boolean);
  const n = urls.length;
  if (n < 2) throw new Error('need at least 2 clips to assemble a film');
  const jobId = `film_${crypto.randomUUID()}`;
  const tmp = path.join(JOBS_DIR, jobId + '_tmp');
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const videoPaths = [];
    for (let i = 0; i < n; i++) {
      let vp = localGeneratedPath(urls[i]);
      if (!vp) { const { ext } = await downloadTo(urls[i], path.join(tmp, `v${i}`), 'mp4'); vp = path.join(tmp, `v${i}.${ext}`); }
      videoPaths.push(vp);
    }
    // Frame size from the first clip (even, ≤1280 wide).
    const dim = await probeDimensions(videoPaths[0]);
    let W = Math.min(1280, dim.w || 1280); W -= W % 2;
    let H = dim.w ? Math.round(W * (dim.h / dim.w)) : 720; H -= H % 2;
    const hasAudio = await Promise.all(videoPaths.map(probeHasAudio));
    const allAudio = hasAudio.every(Boolean);

    const inputs = [];
    for (const v of videoPaths) inputs.push('-i', v);
    const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
    let fc = '';
    const parts = [];
    for (let i = 0; i < n; i++) {
      fc += `[${i}:v]${fit}[v${i}];`;
      if (allAudio) { fc += `[${i}:a]aresample=async=1:first_pts=0[a${i}];`; parts.push(`[v${i}][a${i}]`); }
      else parts.push(`[v${i}]`);
    }
    fc += `${parts.join('')}concat=n=${n}:v=1:a=${allAudio ? 1 : 0}[outv]${allAudio ? '[outa]' : ''}`;
    const map = ['-map', '[outv]'];
    if (allAudio) map.push('-map', '[outa]', '-c:a', 'aac');
    else map.push('-an');
    const outPath = path.join(JOBS_DIR, `${jobId}.mp4`);
    await runFfmpeg(['-y', ...inputs, '-filter_complex', fc, ...map, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outPath]);
    return { resultUrl: `/api/generated/${jobId}.mp4` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Agent: workflow planner ──
// A lightweight planner (not a full tool-calling loop): given the user's idea,
// the LLM returns a JSON media-workflow plan that the frontend then builds and
// runs node-by-node on the canvas (with a per-step cost confirm). Tools are the
// canvas node types — image / video / music generation — chained by `from`.
const AGENT_PLAN_MODEL = 'anthropic/claude-sonnet-4.6';
// Text models the agent planner may use (mirror TEXT_MODELS in nodes.tsx).
const AGENT_TEXT_MODELS = new Set([
  'anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.8', 'openai/gpt-5.5', 'google/gemini-3.1-pro',
  'google/gemini-2.5-flash', 'deepseek/deepseek-v4-pro',
]);
// Mirror the frontend catalogs (src/canvas/nodes.tsx) so the planner only
// picks model ids the gateway actually serves.
const IMAGE_MODEL_IDS = 'google/nano-banana, google/nano-banana-pro, openai/gpt-image-1, openai/gpt-image-2, xai/grok-imagine-image, zai/cogview-4';
const VIDEO_MODEL_IDS = 'xai/grok-imagine-video, bytedance/seedance-1.5-pro, azure/sora-2, bytedance/seedance-2.0-fast, bytedance/seedance-2.0';
const MUSIC_MODEL_IDS = 'minimax/music-2.5+';
const AGENT_SYSTEM = `You are a media-workflow planner inside a node-based AI studio. The user describes something they want to create (usually a short video). You design a small workflow of generation steps that the app will build visually on an infinite canvas and run one by one.

Available step types (these are the canvas node types / tools):
- "imagegen": generate an image from a text prompt (or from a previous image when "from" is set → image edit).
- "videogen": generate a video. With "from" set to an image step, it animates that image (image→video); without "from", it's text→video.
- "musicgen": generate a background music/audio clip from a text prompt.

Available model ids (pick the most fitting; omit to use a sensible default):
- image: ${IMAGE_MODEL_IDS}
- video: ${VIDEO_MODEL_IDS}
- music: ${MUSIC_MODEL_IDS}

Chaining: each step has a unique short "id" (s1, s2, …). Set "from" to a prior step's id to feed that step's OUTPUT as the input of this step (e.g. imagegen → videogen animates the image). A common pattern: s1 imagegen (establish the look) → s2 videogen from s1 (animate it) → optionally s3 musicgen for a soundtrack.

Rules:
- Keep it to 2–4 steps. Prefer one clear chain.
- Write rich, specific prompts (lighting, motion, style, mood) — they drive real generations.
- For video/music steps include "durationS" (3–10).
- Respond with ONLY a JSON object, no markdown fences, of the shape:
{"message":"<one or two friendly sentences explaining the plan>","steps":[{"id":"s1","type":"imagegen","title":"<short label>","prompt":"<detailed prompt>","model":"<id or omit>","from":null,"durationS":null}]}`;

function extractJsonObject(text) {
  let t = (text || '').trim();
  // strip ```json … ``` fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* fall through to brace scan */ }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error('no JSON in model output');
}

async function planWorkflow(prompt, history, model) {
  const { privateKey } = getWallet();
  const client = new LLMClient({ privateKey, apiUrl });
  const planModel = typeof model === 'string' && AGENT_TEXT_MODELS.has(model) ? model : AGENT_PLAN_MODEL;
  const messages = [{ role: 'system', content: AGENT_SYSTEM }];
  for (const h of (Array.isArray(history) ? history : []).slice(-6)) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: String(prompt) });
  const resp = await client.chatCompletion(planModel, messages, { maxTokens: 1400, temperature: 0.5 });
  const text = resp.choices?.[0]?.message?.content || '';
  const plan = extractJsonObject(text);
  // Sanitize steps.
  const okTypes = new Set(['imagegen', 'videogen', 'musicgen']);
  const steps = (Array.isArray(plan.steps) ? plan.steps : [])
    .filter((s) => s && okTypes.has(s.type) && typeof s.prompt === 'string' && s.prompt.trim())
    .slice(0, 5)
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`,
      type: s.type,
      title: typeof s.title === 'string' ? s.title.slice(0, 60) : '',
      prompt: s.prompt.trim(),
      model: typeof s.model === 'string' ? s.model : undefined,
      from: typeof s.from === 'string' ? s.from : null,
      durationS: Number.isFinite(s.durationS) ? Math.max(3, Math.min(10, s.durationS)) : undefined,
    }));
  // Drop dangling "from" references.
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) if (s.from && !ids.has(s.from)) s.from = null;
  return { message: typeof plan.message === 'string' ? plan.message : 'Here is a workflow for that.', steps };
}

// ── HTTP routing ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); res.end(); return; }
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
        const { address, privateKey, isNew } = wallet;
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
        return json(req, res, { address, balanceUsdc, recentSpendUsd, totalSpendUsd, network, chain, isNew, spendByCategory });
      } catch (err) {
        const network = chain === 'solana' ? 'Solana' : 'Base';
        return json(req, res, { address: '', balanceUsdc: 0, recentSpendUsd: 0, totalSpendUsd: 0, network, chain, isNew: false, spendByCategory: [], error: String(err) });
      }
    }

    if (p === '/api/wallet/transactions' && req.method === 'GET') {
      try {
        const logPath = SHARED_COST_LOG;
        if (!fs.existsSync(logPath)) return json(req, res, []);
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
        return json(req, res, txs);
      } catch {
        return json(req, res, []);
      }
    }

    if (p === '/api/generate' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      if (!body.prompt) return json(req, res, { ok: false, error: 'prompt required' }, 400);
      if (!['image', 'video', 'music'].includes(body.kind)) {
        return json(req, res, { ok: false, error: 'kind must be image|video|music' }, 400);
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
        return json(req, res, { ok: true, ...result });
      } catch (err) {
        const ms = Date.now() - t0;
        console.warn(`[generate] ${body.kind} ${body.model || 'default'} FAIL ${ms}ms: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    if (p === '/api/agent/plan' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      if (!body.prompt || !String(body.prompt).trim()) return json(req, res, { ok: false, error: 'prompt required' }, 400);
      try {
        const plan = await planWorkflow(body.prompt, body.history, body.model);
        return json(req, res, { ok: true, ...plan });
      } catch (err) {
        console.warn(`[agent] plan FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    // ── Real tool-calling agent ──
    // One turn of the loop: the frontend posts the running conversation; we
    // prepend the system prompt, hand the tools to the gateway, and return the
    // assistant message (which may contain tool_calls). The frontend executes
    // the calls and posts back the next turn. See agent-tools.mjs.
    if (p === '/api/agent/chat' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      try {
        const { privateKey, address } = getWallet();
        if (!privateKey) return json(req, res, { ok: false, error: 'No wallet found. Run `franklin wallet init` or set BASE_CHAIN_WALLET_KEY.' }, 400);
        const out = await runAgentChat({ model: body.model, messages: body.messages }, { privateKey, address, apiUrl, jobsDir: JOBS_DIR });
        // Debug: log exactly which tools the model asked for (name + args) so we
        // can see the agent's run history. Written to a file (immediate flush).
        try {
          const tc = out.message?.tool_calls;
          const line = tc?.length
            ? tc.map((c) => `${c.function?.name}(${(c.function?.arguments || '').replace(/\s+/g, ' ').slice(0, 200)})`).join('  ||  ')
            : `(final reply, no tools) ${(out.message?.content || '').slice(0, 120)}`;
          fs.appendFileSync(path.join(os.homedir(), '.franklin', 'agent-debug.log'), `[${new Date().toISOString()}] ${line}\n`);
        } catch { /* ignore */ }
        return json(req, res, { ok: true, ...out });
      } catch (err) {
        console.warn(`[agent] chat FAIL: ${err.message || err}`);
        try { fs.appendFileSync(path.join(os.homedir(), '.franklin', 'agent-debug.log'), `[${new Date().toISOString()}] CHAT FAIL model=${body.model || 'default'} :: ${(err.message || String(err)).slice(0, 400)}\n`); } catch { /* ignore */ }
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    // Execute one BACKEND tool (web / memory / MoA / utility / filesystem / bash).
    // Canvas/media tools are executed in the browser and never reach here.
    if (p === '/api/agent/tool' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const name = body.name;
      if (CANVAS_TOOL_NAMES.has(name)) return json(req, res, { ok: false, error: `${name} is a canvas tool (executed client-side)` }, 400);
      try {
        const { privateKey, address } = getWallet();
        const output = await runBackendTool(name, body.input || {}, { privateKey, address, apiUrl, jobsDir: JOBS_DIR });
        return json(req, res, { ok: true, output: String(output ?? '') });
      } catch (err) {
        // Tool errors are non-fatal — the model sees them as an is_error result.
        return json(req, res, { ok: true, output: `Error: ${err.message || String(err)}`, isError: true });
      }
    }

    // Auto-compact: summarize the early part of the agent conversation when it
    // grows too large, so long sessions don't blow the context window.
    if (p === '/api/agent/summarize' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      try {
        const { privateKey, address } = getWallet();
        if (!privateKey) return json(req, res, { ok: false, error: 'No wallet found.' }, 400);
        const summary = await summarizeConversation(body.messages, { privateKey, address, apiUrl, jobsDir: JOBS_DIR });
        return json(req, res, { ok: true, summary });
      } catch (err) {
        console.warn(`[agent] summarize FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    // Vision: look at an image (or a video frame the client captured) and return
    // a textual description. Backs the describe_media canvas tool.
    if (p === '/api/describe' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      try {
        const { privateKey, address } = getWallet();
        if (!privateKey) return json(req, res, { ok: false, error: 'No wallet found.' }, 400);
        const text = await describeMedia({ imageUrl: body.imageUrl, question: body.question }, { privateKey, address, apiUrl, jobsDir: JOBS_DIR });
        return json(req, res, { ok: true, text });
      } catch (err) {
        console.warn(`[agent] describe FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    // Translate a batch of short strings (used by the Prompt Library's 中/EN
    // toggle to localize Chinese case titles for English demos). Cheap model;
    // the frontend caches results per source string so each is translated once.
    if (p === '/api/translate' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const texts = Array.isArray(body.texts) ? body.texts.slice(0, 200).map(String) : [];
      if (!texts.length) return json(req, res, { ok: true, translations: [] });
      const target = body.target === 'zh' ? 'Simplified Chinese' : 'English';
      try {
        const { privateKey } = getWallet();
        if (!privateKey) return json(req, res, { ok: false, error: 'No wallet found.' }, 400);
        const client = new LLMClient({ privateKey, apiUrl });
        const sys = `You are a translator. Translate each string in the input JSON array to natural ${target}. Preserve any leading numbering like "例 104:" as "Example 104:". Return ONLY a JSON array of strings — same length and order as the input, no commentary.`;
        const resp = await client.chatCompletion('anthropic/claude-haiku-4.5',
          [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(texts) }],
          { maxTokens: 3000, temperature: 0 });
        const txt = resp?.choices?.[0]?.message?.content || '[]';
        let arr;
        try { arr = JSON.parse(txt); } catch { const m = txt.match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : null; }
        if (!Array.isArray(arr) || arr.length !== texts.length) arr = texts; // identity fallback
        return json(req, res, { ok: true, translations: arr.map(String) });
      } catch (err) {
        console.warn(`[translate] FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
      }
    }

    if (p === '/api/comparison/stitch' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const items = Array.isArray(body.items) ? body.items : [];
      const mode = body.mode === 'sequence' ? 'sequence' : 'grid';
      const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape';
      const labelPos = body.labelPos && typeof body.labelPos === 'object' ? body.labelPos : undefined;
      const t0 = Date.now();
      try {
        const out = await stitchComparison(items, mode, orientation, labelPos);
        console.log(`[comparison] stitched ${items.length} videos (${mode}/${orientation}) in ${Date.now() - t0}ms`);
        return json(req, res, { ok: true, ...out });
      } catch (err) {
        console.warn(`[comparison] stitch FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 500);
      }
    }

    // Concatenate clips into one continuous film (storyboard → film).
    if (p === '/api/concat' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const items = Array.isArray(body.items) ? body.items : [];
      const t0 = Date.now();
      try {
        const out = await concatFilms(items);
        console.log(`[concat] joined ${items.length} clips in ${Date.now() - t0}ms`);
        return json(req, res, { ok: true, ...out });
      } catch (err) {
        console.warn(`[concat] FAIL: ${err.message || err}`);
        return json(req, res, { ok: false, error: err.message || String(err) }, 500);
      }
    }

    if (p === '/api/health' && req.method === 'GET') {
      return json(req, res, { ok: true });
    }

    // ── Project files (on-disk canvas persistence) ──
    if (p === '/api/projects' && req.method === 'GET') {
      try {
        const files = fs.existsSync(PROJECTS_DIR) ? fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json')) : [];
        const projects = [];
        for (const f of files) { try { projects.push(JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'))); } catch { /* skip corrupt */ } }
        return json(req, res, { ok: true, projects });
      } catch (err) { return json(req, res, { ok: false, error: String(err), projects: [] }, 500); }
    }
    if (p === '/api/projects/save' && req.method === 'POST') {
      const raw = await readBody(req);
      let body; try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const pr = body.project;
      if (!pr || !pr.id) return json(req, res, { ok: false, error: 'project.id required' }, 400);
      const safe = String(pr.id).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safe) return json(req, res, { ok: false, error: 'bad id' }, 400);
      try { fs.writeFileSync(path.join(PROJECTS_DIR, `${safe}.json`), JSON.stringify(pr)); return json(req, res, { ok: true }); }
      catch (err) { return json(req, res, { ok: false, error: String(err) }, 500); }
    }
    if (p === '/api/projects/delete' && req.method === 'POST') {
      const raw = await readBody(req);
      let body; try { body = JSON.parse(raw); } catch { return json(req, res, { ok: false, error: 'bad json' }, 400); }
      const safe = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      try { if (safe) fs.rmSync(path.join(PROJECTS_DIR, `${safe}.json`), { force: true }); return json(req, res, { ok: true }); }
      catch (err) { return json(req, res, { ok: false, error: String(err) }, 500); }
    }

    if (p === '/api/prompts' && req.method === 'GET') {
      try {
        const items = await getPromptLibrary();
        return json(req, res, { ok: true, items });
      } catch (err) {
        return json(req, res, { ok: false, error: err.message || String(err), items: [] }, 502);
      }
    }

    if (p === '/api/prompts/detail' && req.method === 'GET') {
      try {
        const relPath = new URL(req.url, 'http://x').searchParams.get('path') || '';
        const detail = await getPromptDetail(relPath);
        return json(req, res, { ok: true, ...detail });
      } catch (err) {
        return json(req, res, { ok: false, error: err.message || String(err) }, 502);
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
        ...corsHeaders(req),
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, corsHeaders(req)); res.end('Not found');
  } catch (err) {
    json(req, res, { ok: false, error: String(err) }, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Franklin Canvas backend on http://127.0.0.1:${PORT}`);
  console.log('  GET  /api/wallet?chain=base|solana');
  console.log('  GET  /api/wallet/transactions');
  console.log('  POST /api/generate');
  console.log('  GET  /api/generated/<file>');
  console.log('  GET  /api/prompts');
});
