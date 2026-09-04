export type Route = 'canvas' | 'wallet' | 'projects' | 'comparison';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  updatedAt: number;
}

export type WalletChain = 'base' | 'solana';

export interface WalletInfo {
  address: string;
  balanceUsdc: number | null;
  recentSpendUsd: number | null;
  totalSpendUsd?: number | null;
  network: string;
  /** Settlement method. Solana is the default wallet chain. */
  chain?: WalletChain | 'account';
  authMode?: 'api-key' | 'wallet';
  portalUrl?: string;
  keysUrl?: string;
  creditsUrl?: string;
  /** True iff this wallet was just auto-created on the current /api/wallet
   *  call (file didn't exist on disk before). Lets the UI show a one-time
   *  "wallet ready, send USDC here" hint instead of treating it as normal. */
  isNew?: boolean;
  spendByCategory: { category: string; usd: number }[];
}

export interface Transaction {
  id: string;
  ts: number;
  type: 'spend' | 'topup' | 'refund';
  amountUsd: number;
  description: string;
  txHash?: string;
  model?: string;
}
