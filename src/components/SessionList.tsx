import { useChatStore } from '../store';
import { X, Plus } from 'lucide-react';

export default function SessionList() {
  const { sessions, activeId, setActive, newSession, deleteSession } = useChatStore();

  const sorted = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="session-list" aria-label="Chat history">
      <button className="session-new" onClick={() => newSession()} aria-label="Start new chat">
        <Plus size={14} strokeWidth={2} />
        <span>New chat</span>
      </button>
      <ul aria-label="Past chats">
        {sorted.length === 0 && <li className="session-empty">No chats yet</li>}
        {sorted.map((s) => (
          <li key={s.id} className="session-row">
            <button
              className={`session-item ${activeId === s.id ? 'active' : ''}`}
              onClick={() => setActive(s.id)}
              aria-current={activeId === s.id ? 'page' : undefined}
            >
              <span className="session-title">{s.title}</span>
            </button>
            <button
              className="session-del"
              onClick={() => {
                if (confirm('Delete this chat?')) deleteSession(s.id);
              }}
              aria-label={`Delete chat: ${s.title}`}
              title="Delete"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
