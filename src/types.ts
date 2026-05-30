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
