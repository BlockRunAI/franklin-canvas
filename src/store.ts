import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from './types';

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  sessions: Record<string, ChatSession>;
  activeId: string | null;
  newSession: () => string;
  setActive: (id: string) => void;
  appendMessage: (sid: string, msg: Message) => void;
  patchLastAssistant: (sid: string, patch: (current: string) => string) => void;
  renameSession: (sid: string, title: string) => void;
  deleteSession: (sid: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: {},
      activeId: null,

      newSession: () => {
        const id = crypto.randomUUID();
        const now = Date.now();
        set((s) => ({
          sessions: {
            ...s.sessions,
            [id]: { id, title: 'New chat', messages: [], createdAt: now, updatedAt: now },
          },
          activeId: id,
        }));
        return id;
      },

      setActive: (id) => set({ activeId: id }),

      appendMessage: (sid, msg) =>
        set((s) => {
          const sess = s.sessions[sid];
          if (!sess) return s;
          const messages = [...sess.messages, msg];
          // Auto-derive title from first user message if still "New chat"
          const title =
            sess.title === 'New chat' && msg.role === 'user'
              ? msg.content.slice(0, 40).replace(/\n/g, ' ')
              : sess.title;
          return {
            sessions: { ...s.sessions, [sid]: { ...sess, messages, title, updatedAt: Date.now() } },
          };
        }),

      patchLastAssistant: (sid, patch) =>
        set((s) => {
          const sess = s.sessions[sid];
          if (!sess || sess.messages.length === 0) return s;
          const last = sess.messages[sess.messages.length - 1];
          if (last.role !== 'assistant') return s;
          const updated: Message = { ...last, content: patch(last.content) };
          return {
            sessions: {
              ...s.sessions,
              [sid]: { ...sess, messages: [...sess.messages.slice(0, -1), updated], updatedAt: Date.now() },
            },
          };
        }),

      renameSession: (sid, title) =>
        set((s) => {
          const sess = s.sessions[sid];
          if (!sess) return s;
          return { sessions: { ...s.sessions, [sid]: { ...sess, title } } };
        }),

      deleteSession: (sid) =>
        set((s) => {
          const { [sid]: _, ...rest } = s.sessions;
          const nextActive = s.activeId === sid ? null : s.activeId;
          return { sessions: rest, activeId: nextActive };
        }),
    }),
    { name: 'franklin-web-chat' },
  ),
);

export function listSessionsSorted(): ChatSession[] {
  const m = useChatStore.getState().sessions;
  return Object.values(m).sort((a, b) => b.updatedAt - a.updatedAt);
}
