import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

test('account video uses bearer auth, SDK field mapping, and local artifact storage', async (t) => {
  const secret = 'brk_test_video_unit';
  let submitted;
  const api = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/videos/generations') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      submitted = { auth: req.headers.authorization, body: JSON.parse(raw) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', data: [{ url: `http://127.0.0.1:${api.address().port}/artifact.mp4` }] }));
      return;
    }
    if (req.method === 'GET' && req.url === '/artifact.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(Buffer.alloc(2048, 7));
      return;
    }
    res.writeHead(404); res.end();
  });
  const apiPort = await listen(api);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'franklin-canvas-video-'));
  const canvasPort = 33100 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env, HOME: home, PORT: String(canvasPort),
      BLOCKRUN_API_KEY: secret,
      BLOCKRUN_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => {
    child.kill('SIGTERM'); api.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${canvasPort}`;
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const response = await fetch(`${base}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'video', prompt: 'test clip', model: 'bytedance/seedance-2.0-fast',
      durationS: 5, aspectRatio: '9:16', resolution: '720p', generateAudio: false,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(submitted.auth, `Bearer ${secret}`);
  assert.deepEqual(submitted.body, {
    model: 'bytedance/seedance-2.0-fast', prompt: 'test clip',
    duration_seconds: 5, aspect_ratio: '9:16', resolution: '720p', generate_audio: false,
  });
  const artifact = await fetch(base + result.resultUrl);
  assert.equal(artifact.status, 200);
  assert.equal((await artifact.arrayBuffer()).byteLength, 2048);
  assert.equal(logs.includes(secret), false);
});
