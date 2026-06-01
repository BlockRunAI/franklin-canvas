// Media agent — a right-side chat window. Describe what you want to create; the
// agent plans a media workflow (image → video → music …), then builds it on the
// canvas node-by-node and runs each generation after a per-step cost confirm.
//
// The agent itself is "plan + visualize execute": the backend returns a step
// plan, and this panel orchestrates building/running it on the canvas via the
// createStep / runStep callbacks CanvasView passes in.

import { useEffect, useRef, useState } from 'react';
import { Send, X, Loader2, Check, Image as ImageIcon, Film, Music, Wand2, Play, SkipForward, AlertTriangle, MousePointerClick, Zap, SlidersHorizontal } from 'lucide-react';
import AgentMascot from '../components/AgentMascot';
import ModelDropdown from '../components/ModelDropdown';
import { agentPlan, type PlanStep, type AgentMsg } from '../api/franklin';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS, TEXT_MODELS } from './nodes';
import { useAgentPrefs, type AgentMode } from './agentPrefsStore';

const DEFAULT_AGENT_MODEL = TEXT_MODELS.find((m) => m.id === 'anthropic/claude-sonnet-4.6')?.id ?? TEXT_MODELS[0].id;

interface Props {
  open: boolean;
  onClose: () => void;
  createStep: (step: PlanStep, fromNodeId: string | null, index: number) => string;
  runStep: (nodeId: string, step: PlanStep, prevResultUrl?: string) => Promise<{ ok: boolean; resultUrl?: string; error?: string }>;
}

type ExecStatus = 'pending' | 'awaiting' | 'running' | 'done' | 'error' | 'skipped';
interface ExecStep { nodeId?: string; status: ExecStatus; resultUrl?: string; error?: string }
interface Bubble { id: number; role: 'user' | 'agent'; text: string }

const STEP_ICON = { imagegen: ImageIcon, videogen: Film, musicgen: Music } as const;

// Cost uses the agent's configured image/video models (what actually runs),
// not the planner's per-step suggestion.
function stepCostUsd(step: PlanStep, imageModel: string, videoModel: string): number {
  if (step.type === 'imagegen') return (IMAGE_MODELS.find((m) => m.id === imageModel) ?? IMAGE_MODELS[0]).price;
  if (step.type === 'videogen') return (VIDEO_MODELS.find((m) => m.id === videoModel) ?? VIDEO_MODELS[1]).pricePerS * (step.durationS ?? 5);
  return (MUSIC_MODELS.find((m) => m.id === step.model) ?? MUSIC_MODELS[0]).price;
}

export default function AgentPanel({ open, onClose, createStep, runStep }: Props) {
  const mode = useAgentPrefs((s) => s.mode);
  const setMode = useAgentPrefs((s) => s.setMode);
  const imageModel = useAgentPrefs((s) => s.imageModel);
  const videoModel = useAgentPrefs((s) => s.videoModel);
  const [optsOpen, setOptsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(DEFAULT_AGENT_MODEL);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<{ steps: PlanStep[] } | null>(null);
  const [exec, setExec] = useState<ExecStep[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [awaiting, setAwaiting] = useState(false);

  const bid = useRef(0);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [bubbles, exec, awaiting]);

  const pushBubble = (role: 'user' | 'agent', text: string) => setBubbles((b) => [...b, { id: bid.current++, role, text }]);

  const send = async () => {
    const text = input.trim();
    if (!text || thinking || running) return;
    setInput('');
    pushBubble('user', text);
    setThinking(true);
    const history: AgentMsg[] = bubbles.map((b) => ({ role: b.role === 'user' ? 'user' : 'assistant', content: b.text }));
    const res = await agentPlan(text, history, model);
    setThinking(false);
    if (!res.ok) { pushBubble('agent', `Sorry — I couldn't plan that: ${res.error}`); return; }
    pushBubble('agent', res.message);
    if (res.steps.length) {
      setPlan({ steps: res.steps });
      setExec(res.steps.map(() => ({ status: 'pending' })));
    } else {
      setPlan(null); setExec([]);
    }
  };

  const updateExec = (i: number, patch: Partial<ExecStep>) => setExec((e) => e.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const askConfirm = () => new Promise<boolean>((resolve) => { confirmResolver.current = resolve; setAwaiting(true); });
  const resolveConfirm = (ok: boolean) => { setAwaiting(false); confirmResolver.current?.(ok); confirmResolver.current = null; };

  const runWorkflow = async () => {
    if (!plan || running) return;
    setRunning(true);
    const idByStep: Record<string, string> = {};
    const urlByStep: Record<string, string> = {};
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      setCurrent(i);
      const fromNodeId = step.from ? idByStep[step.from] ?? null : null;
      const nodeId = createStep(step, fromNodeId, i);
      idByStep[step.id] = nodeId;
      // Auto mode runs each step immediately; manual mode asks first.
      const ok = mode === 'auto' ? true : (updateExec(i, { status: 'awaiting' }), await askConfirm());
      if (!ok) { updateExec(i, { status: 'skipped' }); continue; }
      updateExec(i, { status: 'running' });
      const prevUrl = step.from ? urlByStep[step.from] : undefined;
      const res = await runStep(nodeId, step, prevUrl);
      if (res.ok && res.resultUrl) { urlByStep[step.id] = res.resultUrl; updateExec(i, { status: 'done', resultUrl: res.resultUrl }); }
      else updateExec(i, { status: 'error', error: res.error });
    }
    setCurrent(-1);
    setRunning(false);
    pushBubble('agent', 'Workflow finished — your nodes are on the canvas. Tell me what to tweak, or describe another idea.');
  };

  if (!open) return null;

  const totalCost = plan ? plan.steps.reduce((s, st) => s + stepCostUsd(st, imageModel, videoModel), 0) : 0;
  const started = exec.some((e) => e.status !== 'pending');

  return (
    <aside className="agent-panel" role="complementary" aria-label="Media agent">
      <header className="agent-head">
        <div className="agent-head-title">
          <AgentMascot size={22} />
          <span>Media Agent</span>
        </div>
        <button className="agent-close" onClick={onClose} aria-label="Close agent"><X size={18} aria-hidden /></button>
      </header>

      <div className="agent-body" ref={scrollRef}>
        {bubbles.length === 0 && (
          <div className="agent-intro">
            <AgentMascot size={40} />
            <p>Describe a video (or image / music) you want, and I'll plan a workflow and build it on the canvas step by step.</p>
            <div className="agent-intro-egs">
              {['A cinematic clip of a fox in a snowy forest at dawn', 'Turn a neon cyberpunk city photo into a flythrough video'].map((eg) => (
                <button key={eg} type="button" className="agent-eg" onClick={() => setInput(eg)}>{eg}</button>
              ))}
            </div>
          </div>
        )}

        {bubbles.map((b) => (
          <div key={b.id} className={`agent-msg agent-msg-${b.role}`}>
            {b.role === 'agent' && <span className="agent-msg-avatar"><AgentMascot size={16} /></span>}
            <div className="agent-msg-text">{b.text}</div>
          </div>
        ))}

        {thinking && (
          <div className="agent-msg agent-msg-agent">
            <span className="agent-msg-avatar"><AgentMascot size={16} /></span>
            <div className="agent-msg-text agent-thinking"><Loader2 size={13} className="agent-spin" aria-hidden /> Planning the workflow…</div>
          </div>
        )}

        {/* Workflow card */}
        {plan && (
          <div className="agent-plan">
            <div className="agent-plan-head">
              <span>Workflow · {plan.steps.length} steps</span>
              {!started && <span className="agent-plan-cost">~${totalCost.toFixed(2)}</span>}
            </div>
            <ol className="agent-steps">
              {plan.steps.map((step, i) => {
                const e = exec[i] ?? { status: 'pending' as ExecStatus };
                const Icon = STEP_ICON[step.type];
                const fromIdx = step.from ? plan.steps.findIndex((s) => s.id === step.from) : -1;
                return (
                  <li key={step.id} className={`agent-step agent-step-${e.status}`}>
                    <div className="agent-step-main">
                      <span className="agent-step-icon"><Icon size={14} aria-hidden /></span>
                      <div className="agent-step-info">
                        <div className="agent-step-title">
                          {step.title || step.type}
                          {fromIdx >= 0 && <span className="agent-step-from">← step {fromIdx + 1}</span>}
                        </div>
                        <div className="agent-step-prompt">{step.prompt}</div>
                      </div>
                      <span className="agent-step-status">
                        {e.status === 'done' && <Check size={15} className="agent-ok" aria-hidden />}
                        {e.status === 'running' && <Loader2 size={15} className="agent-spin" aria-hidden />}
                        {e.status === 'error' && <AlertTriangle size={15} className="agent-err" aria-hidden />}
                        {e.status === 'skipped' && <span className="agent-skip-tag">skipped</span>}
                        {(e.status === 'pending' || e.status === 'awaiting') && <span className="agent-step-cost">${stepCostUsd(step, imageModel, videoModel).toFixed(2)}</span>}
                      </span>
                    </div>
                    {/* per-step confirm */}
                    {awaiting && current === i && (
                      <div className="agent-step-confirm">
                        <span>Generate this step for <strong>${stepCostUsd(step, imageModel, videoModel).toFixed(2)}</strong>?</span>
                        <div className="agent-step-confirm-btns">
                          <button className="agent-skip-btn" onClick={() => resolveConfirm(false)}><SkipForward size={13} aria-hidden /> Skip</button>
                          <button className="agent-go-btn" onClick={() => resolveConfirm(true)}><Play size={13} aria-hidden /> Generate</button>
                        </div>
                      </div>
                    )}
                    {e.status === 'error' && e.error && <div className="agent-step-err">{e.error}</div>}
                  </li>
                );
              })}
            </ol>
            {!started && (
              <button className="agent-run-btn" onClick={runWorkflow} disabled={running}>
                <Wand2 size={15} aria-hidden /> Build & run on canvas
              </button>
            )}
          </div>
        )}
      </div>

      <div className="agent-composer">
        <textarea
          className="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={running ? 'Workflow running…' : 'Describe what to create…'}
          rows={2}
          disabled={running}
          aria-label="Message the agent"
        />
        <div className="agent-composer-bar">
          <div className="agent-opts-wrap">
            <button
              type="button"
              className={`agent-opts-btn ${optsOpen ? 'is-active' : ''}`}
              onClick={() => setOptsOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={optsOpen}
              aria-label="Run mode and planner model"
              title="Run mode & planner model"
            >
              <SlidersHorizontal size={16} aria-hidden />
            </button>
            {optsOpen && (
              <>
                <div className="agent-opts-backdrop" onClick={() => setOptsOpen(false)} />
                <div className="agent-opts-pop" role="dialog" aria-label="Agent options">
                  <div className="agent-opts-label">Run mode</div>
                  {([
                    { id: 'manual', Icon: MousePointerClick, title: 'Manual confirm', desc: 'The agent asks before each generation' },
                    { id: 'auto', Icon: Zap, title: 'Auto run', desc: 'The agent plans and runs the workflow on its own' },
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
                  <div className="agent-opts-label">Planner model</div>
                  <ModelDropdown models={TEXT_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={model} onChange={setModel} />
                </div>
              </>
            )}
          </div>
          <div className="agent-composer-spacer" />
          <button className="agent-send" onClick={send} disabled={!input.trim() || thinking || running} aria-label="Send">
            {thinking ? <Loader2 size={16} className="agent-spin" aria-hidden /> : <Send size={16} aria-hidden />}
          </button>
        </div>
      </div>
    </aside>
  );
}
