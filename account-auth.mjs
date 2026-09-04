export const ACCOUNT_PORTAL = 'https://user.blockrun.ai';
export const ACCOUNT_KEYS_URL = `${ACCOUNT_PORTAL}/dashboard/keys`;
export const ACCOUNT_CREDITS_URL = `${ACCOUNT_PORTAL}/dashboard/credits`;

export function isAccountMode(env = process.env) {
  return env.BLOCKRUN_API_KEY !== undefined;
}

export function accountClientOptions(env = process.env) {
  const key = env.BLOCKRUN_API_KEY;
  if (key === undefined) return null;
  const apiKey = key.trim();
  if (!/^brk_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new Error(`Invalid BLOCKRUN_API_KEY. Create one at ${ACCOUNT_KEYS_URL}.`);
  }
  const options = { apiKey };
  if (env.BLOCKRUN_API_BASE_URL) options.apiUrl = env.BLOCKRUN_API_BASE_URL;
  return options;
}

export function billingContext(env = process.env) {
  const account = accountClientOptions(env);
  if (account) {
    return {
      authMode: 'api-key',
      address: '',
      privateKey: undefined,
      clientOptions: account,
      portalUrl: ACCOUNT_PORTAL,
      creditsUrl: ACCOUNT_CREDITS_URL,
    };
  }
  return { authMode: 'wallet' };
}
