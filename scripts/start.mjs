// One-command launcher for Franklin Canvas:
//   1. spawn `node server.mjs`  — the self-contained backend on :3100
//      (wallet + x402 + /api/generate via @blockrun/llm)
//   2. spawn `vite`              — the UI on :5173, proxies /api → :3100
//   3. multiplex both processes' stdout onto our terminal with [tags]
//   4. shut both down cleanly on Ctrl-C
//
// Run with `npm start`. No external deps.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function spawnTagged(tag, color, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pipe = (stream, isErr) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (!line) continue;
        process[isErr ? 'stderr' : 'stdout'].write(`${color}[${tag}]\x1b[0m ${line}\n`);
      }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  return child;
}

console.log('Starting Franklin Canvas…');
console.log('  backend: node server.mjs   (http://127.0.0.1:3100)');
console.log('  ui:      vite              (http://localhost:5173)\n');

const backend = spawnTagged('api', '\x1b[36m', 'node', ['server.mjs']);
const ui = spawnTagged('ui',  '\x1b[35m', 'npx', ['vite']);

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting both processes down…`);
  backend.kill('SIGTERM');
  ui.kill('SIGTERM');
  setTimeout(() => {
    backend.kill('SIGKILL');
    ui.kill('SIGKILL');
    process.exit(0);
  }, 2500);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// If either child dies on its own, take the other down too.
const onChildExit = (name) => (code) => {
  if (shuttingDown) return;
  console.log(`\n[${name}] exited (code ${code}) — shutting down the other half`);
  shutdown(`${name}-exit`);
};
backend.on('exit', onChildExit('api'));
ui.on('exit', onChildExit('ui'));
