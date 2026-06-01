// Agent chat history — persist each Media Agent conversation so the user can
// start a new chat and revisit past ones. We store BOTH the display trace (what
// the user sees: messages + tool calls) and the raw OpenAI-format `turns` (so a
// loaded conversation can be continued by the tool-calling loop). Persisted to
// localStorage via zustand/persist.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatTurn } from '../api/franklin';

export type TraceStatus = 'running' | 'done' | 'error' | 'skipped';

// One item in the visible conversation trace.
export interface TraceItem {
  id: number;
  kind: 'user' | 'agent' | 'tool';
  text?: string;        // user/agent message text
  tool?: string;        // tool name (kind === 'tool')
  label?: string;       // display label for the tool call
  status?: TraceStatus; // tool execution status
  output?: string;      // tool result (collapsible)
  cost?: number;        // estimated/charged USD for the tool
}

export interface AgentSession {
  id: string;
  title: string;
  trace: TraceItem[];
  turns: ChatTurn[];
  updatedAt: number;
}

interface AgentSessionsState {
  sessions: AgentSession[];
  upsert: (s: AgentSession) => void;
  remove: (id: string) => void;
}

export const useAgentSessions = create<AgentSessionsState>()(
  persist(
    (set) => ({
      sessions: [],
      upsert: (s) =>
        set((st) => {
          const rest = st.sessions.filter((x) => x.id !== s.id);
          return { sessions: [s, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50) };
        }),
      remove: (id) => set((st) => ({ sessions: st.sessions.filter((x) => x.id !== id) })),
    }),
    {
      name: 'franklin-canvas:agent-sessions',
      // v2 switched sessions from {bubbles, steps} (one-shot planner) to
      // {trace, turns} (tool-calling loop). Migrate old records so loading
      // history doesn't crash on a missing `trace`.
      version: 2,
      migrate: (state, version) => {
        const st = state as { sessions?: unknown[] } | undefined;
        const raw = Array.isArray(st?.sessions) ? st!.sessions : [];
        const sessions: AgentSession[] = raw.map((x) => {
          const s = x as Record<string, unknown>;
          if (Array.isArray(s.trace)) return s as unknown as AgentSession;
          const bubbles = Array.isArray(s.bubbles) ? (s.bubbles as Record<string, unknown>[]) : [];
          const trace: TraceItem[] = bubbles.map((b, i) => ({
            id: Number(b.id ?? i),
            kind: b.role === 'user' ? 'user' : 'agent',
            text: String(b.text ?? ''),
          }));
          return { id: String(s.id ?? ''), title: String(s.title ?? 'Chat'), trace, turns: [], updatedAt: Number(s.updatedAt ?? 0) };
        }).filter((s) => s.id);
        void version;
        return { sessions };
      },
    },
  ),
);
