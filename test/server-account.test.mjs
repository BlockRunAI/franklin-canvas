import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function waitForServer(url, child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('server did not start');
}

test('server reports account billing without creating or returning a wallet', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'franklin-canvas-account-'));
  const port = 32100 + Math.floor(Math.random() * 1000);
  const secret = 'brk_test_server_unit';
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, HOME: home, PORT: String(port), BLOCKRUN_API_KEY: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(() => { child.kill('SIGTERM'); fs.rmSync(home, { recursive: true, force: true }); });

  const base = `http://127.0.0.1:${port}`;
  const healthResponse = await waitForServer(`${base}/api/health`, child);
  const health = await healthResponse.json();
  const billing = await (await fetch(`${base}/api/wallet?chain=solana`)).json();

  assert.deepEqual(health, {
    ok: true,
    authMode: 'api-key',
    portalUrl: 'https://user.blockrun.ai',
    creditsUrl: 'https://user.blockrun.ai/dashboard/credits',
  });
  assert.equal(billing.authMode, 'api-key');
  assert.equal(billing.chain, 'account');
  assert.equal(billing.address, '');
  assert.equal(billing.balanceUsdc, null);
  assert.equal(fs.existsSync(path.join(home, '.blockrun', 'wallet')), false);
  assert.equal(fs.existsSync(path.join(home, '.blockrun', 'solana-wallet')), false);
  assert.equal(JSON.stringify({ health, billing }).includes(secret), false);
  assert.equal(output.includes(secret), false);
});
