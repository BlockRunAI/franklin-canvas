// Mock Franklin daemon for local dev.
// Run alongside `npm run dev`:
//   node mock-server.mjs
//
// Serves /api/{wallet,wallet/transactions,sessions} and a simulated SSE
// /api/chat/stream so you can iterate on the web UI without the real
// Franklin agent running.

import http from 'node:http';

const PORT = 3100;

const sessions = [
  { id: 's1', title: 'Refactor parser', model: 'claude-opus-4-7', messageCount: 42, updatedAt: Date.now() - 3600_000 },
  { id: 's2', title: 'Trade BTC swing', model: 'claude-haiku-4.5', messageCount: 17, updatedAt: Date.now() - 7200_000 },
  { id: 's3', title: 'Generate launch video', model: 'sora-2', messageCount: 8, updatedAt: Date.now() - 86_400_000 },
];

const wallet = {
  address: '0x34913A202138c83D0ed5FcA84E15da456d24402E',
  balanceUsdc: 47.32,
  recentSpendUsd: 1.847,
  network: 'Base',
  spendByCategory: [
    { category: 'Claude Opus', usd: 1.243 },
    { category: 'Claude Haiku', usd: 0.184 },
    { category: 'GPT-5.5', usd: 0.412 },
    { category: 'Image generation', usd: 0.95 },
    { category: 'Video generation', usd: 2.40 },
    { category: 'Web search (Exa)', usd: 0.108 },
    { category: 'Modal sandbox', usd: 0.067 },
  ],
};

const transactions = [
  { id: 't1', ts: Date.now() - 5 * 60_000, type: 'spend', amountUsd: 0.0023, description: 'Claude Opus · refactor parser', model: 'opus', txHash: '0xabc1' },
  { id: 't2', ts: Date.now() - 12 * 60_000, type: 'spend', amountUsd: 0.40, description: 'Veo 3 · launch video 5s', model: 'veo3', txHash: '0xabc2' },
  { id: 't3', ts: Date.now() - 45 * 60_000, type: 'spend', amountUsd: 0.05, description: 'Nano Banana · product shot', model: 'nano', txHash: '0xabc3' },
  { id: 't4', ts: Date.now() - 2 * 3600_000, type: 'topup', amountUsd: 25, description: 'Coinbase on-ramp', txHash: '0xabc4' },
  { id: 't5', ts: Date.now() - 3 * 3600_000, type: 'spend', amountUsd: 0.0008, description: 'Exa search · "x402 standard"', txHash: '0xabc5' },
  { id: 't6', ts: Date.now() - 5 * 3600_000, type: 'refund', amountUsd: 0.003, description: 'Modal sandbox · failed run', txHash: '0xabc6' },
  { id: 't7', ts: Date.now() - 8 * 3600_000, type: 'spend', amountUsd: 0.184, description: 'Claude Haiku · trade signals', model: 'haiku', txHash: '0xabc7' },
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (res, obj, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json', ...cors });
  res.end(JSON.stringify(obj));
};

const SAMPLE_REPLY = `Sure — here's a quick sketch.

The Franklin agent uses a few key building blocks:

\`\`\`ts
import { LLMClient } from '@blockrun/llm';
const client = new LLMClient({ wallet });
const result = await client.chat({ messages });
\`\`\`

Each call goes through the **BlockRun gateway**, which handles \`x402\` micropayments. The settlement happens on Base in one round-trip, so the latency is effectively the same as a regular API call.

A few things worth noting:

- The agent never holds your USDC — it spends from your wallet directly.
- Every call returns a tx hash you can verify on-chain.
- If a model fails, the payment is *not* settled — you only pay for successful responses.

Let me know if you want me to dig into any specific layer.`;

const streamChat = (res, prompt) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...cors,
  });

  const tokens = SAMPLE_REPLY.split(/(\s+)/);
  let i = 0;

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({ type: 'start', echo: prompt.slice(0, 60) });

  const interval = setInterval(() => {
    if (i >= tokens.length) {
      clearInterval(interval);
      send({ type: 'done', model: 'mock-opus', costUsd: 0.0023, txHash: '0xmock...' });
      res.end();
      return;
    }
    send({ type: 'token', token: tokens[i] });
    i++;
  }, 25);

  res.on('close', () => clearInterval(interval));
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/sessions' && req.method === 'GET') return json(res, sessions);
  if (url.pathname === '/api/wallet' && req.method === 'GET') return json(res, wallet);
  if (url.pathname === '/api/wallet/transactions' && req.method === 'GET') return json(res, transactions);
  if (url.pathname === '/api/chat/stream' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { prompt = '' } = JSON.parse(body || '{}');
      streamChat(res, prompt);
    });
    return;
  }

  json(res, { error: 'not found', path: url.pathname }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Franklin mock daemon listening on http://127.0.0.1:${PORT}`);
  console.log('Routes:');
  console.log('  GET  /api/sessions');
  console.log('  GET  /api/wallet');
  console.log('  GET  /api/wallet/transactions');
  console.log('  POST /api/chat/stream  (SSE)');
});
