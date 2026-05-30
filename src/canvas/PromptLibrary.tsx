// Prompt library — a searchable gallery of curated prompt cases from the
// BlockRun case-library. The INDEX gives titles + metadata for all ~848
// cases in one fetch; each card then lazily loads its own prompt body +
// preview image (via IntersectionObserver) only when it scrolls into view,
// so we get the full image+prompt look without pulling hundreds of files.

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Copy, Check, Sparkles, Wand2, Loader2, ImageIcon, ExternalLink } from 'lucide-react';
import { listPrompts, getPromptDetail, type PromptItem } from '../api/franklin';

interface Props {
  open: boolean;
  onClose: () => void;
  onUse: (prompt: string) => void;
}

// Module-level cache so re-renders / filtering never refetch a case detail.
const detailCache = new Map<string, { prompt: string; image?: string }>();

function PromptCard({
  item, onUse, onClose,
}: { item: PromptItem; onUse: (p: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const [detail, setDetail] = useState<{ prompt: string; image?: string } | null>(
    item.path ? detailCache.get(item.path) ?? null : { prompt: item.prompt, image: item.image },
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Lazy-load this card's detail when it scrolls into view.
  useEffect(() => {
    if (detail || !item.path) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        getPromptDetail(item.path!)
          .then((d) => { detailCache.set(item.path!, d); setDetail(d); })
          .catch(() => { /* leave as skeleton */ });
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [item.path, detail]);

  const use = async () => {
    if (detail?.prompt) { onUse(detail.prompt); onClose(); return; }
    if (!item.path) return;
    setBusy(true);
    try {
      const d = detailCache.get(item.path) ?? await getPromptDetail(item.path);
      detailCache.set(item.path, d);
      if (d.prompt) { onUse(d.prompt); onClose(); }
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  const copy = async () => {
    const text = detail?.prompt || (item.path ? (detailCache.get(item.path) ?? await getPromptDetail(item.path)).prompt : '');
    if (text) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <li ref={ref} className="prompt-card">
      <div className="prompt-card-cover">
        {detail?.image
          ? <img src={detail.image} alt="" loading="lazy" onError={(e) => { (e.currentTarget.style.display = 'none'); }} />
          : <div className="prompt-card-cover-ph"><ImageIcon size={20} strokeWidth={1.4} aria-hidden /></div>}
      </div>
      <div className="prompt-card-body">
        <div className="prompt-card-title" title={item.title}>{item.title}</div>
        {detail
          ? <div className="prompt-card-text">{detail.prompt || '—'}</div>
          : <div className="prompt-card-text prompt-card-text-loading">Loading…</div>}
        <div className="prompt-card-tags">
          {item.workflow && <span className="prompt-tag prompt-tag-wf">{item.workflow}</span>}
          {item.tags?.slice(0, 3).map((t) => <span key={t} className="prompt-tag">{t}</span>)}
        </div>
      </div>
      <div className="prompt-card-actions">
        <span className="prompt-card-cat">{item.model || item.source}</span>
        <span className="prompt-card-btns">
          <button onClick={copy} aria-label="Copy prompt" title="Copy">
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          </button>
          <button className="prompt-card-use" onClick={use} disabled={busy} title="Use on canvas">
            {busy ? <Loader2 size={13} className="media-spin" aria-hidden /> : <Wand2 size={13} aria-hidden />} Use
          </button>
        </span>
      </div>
    </li>
  );
}

type Workflow = 'all' | 'text2image' | 'image2image' | 'text2video' | 'image2video';
const WORKFLOW_LABELS: Record<Exclude<Workflow, 'all'>, string> = {
  text2image: 'Text → Image',
  image2image: 'Image → Image',
  text2video: 'Text → Video',
  image2video: 'Image → Video',
};

export default function PromptLibrary({ open, onClose, onUse }: Props) {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [workflow, setWorkflow] = useState<Workflow>('all');
  const [tag, setTag] = useState<string>('all');

  useEffect(() => {
    if (!open || items) return;
    listPrompts().then(setItems).catch(() => setErr(true));
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Counts per workflow (for the top-row chips).
  const workflowCounts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length ?? 0, text2image: 0, image2image: 0, text2video: 0, image2video: 0 };
    for (const it of items ?? []) if (it.workflow && c[it.workflow] != null) c[it.workflow]++;
    return c;
  }, [items]);

  // Tag chips for the second row — restricted to the currently selected workflow.
  const tags = useMemo(() => {
    if (!items) return [];
    const pool = workflow === 'all' ? items : items.filter((it) => it.workflow === workflow);
    const counts = new Map<string, number>();
    for (const it of pool) for (const t of (it.tags ?? [])) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  }, [items, workflow]);

  // Reset tag when switching workflow so a stale tag from another workflow
  // doesn't blank the results.
  useEffect(() => { setTag('all'); }, [workflow]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (workflow !== 'all' && it.workflow !== workflow) return false;
      if (tag !== 'all' && !it.tags?.includes(tag)) return false;
      if (!needle) return true;
      return it.title.toLowerCase().includes(needle) || it.tags?.some((t) => t.includes(needle));
    }).slice(0, 120); // render cap; lazy loading means only visible cards fetch
  }, [items, q, workflow, tag]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="prompt-lib" role="dialog" aria-modal="true" aria-label="Prompt library" onClick={(e) => e.stopPropagation()}>
        <header className="prompt-lib-head">
          <div className="prompt-lib-title"><Sparkles size={16} aria-hidden /> Prompt library</div>
          <div className="prompt-lib-search">
            <Search size={14} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts…" aria-label="Search prompts" />
          </div>
          <button className="settings-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
        </header>

        {/* Row 1 — workflow (the "what am I trying to do") */}
        {items && items.length > 0 && (
          <div className="prompt-lib-cats prompt-lib-wf">
            <button className={`prompt-cat ${workflow === 'all' ? 'is-active' : ''}`} onClick={() => setWorkflow('all')}>
              All <span className="prompt-cat-count">{workflowCounts.all}</span>
            </button>
            {(Object.keys(WORKFLOW_LABELS) as (keyof typeof WORKFLOW_LABELS)[]).map((w) => (
              <button key={w} className={`prompt-cat ${workflow === w ? 'is-active' : ''}`} onClick={() => setWorkflow(w)}>
                {WORKFLOW_LABELS[w]} <span className="prompt-cat-count">{workflowCounts[w]}</span>
              </button>
            ))}
          </div>
        )}
        {/* Row 2 — tags (refine within the chosen workflow) */}
        {tags.length > 0 && (
          <div className="prompt-lib-cats prompt-lib-tags">
            <button className={`prompt-cat prompt-cat-tag ${tag === 'all' ? 'is-active' : ''}`} onClick={() => setTag('all')}>All tags</button>
            {tags.map(([t, n]) => (
              <button key={t} className={`prompt-cat prompt-cat-tag ${tag === t ? 'is-active' : ''}`} onClick={() => setTag(t)}>
                {t} <span className="prompt-cat-count">{n}</span>
              </button>
            ))}
          </div>
        )}

        <div className="prompt-lib-body">
          {err ? (
            <div className="prompt-lib-empty">Couldn't load prompts. Is the backend running on :3100?</div>
          ) : !items ? (
            <div className="prompt-lib-empty">Loading prompts…</div>
          ) : filtered.length === 0 ? (
            <div className="prompt-lib-empty">No prompts match “{q}”.</div>
          ) : (
            <ul className="prompt-grid">
              {filtered.map((it) => (
                <PromptCard key={it.id} item={it} onUse={onUse} onClose={onClose} />
              ))}
            </ul>
          )}
        </div>
        <footer className="prompt-lib-foot">
          Sourced from the open{' '}
          <a
            href="https://github.com/BlockRunAI/Claude-Code-GPT-IMAGE2-SeeDance-BlockRun"
            target="_blank"
            rel="noopener noreferrer"
          >
            BlockRunAI case-library <ExternalLink size={11} aria-hidden />
          </a>{' '}
          on GitHub. Cases load on demand from the upstream repo — credit goes to the original authors.
        </footer>
      </div>
    </div>
  );
}
