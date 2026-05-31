export type Route = 'canvas' | 'wallet' | 'projects';

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
  balanceUsdc: number;
  recentSpendUsd: number;
  totalSpendUsd?: number;
  network: string;
  /** Settlement chain — present on responses; defaults to 'base' if missing. */
  chain?: WalletChain;
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
