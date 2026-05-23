// Settings modal for franklin-canvas. Wallet-based (pay-per-call USDC via
// x402), so the panes are: Wallet (live balance + spend from the daemon),
// Models (the BlockRun catalog with per-call pricing), Canvas (appearance),
// and About. Centered modal with a left rail + detail pane.

import { useEffect, useState, type ReactNode } from 'react';
import {
  X, Wallet, Boxes, Info, Copy, Check, ExternalLink, SlidersHorizontal, type LucideIcon,
} from 'lucide-react';
import { getWallet } from '../api/franklin';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS, TEXT_MODELS } from './nodes';
import { usePrefsStore, type EdgeStyle } from './prefsStore';
import type { WalletInfo } from '../types';

type SectionId = 'wallet' | 'models' | 'canvas' | 'about';

interface NavItem { id: SectionId; label: string; icon: LucideIcon; }

const NAV: NavItem[] = [
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'models', label: 'Models & pricing', icon: Boxes },
  { id: 'canvas', label: 'Canvas', icon: SlidersHorizontal },
  { id: 'about',  label: 'About', icon: Info },
];

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: SectionId;
}

function WalletPane() {
  const [w, setW] = useState<WalletInfo | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWallet().then((res) => { if (!cancelled) setW(res); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, []);

  const copy = () => {
    if (!w?.address) return;
    void navigator.clipboard.writeText(w.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (err) return <div className="settings-stub"><h2>Wallet</h2><p>Couldn't reach the Franklin daemon. Is it running on :3100?</p></div>;
  if (!w) return <div className="settings-stub"><h2>Wallet</h2><p>Loading wallet…</p></div>;

  const short = w.address ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : '—';

  return (
    <div className="settings-pane-section">
      <h2>Wallet</h2>
      <div className="settings-balance">
        <span className="settings-balance-num">${w.balanceUsdc.toFixed(2)}</span>
        <span className="settings-balance-unit">USDC on {w.network}</span>
      </div>
      <dl className="settings-kv">
        <div>
          <dt>Address</dt>
          <dd>
            <code>{short}</code>
            <button className="settings-copy" type="button" onClick={copy} aria-label="Copy address">
              {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            </button>
          </dd>
        </div>
        <div><dt>Spent (24h)</dt><dd>${w.recentSpendUsd.toFixed(2)}</dd></div>
      </dl>
      {w.spendByCategory?.length > 0 && (
        <>
          <h3 className="settings-subhead">Spend by model</h3>
          <ul className="settings-spend">
            {w.spendByCategory.slice(0, 8).map((s) => (
              <li key={s.category}>
                <span className="settings-spend-cat">{s.category}</span>
                <span className="settings-spend-usd">${s.usd.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="settings-foot-note">Top up by sending USDC on Base to the address above. Every generation is paid live per call — no subscription.</p>
    </div>
  );
}

function ModelsPane() {
  const groups: { name: string; rows: { id: string; label: string; price: string }[] }[] = [
    { name: 'Image', rows: IMAGE_MODELS.map((m) => ({ id: m.id, label: m.label, price: `$${m.price.toFixed(3)} / image` })) },
    { name: 'Video', rows: VIDEO_MODELS.map((m) => ({ id: m.id, label: m.label, price: `$${m.pricePerS.toFixed(2)} / sec` })) },
    { name: 'Music', rows: MUSIC_MODELS.map((m) => ({ id: m.id, label: m.label, price: `$${m.price.toFixed(3)} / track` })) },
    { name: 'Text',  rows: TEXT_MODELS.map((m) => ({ id: m.id, label: m.label, price: `$${m.priceK.toFixed(4)} / 1k tok` })) },
  ];
  return (
    <div className="settings-pane-section">
      <h2>Models &amp; pricing</h2>
      <p className="settings-foot-note">Live catalog served through the BlockRun gateway. Prices are charged per call in USDC.</p>
      {groups.map((g) => (
        <div key={g.name} className="settings-model-group">
          <h3 className="settings-subhead">{g.name}</h3>
          <ul className="settings-model-list">
            {g.rows.map((r) => (
              <li key={r.id} className="settings-model-row">
                <span className="settings-model-label">{r.label}</span>
                <span className="settings-model-price">{r.price}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CanvasPane() {
  const edgeStyle = usePrefsStore((s) => s.edgeStyle);
  const setEdgeStyle = usePrefsStore((s) => s.setEdgeStyle);
  const options: { id: EdgeStyle; label: string; hint: string }[] = [
    { id: 'animated', label: 'Animated', hint: 'A light pulse flows along each connection (lively).' },
    { id: 'solid', label: 'Solid', hint: 'A static lime gradient — calm, still on-brand.' },
    { id: 'subtle', label: 'Subtle', hint: 'A thin neutral line — minimal, no gradient.' },
  ];
  return (
    <div className="settings-pane-section">
      <h2>Canvas</h2>
      <h3 className="settings-subhead">Connection lines</h3>
      <div className="settings-choices">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`settings-choice ${edgeStyle === o.id ? 'is-active' : ''}`}
            onClick={() => setEdgeStyle(o.id)}
          >
            <span className="settings-choice-label">{o.label}</span>
            <span className="settings-choice-hint">{o.hint}</span>
          </button>
        ))}
      </div>
      <p className="settings-foot-note">Applies to every connection on the canvas, instantly.</p>
    </div>
  );
}

function AboutPane() {
  return (
    <div className="settings-pane-section">
      <h2>About</h2>
      <p className="settings-foot-note">
        Franklin Canvas — a node-based AI media studio. Generate images, video and music on an
        infinite canvas, paid live in USDC via x402 through the BlockRun gateway.
      </p>
      <dl className="settings-kv">
        <div><dt>Version</dt><dd>0.0.1</dd></div>
        <div><dt>Gateway</dt><dd>BlockRun (Base · x402)</dd></div>
      </dl>
      <div className="settings-links">
        <a href="https://github.com/BlockRunAI/franklin-canvas" target="_blank" rel="noopener noreferrer">
          Repository <ExternalLink size={12} aria-hidden />
        </a>
        <a href="https://github.com/BlockRunAI/Franklin" target="_blank" rel="noopener noreferrer">
          Franklin core <ExternalLink size={12} aria-hidden />
        </a>
      </div>
    </div>
  );
}

const PANES: Record<SectionId, ReactNode> = {
  wallet: <WalletPane />,
  models: <ModelsPane />,
  canvas: <CanvasPane />,
  about: <AboutPane />,
};

export default function SettingsDialog({ open, onClose, initial = 'wallet' }: Props) {
  const [active, setActive] = useState<SectionId>(initial);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="settings-rail">
          <div className="settings-rail-head">
            <h2>Settings</h2>
          </div>
          <div className="settings-rail-items">
            {NAV.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`settings-rail-item ${active === it.id ? 'is-active' : ''}`}
                  onClick={() => setActive(it.id)}
                >
                  <Icon size={15} aria-hidden />
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="settings-pane">
          <header className="settings-pane-head">
            <span className="settings-version">v0.0.1</span>
            <button className="settings-close" onClick={onClose} aria-label="Close settings">
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="settings-pane-body">{PANES[active]}</div>
        </main>
      </div>
    </div>
  );
}
