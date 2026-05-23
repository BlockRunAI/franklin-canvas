import { useState, useRef, useEffect } from 'react';
import type { Message } from '../types';
import { streamChat } from '../api/franklin';
import { useChatStore } from '../store';
import SessionList from '../components/SessionList';
import Markdown from '../components/Markdown';

export default function ChatView() {
  const { activeId, sessions, newSession, appendMessage, patchLastAssistant } = useChatStore();
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = activeId ? sessions[activeId] : null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const send = () => {
    if (!input.trim() || streaming) return;
    const sid = activeId ?? newSession();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    appendMessage(sid, userMsg);
    appendMessage(sid, assistantMsg);
    setInput('');
    setStreaming(true);

    abortRef.current = streamChat(sid, input, {
      onToken: (token) => patchLastAssistant(sid, (cur) => cur + token),
      onDone: () => setStreaming(false),
      onError: (err) => {
        appendMessage(sid, {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Error: ${err.message}`,
          timestamp: Date.now(),
        });
        setStreaming(false);
      },
    });
  };

  const stop = () => {
    abortRef.current?.();
    setStreaming(false);
  };

  return (
    <div className="chat-layout">
      <SessionList />
      <div className="chat">
        <div
          className="chat-scroll"
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {messages.length === 0 && (
            <div className="chat-empty">
              <h2>Franklin</h2>
              <p>The AI agent with a wallet. Ask anything — code, trade, generate.</p>
              <div className="chat-suggestions">
                <button onClick={() => setInput('Generate an image of a Franklin lobster in cyberpunk style')}>
                  🎨 Generate an image…
                </button>
                <button onClick={() => setInput("What's my BTC position?")}>
                  📈 What&apos;s my BTC position?
                </button>
                <button onClick={() => setInput('Refactor the auth middleware in this repo')}>
                  💻 Refactor a file…
                </button>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`msg msg-${msg.role}`}>
              <div className="msg-bubble">
                {msg.role === 'assistant' ? (
                  msg.content ? <Markdown source={msg.content} /> : <span className="dim">…</span>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
        </div>
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="chat-input" className="visually-hidden">Message</label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message…  (Enter to send, Shift+Enter newline)"
            rows={2}
            aria-label="Message"
          />
          {streaming ? (
            <button type="button" onClick={stop} className="btn-stop">Stop</button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn-send">Send</button>
          )}
        </form>
      </div>
    </div>
  );
}
