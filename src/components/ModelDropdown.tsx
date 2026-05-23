// Compact model picker used in the prompt bar — a button that opens a small
// popover list of models. Closes on outside-click / Escape.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface ModelOption { id: string; label: string }

interface Props {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
}

export default function ModelDropdown({ models, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value) ?? models[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="model-dropdown" ref={rootRef}>
      <button
        type="button"
        className="model-dropdown-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current?.label}
      >
        <span className="model-dropdown-label">{current?.label ?? 'Model'}</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <ul className="model-dropdown-menu" role="listbox">
          {models.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={m.id === value}
                className={`model-dropdown-item ${m.id === value ? 'is-active' : ''}`}
                onClick={() => { onChange(m.id); setOpen(false); }}
              >
                <span>{m.label}</span>
                {m.id === value && <Check size={13} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
