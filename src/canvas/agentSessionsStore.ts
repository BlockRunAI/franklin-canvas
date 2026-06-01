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
    { name: 'franklin-canvas:agent-sessions' },
  ),
);
