// Prompt library — a gallery of ready-made image prompts scraped server-side
// from public GitHub "awesome prompts" repos (see server.mjs /api/prompts).
// Solves the blank-canvas problem: search/filter, then "Use" drops an image
// node pre-filled with the prompt, or "Copy" puts it on the clipboard.

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Copy, Check, Sparkles, Wand2 } from 'lucide-react';
import { listPrompts, type PromptItem } from '../api/franklin';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Create an image node seeded with this prompt and select it. */
  onUse: (prompt: string) => void;
}

export default function PromptLibrary({ open, onClose, onUse }: Props) {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const categories = useMemo(() => {
    if (!items) return [];
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.category, (counts.get(it.category) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (cat !== 'all' && it.category !== cat) return false;
      if (!needle) return true;
      return (
        it.title.toLowerCase().includes(needle) ||
        (it.titleCn || '').includes(q.trim()) ||
        it.prompt.toLowerCase().includes(needle)
      );
    });
  }, [items, q, cat]);

  const copy = (it: PromptItem) => {
    void navigator.clipboard.writeText(it.prompt);
    setCopiedId(it.id);
    setTimeout(() => setCopiedId((c) => (c === it.id ? null : c)), 1500);
  };

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

        {categories.length > 0 && (
          <div className="prompt-lib-cats">
            <button className={`prompt-cat ${cat === 'all' ? 'is-active' : ''}`} onClick={() => setCat('all')}>All</button>
            {categories.map((c) => (
              <button key={c} className={`prompt-cat ${cat === c ? 'is-active' : ''}`} onClick={() => setCat(c)}>{c}</button>
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
                <li key={it.id} className="prompt-card">
                  {it.image && (
                    <div className="prompt-card-cover">
                      <img src={it.image} alt="" loading="lazy" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                    </div>
                  )}
                  <div className="prompt-card-body">
                    <div className="prompt-card-title" title={it.titleCn || it.title}>{it.title}</div>
                    <div className="prompt-card-text">{it.prompt}</div>
                  </div>
                  <div className="prompt-card-actions">
                    <span className="prompt-card-cat">{it.category}{it.needsRef ? ' · needs ref' : ''}</span>
                    <span className="prompt-card-btns">
                      <button onClick={() => copy(it)} aria-label="Copy prompt" title="Copy">
                        {copiedId === it.id ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                      </button>
                      <button className="prompt-card-use" onClick={() => { onUse(it.prompt); onClose(); }} title="Use on canvas">
                        <Wand2 size={13} aria-hidden /> Use
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
