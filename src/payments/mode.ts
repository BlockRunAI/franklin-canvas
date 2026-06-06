// How the canvas pays the BlockRun gateway for x402-priced generations.
//
//   'local'   — the backend (server.mjs) signs with the local ~/.blockrun wallet.
//               This is the DESKTOP build (Electron has a local wallet).
//   'browser' — each visitor signs x402 with THEIR OWN connected wallet (wagmi),
//               exactly like franklin.run. This is the WEB build.
//
// Set VITE_PAYMENT_MODE=browser at build time for the web deploy; unset (default
// 'local') keeps the desktop behavior untouched.
export const PAYMENT_MODE: 'browser' | 'local' =
  import.meta.env.VITE_PAYMENT_MODE === 'browser' ? 'browser' : 'local';

export const IS_BROWSER_PAY = PAYMENT_MODE === 'browser';
