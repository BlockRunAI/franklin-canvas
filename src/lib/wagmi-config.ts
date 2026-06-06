import { http, createConfig } from 'wagmi';
import { base, mainnet } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// Browser-wallet config for the web build. Base is primary (USDC + x402);
// mainnet is included so a user connected to Ethereum can switch over.
// Ported from franklin-run (Next) → Vite: env via import.meta.env, no SSR.
const projectId = import.meta.env.VITE_WALLETCONNECT_ID || '';
const isClient = typeof window !== 'undefined';

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  connectors: [
    injected(),
    ...(isClient && projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [base.id]: http(),
    [mainnet.id]: http(),
  },
});

// USDC on Base mainnet — the asset x402 payments settle in.
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
