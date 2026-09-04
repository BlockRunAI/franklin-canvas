import test from 'node:test';
import assert from 'node:assert/strict';
import { accountClientOptions, billingContext, isAccountMode } from '../account-auth.mjs';

test('account mode resolves a trimmed API key without exposing it in status fields', () => {
  const secret = 'brk_test_unit_123';
  const env = { BLOCKRUN_API_KEY: `  ${secret}  ` };
  assert.equal(isAccountMode(env), true);
  assert.deepEqual(accountClientOptions(env), { apiKey: secret });
  const ctx = billingContext(env);
  assert.equal(ctx.authMode, 'api-key');
  assert.equal(ctx.address, '');
  assert.equal(JSON.stringify({ ...ctx, clientOptions: undefined }).includes(secret), false);
});

test('account API base URL is forwarded to SDK clients', () => {
  assert.deepEqual(accountClientOptions({
    BLOCKRUN_API_KEY: 'brk_test_key',
    BLOCKRUN_API_BASE_URL: 'http://127.0.0.1:9999',
  }), { apiKey: 'brk_test_key', apiUrl: 'http://127.0.0.1:9999' });
});

test('invalid explicit account key fails instead of falling back to a wallet', () => {
  assert.throws(() => accountClientOptions({ BLOCKRUN_API_KEY: 'not-a-key' }), /Invalid BLOCKRUN_API_KEY/);
  assert.equal(isAccountMode({}), false);
  assert.deepEqual(billingContext({}), { authMode: 'wallet' });
});
