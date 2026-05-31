// Thin HTTP client for the local Franklin panel/daemon.
//
// Paths match the existing Franklin panel server (Franklin/src/panel/server.ts),
// which is already started by `franklin start` / `franklin panel` on :3100.
// That means franklin-web can talk to a REAL Franklin process today —
// no separate daemon mode needed for the read-only endpoints.
//
// Endpoints that don't yet exist on the panel (chat stream, transactions)
// are served by the local mock-server.mjs for UI iteration; when the
// equivalent is added to the panel server upstream, this client switches
// over automatically.

import type { Session, WalletInfo, WalletChain, Transaction } from '../types';

const base = '/api';

export async function listSessions(): Promise<Session[]> {
  const r = await fetch(`${base}/sessions`);
  if (!r.ok) throw new Error(`sessions ${r.status}`);
  const raw = await r.json();
  // The panel returns { sessions: [...] } or a bare array depending on
  // version. Normalize.
  const items = Array.isArray(raw) ? raw : raw.sessions ?? [];
  return items.map((s: Record<string, unknown>) => ({
    id: String(s.id ?? s.session_id ?? ''),
    title: String(s.title ?? s.name ?? 'Untitled'),
    model: String(s.model ?? s.last_model ?? 'unknown'),
    messageCount: Number(s.messageCount ?? s.message_count ?? s.turns ?? 0),
    updatedAt: Number(s.updatedAt ?? s.updated_at ?? s.ts ?? Date.now()),
  }));
}

export async function getWallet(chain: WalletChain = 'base'): Promise<WalletInfo> {
  const r = await fetch(`${base}/wallet?chain=${chain}`);
  if (!r.ok) throw new Error(`wallet ${r.status}`);
  const raw = await r.json();
  // Panel returns: { address, balanceUsdc, ... } OR { address, balance: {...} }
  // Normalize to our shape.
  return {
    address: String(raw.address ?? ''),
    balanceUsdc: Number(raw.balanceUsdc ?? raw.balance?.usdc ?? raw.usdc ?? 0),
    recentSpendUsd: Number(raw.recentSpendUsd ?? raw.recent_spend_usd ?? raw.spend_24h ?? 0),
    totalSpendUsd: Number(raw.totalSpendUsd ?? raw.total_spend_usd ?? 0),
    network: String(raw.network ?? (chain === 'solana' ? 'Solana' : 'Base')),
    chain: (raw.chain as WalletChain) ?? chain,
    isNew: !!raw.isNew,
    spendByCategory: raw.spendByCategory ?? raw.spend_by_category ?? [],
  };
}

export interface PromptItem {
  id: string;
  title: string;
  titleCn?: string;
  category: string;
  workflow?: string;
  model?: string;
  tags?: string[];
  prompt: string;
  image?: string;
  needsRef?: boolean;
  source: string;
  /** Relative path of the case file; the full prompt body is fetched on demand. */
  path?: string;
}

// Prompt library catalog — fetched server-side from the BlockRun case library
// INDEX. Titles + metadata only; the prompt body comes from getPromptDetail.
export async function listPrompts(): Promise<PromptItem[]> {
  const r = await fetch(`${base}/prompts`);
  if (!r.ok) throw new Error(`prompts ${r.status}`);
  const raw = await r.json();
  return Array.isArray(raw) ? raw : raw.items ?? [];
}

// Fetch the full prompt body (+ preview image) for one case, on demand.
export async function getPromptDetail(path: string): Promise<{ prompt: string; image?: string; title?: string }> {
  const r = await fetch(`${base}/prompts/detail?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`prompt detail ${r.status}`);
  const raw = await r.json();
  if (raw?.ok === false) throw new Error(raw.error || 'detail failed');
  return { prompt: raw.prompt || '', image: raw.image, title: raw.title };
}

export async function listTransactions(): Promise<Transaction[]> {
  // Tries /api/wallet/transactions (mock + future panel).
  // If absent, returns []. The wallet page handles empty gracefully.
  try {
    const r = await fetch(`${base}/wallet/transactions`);
    if (!r.ok) return [];
    const raw = await r.json();
    const items = Array.isArray(raw) ? raw : raw.transactions ?? [];
    return items.map((t: Record<string, unknown>) => ({
      id: String(t.id),
      ts: Number(t.ts),
      type: t.type as Transaction['type'],
      amountUsd: Number(t.amountUsd ?? t.amount_usd ?? 0),
      description: String(t.description ?? ''),
      txHash: t.txHash ? String(t.txHash) : undefined,
      model: t.model ? String(t.model) : undefined,
    }));
  } catch {
    return [];
  }
}

export interface StreamHandlers {
  onToken: (token: string) => void;
  onDone: (meta: { model: string; costUsd: number; txHash?: string }) => void;
  onError: (err: Error) => void;
}

export function streamChat(
  sessionId: string,
  prompt: string,
  handlers: StreamHandlers,
): () => void {
  const ctrl = new AbortController();

  (async () => {
    try {
      const r = await fetch(`${base}/chat/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, prompt }),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        for (;;) {
          const idx = buf.indexOf('\n\n');
          if (idx === -1) break;
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          if (payload.type === 'token') handlers.onToken(payload.token);
          else if (payload.type === 'done') handlers.onDone(payload);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') handlers.onError(err as Error);
    }
  })();

  return () => ctrl.abort();
}

// ─── Generation through the Franklin daemon / local backend ───────────────
//
// Hits the backend's /api/generate, which calls the BlockRun gateway via the
// user's wallet + x402 micropayment, saves the bytes locally and returns a
// relative URL the same backend serves back.

export interface GenerateRequest {
  kind: 'image' | 'video' | 'music';
  prompt: string;
  model?: string;
  durationS?: number;
  lyrics?: string;
  instrumental?: boolean;
  imageUrl?: string;
  aspectRatio?: 'adaptive' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
  resolution?: '360p' | '480p' | '540p' | '720p' | '1080p' | '1K' | '2K' | '4K';
  generateAudio?: boolean;
  seed?: number;
  watermark?: boolean;
  returnLastFrame?: boolean;
}

export interface GenerateResult {
  ok: true;
  resultUrl: string;
  message?: string;
}

export interface GenerateError {
  ok: false;
  error: string;
  toolOutput?: string;
}

export async function generate(req: GenerateRequest): Promise<GenerateResult | GenerateError> {
  try {
    const r = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.ok === false) {
      return { ok: false, error: data?.error || `daemon returned ${r.status}` };
    }
    return { ok: true, resultUrl: data.resultUrl as string, message: data.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'network error' };
  }
}
