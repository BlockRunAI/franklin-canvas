// Media Agent — a right-side chat window backed by a REAL tool-calling loop.
//
// Unlike the old one-shot planner, the agent now decides its actions one at a
// time: each turn the model (via /api/agent/chat) may return tool calls; we
// execute them (canvas/media tools in-browser, the rest on the backend), feed
// the results back, and call the model again — until it stops asking for tools.
// The canvas updates live as nodes are created/chained. See agentTools.ts.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Send, X, Loader2, Check, Image as ImageIcon, Film, Music, Play, SkipForward,
  AlertTriangle, MousePointerClick, Zap, SlidersHorizontal, SquarePen, History, Trash2,
  Eye, Globe, Brain, Users, Terminal, FileText, Wallet, Wrench, HelpCircle, Square, ChevronDown,
} from 'lucide-react';
import AgentMascot from '../components/AgentMascot';
import ModelDropdown from '../components/ModelDropdown';
import { agentChat, type ChatTurn, type ToolCall } from '../api/franklin';
import { TEXT_MODELS } from './nodes';
import { useAgentPrefs, type AgentMode } from './agentPrefsStore';
import { useAgentSessions, type TraceItem, type TraceStatus } from './agentSessionsStore';
import { executeToolCall, toolLabel, estimateToolCost, CONFIRM_TOOLS, type CanvasAgentApi } from './agentTools';

const DEFAULT_AGENT_MODEL = TEXT_MODELS.find((m) => m.id === 'anthropic/claude-sonnet-4.6')?.id ?? TEXT_MODELS[0].id;
const MAX_TURNS = 24;

interface Props {
  open: boolean;
  onClose: () => void;
  api: CanvasAgentApi;
}

// Pick an icon for a tool call in the trace.
function toolIcon(name: string) {
  if (name === 'generate_image' || name === 'edit_image' || name === 'upscale_image') return ImageIcon;
  if (name === 'generate_video' || name === 'stitch_videos') return Film;
  if (name === 'generate_music') return Music;
  if (name === 'describe_media') return Eye;
  if (name === 'list_canvas') return FileText;
  if (name.startsWith('web_') || name.startsWith('exa_')) return Globe;
  if (name.startsWith('memory_')) return Brain;
  if (name === 'mixture_of_agents') return Users;
  if (name === 'bash') return Terminal;
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'glob' || name === 'grep') return FileText;
  if (name === 'ask_user') return HelpCircle;
  if (name === 'wallet_status') return Wallet;
  return Wrench;
}

export default function AgentPanel({ open, onClose, api }: Props) {
  const mode = useAgentPrefs((s) => s.mode);
  const setMode = useAgentPrefs((s) => s.setMode);
  const imageModel = useAgentPrefs((s) => s.imageModel);
  const videoModel = useAgentPrefs((s) => s.videoModel);
  const [optsOpen, setOptsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_AGENT_MODEL);

  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [running, setRunning] = useState(false);

  // Per-tool cost confirm (manual mode).
  const [confirm, setConfirm] = useState<{ label: string; cost: number } | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  // ask_user pause.
  const [awaitingAsk, setAwaitingAsk] = useState(false);
  const askResolver = useRef<((s: string) => void) | null>(null);

  // Raw OpenAI-format conversation (source of truth for the loop / API calls).
  const turnsRef = useRef<ChatTurn[]>([]);
  const stopRef = useRef(false);
  const tid = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Chat history ──
  const sessions = useAgentSessions((s) => s.sessions);
  const upsertSession = useAgentSessions((s) => s.upsert);
  const removeSession = useAgentSessions((s) => s.remove);
  const sessionId = useRef<string>(crypto.randomUUID());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Persist the active conversation as it grows.
  useEffect(() => {
    if (trace.length === 0) return;
    const title = trace.find((t) => t.kind === 'user')?.text?.slice(0, 60) || 'New chat';
    upsertSession({ id: sessionId.current, title, trace, turns: turnsRef.current, updatedAt: Date.now() });
  }, [trace, upsertSession]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [trace, confirm, awaitingAsk]);

  // React Flow's d3-zoom uses a native wheel listener; drive our own scroll and
  // preventDefault so the panel scrolls and the canvas behind it stays put.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => { el.scrollTop += e.deltaY; e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open]);

  const push = (item: Omit<TraceItem, 'id'>): number => {
    const id = tid.current++;
    setTrace((t) => [...t, { ...item, id }]);
    return id;
  };
  const patch = (id: number, p: Partial<TraceItem>) => setTrace((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const newChat = () => {
    sessionId.current = crypto.randomUUID();
    turnsRef.current = [];
    tid.current = 0;
    stopRef.current = false;
    setTrace([]); setInput(''); setRunning(false); setConfirm(null); setAwaitingAsk(false);
    confirmResolver.current = null; askResolver.current = null;
    setHistoryOpen(false);
  };

  const loadSession = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    sessionId.current = s.id;
    turnsRef.current = s.turns || [];
    tid.current = (s.trace.reduce((m, t) => Math.max(m, t.id), 0) || 0) + 1;
    setTrace(s.trace); setRunning(false); setConfirm(null); setAwaitingAsk(false);
    setHistoryOpen(false);
  };

  const askConfirm = (label: string, cost: number) => new Promise<boolean>((resolve) => {
    confirmResolver.current = resolve; setConfirm({ label, cost });
  });
  const resolveConfirm = (ok: boolean) => { setConfirm(null); confirmResolver.current?.(ok); confirmResolver.current = null; };

  // The agent's ask_user tool: surface a question and wait for the user's reply.
  const askUser = (question: string) => new Promise<string>((resolve) => {
    push({ kind: 'agent', text: question });
    askResolver.current = resolve; setAwaitingAsk(true);
  });

  const stop = () => { stopRef.current = true; setRunning(false); };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    // If the agent is waiting on an ask_user, this input answers it.
    if (askResolver.current) {
      push({ kind: 'user', text });
      const r = askResolver.current; askResolver.current = null; setAwaitingAsk(false);
      r(text);
      return;
    }
    if (running) return;
    push({ kind: 'user', text });
    turnsRef.current.push({ role: 'user', content: text });
    void runLoop();
  };

  const runLoop = async () => {
    setRunning(true);
    stopRef.current = false;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (stopRef.current) break;
        const res = await agentChat(model, turnsRef.current);
        if (!res.ok) { push({ kind: 'agent', text: `Sorry — ${res.error}` }); break; }
        const msg = res.message;
        turnsRef.current.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
        if (msg.content) push({ kind: 'agent', text: msg.content });
        const calls = msg.tool_calls || [];
        if (calls.length === 0) break; // model is done
        for (const call of calls) {
          if (stopRef.current) { turnsRef.current.push(toolMsg(call, 'Stopped by user.')); continue; }
          await runOneTool(call);
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const runOneTool = async (call: ToolCall) => {
    const name = call.function.name;
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }
    const label = toolLabel(name, input);
    const cost = estimateToolCost(name, input, { imageModel, videoModel });

    // Cost / side-effect confirm (manual mode only).
    if (mode === 'manual' && CONFIRM_TOOLS.has(name)) {
      const ok = await askConfirm(label, cost);
      if (!ok) {
        push({ kind: 'tool', tool: name, label, status: 'skipped', cost });
        turnsRef.current.push(toolMsg(call, 'User skipped this step.'));
        return;
      }
    }

    const itemId = push({ kind: 'tool', tool: name, label, status: 'running' as TraceStatus, cost });
    let output = '';
    try {
      output = await executeToolCall(name, input, { canvas: api, askUser });
    } catch (e) {
      output = `Error: ${(e as Error).message || e}`;
    }
    const isErr = /^error/i.test(output) || /failed/i.test(output.slice(0, 40));
    patch(itemId, { status: isErr ? 'error' : 'done', output });
    turnsRef.current.push(toolMsg(call, output));
  };

  const toolMsg = (call: ToolCall, content: string): ChatTurn => ({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });

  if (!open) return null;

  return createPortal(
    <aside className="agent-panel nowheel nopan nodrag" role="complementary" aria-label="Media agent">
      <header className="agent-head">
        <div className="agent-head-title">
          <AgentMascot size={22} />
          <span>Media Agent</span>
        </div>
        <div className="agent-head-actions">
          <button className="agent-head-btn" onClick={newChat} aria-label="New chat" title="New chat"><SquarePen size={17} aria-hidden /></button>
          <div className="agent-history-wrap">
            <button className="agent-head-btn" onClick={() => setHistoryOpen((v) => !v)} aria-label="Chat history" title="Chat history" aria-expanded={historyOpen}><History size={17} aria-hidden /></button>
            {historyOpen && (
              <>
                <div className="agent-history-backdrop" onClick={() => setHistoryOpen(false)} />
                <div className="agent-history-menu" role="menu">
                  <div className="agent-history-head">Conversations</div>
                  {sessions.length === 0 ? (
                    <div className="agent-history-empty">No saved chats yet.</div>
                  ) : sessions.map((s) => (
                    <div key={s.id} className={`agent-history-item ${s.id === sessionId.current ? 'is-current' : ''}`}>
                      <button className="agent-history-load" onClick={() => loadSession(s.id)}>
                        <span className="agent-history-title">{s.title}</span>
                        <span className="agent-history-meta">{s.trace.filter((t) => t.kind === 'user').length} msg · {s.trace.filter((t) => t.kind === 'tool').length} tools</span>
                      </button>
                      <button className="agent-history-del" onClick={() => removeSession(s.id)} aria-label="Delete chat"><Trash2 size={13} aria-hidden /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="agent-head-btn" onClick={onClose} aria-label="Close agent" title="Close"><X size={18} aria-hidden /></button>
        </div>
      </header>

      <div className="agent-body nowheel" ref={scrollRef}>
        {trace.length === 0 && (
          <div className="agent-intro">
            <AgentMascot size={40} />
            <p>Describe what you want to make. I'll use tools — generate, edit, animate, stitch, look at results, search the web — building it on the canvas step by step.</p>
            <div className="agent-intro-egs">
              {['A cinematic clip of a fox in a snowy forest at dawn, with a soundtrack', 'Make a portrait image, then animate it into a 9:16 TikTok video'].map((eg) => (
                <button key={eg} type="button" className="agent-eg" onClick={() => setInput(eg)}>{eg}</button>
              ))}
            </div>
          </div>
        )}

        {trace.map((t) => {
          if (t.kind === 'user') return (
            <div key={t.id} className="agent-msg agent-msg-user"><div className="agent-msg-text">{t.text}</div></div>
          );
          if (t.kind === 'agent') return (
            <div key={t.id} className="agent-msg agent-msg-agent">
              <span className="agent-msg-avatar"><AgentMascot size={16} /></span>
              <div className="agent-msg-text">{t.text}</div>
            </div>
          );
          // tool
          const Icon = toolIcon(t.tool || '');
          const isOpen = !!expanded[t.id];
          return (
            <div key={t.id} className={`agent-tool agent-tool-${t.status}`}>
              <button className="agent-tool-head" onClick={() => t.output && setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }))}>
                <span className="agent-tool-icon"><Icon size={14} aria-hidden /></span>
                <span className="agent-tool-label">{t.label}</span>
                {t.cost ? <span className="agent-tool-cost">${t.cost.toFixed(2)}</span> : null}
                <span className="agent-tool-status">
                  {t.status === 'running' && <Loader2 size={14} className="agent-spin" aria-hidden />}
                  {t.status === 'done' && <Check size={14} className="agent-ok" aria-hidden />}
                  {t.status === 'error' && <AlertTriangle size={14} className="agent-err" aria-hidden />}
                  {t.status === 'skipped' && <span className="agent-skip-tag">skipped</span>}
                  {t.output ? <ChevronDown size={13} className={`agent-tool-chev ${isOpen ? 'is-open' : ''}`} aria-hidden /> : null}
                </span>
              </button>
              {isOpen && t.output && <pre className="agent-tool-output">{t.output}</pre>}
            </div>
          );
        })}

        {running && !confirm && !awaitingAsk && (
          <div className="agent-msg agent-msg-agent">
            <span className="agent-msg-avatar"><AgentMascot size={16} /></span>
            <div className="agent-msg-text agent-thinking"><Loader2 size={13} className="agent-spin" aria-hidden /> Thinking…</div>
          </div>
        )}

        {confirm && (
          <div className="agent-step-confirm">
            <span>Run <strong>{confirm.label}</strong>{confirm.cost ? <> for <strong>${confirm.cost.toFixed(2)}</strong></> : null}?</span>
            <div className="agent-step-confirm-btns">
              <button className="agent-skip-btn" onClick={() => resolveConfirm(false)}><SkipForward size={13} aria-hidden /> Skip</button>
              <button className="agent-go-btn" onClick={() => resolveConfirm(true)}><Play size={13} aria-hidden /> Run</button>
            </div>
          </div>
        )}
      </div>

      <div className="agent-composer">
        <textarea
          className="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={awaitingAsk ? 'Answer the agent…' : running ? 'Agent is working…' : 'Describe what to create…'}
          rows={2}
          aria-label="Message the agent"
        />
        <div className="agent-composer-bar">
          <div className="agent-opts-wrap">
            <button type="button" className={`agent-opts-btn ${optsOpen ? 'is-active' : ''}`} onClick={() => setOptsOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={optsOpen} aria-label="Run mode and model" title="Run mode & model"><SlidersHorizontal size={16} aria-hidden /></button>
            {optsOpen && (
              <>
                <div className="agent-opts-backdrop" onClick={() => setOptsOpen(false)} />
                <div className="agent-opts-pop" role="dialog" aria-label="Agent options">
                  <div className="agent-opts-label">Run mode</div>
                  {([
                    { id: 'manual', Icon: MousePointerClick, title: 'Manual confirm', desc: 'Ask before each paid / file action' },
                    { id: 'auto', Icon: Zap, title: 'Auto run', desc: 'Run the whole workflow autonomously' },
                  ] as { id: AgentMode; Icon: typeof Zap; title: string; desc: string }[]).map((opt) => (
                    <button key={opt.id} type="button" className={`agent-mode-opt ${mode === opt.id ? 'is-on' : ''}`} onClick={() => setMode(opt.id)}>
                      <opt.Icon size={16} className="agent-mode-opt-icon" aria-hidden />
                      <span className="agent-mode-opt-text">
                        <span className="agent-mode-opt-title">{opt.title}</span>
                        <span className="agent-mode-opt-desc">{opt.desc}</span>
                      </span>
                      {mode === opt.id && <Check size={15} aria-hidden />}
                    </button>
                  ))}
                  <div className="agent-opts-label">Agent model</div>
                  <ModelDropdown models={TEXT_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={model} onChange={setModel} />
                </div>
              </>
            )}
          </div>
          <div className="agent-composer-spacer" />
          {running ? (
            <button className="agent-send agent-stop" onClick={stop} aria-label="Stop"><Square size={15} aria-hidden /></button>
          ) : (
            <button className="agent-send" onClick={send} disabled={!input.trim()} aria-label="Send"><Send size={16} aria-hidden /></button>
          )}
        </div>
      </div>
    </aside>,
    document.body,
  );
}
