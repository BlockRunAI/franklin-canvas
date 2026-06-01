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
import { useThemeStore, type Theme } from './themeStore';
import { useLocaleStore, useT, LOCALES, type Locale, type StringKey } from '../i18n';
import type { WalletInfo, WalletChain } from '../types';

type SectionId = 'wallet' | 'models' | 'canvas' | 'about';

interface NavItem { id: SectionId; labelKey: StringKey; icon: LucideIcon; }

const NAV: NavItem[] = [
  { id: 'wallet', labelKey: 'settings_section_wallet', icon: Wallet },
  { id: 'models', labelKey: 'settings_section_models', icon: Boxes },
  { id: 'canvas', labelKey: 'settings_section_canvas', icon: SlidersHorizontal },
  { id: 'about',  labelKey: 'settings_section_about',  icon: Info },
];

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: SectionId;
}

function WalletPane() {
  const [chain, setChain] = useState<WalletChain>('base');
  const [w, setW] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);

  // Refetch whenever the chain switch changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(false);
    getWallet(chain)
      .then((res) => { if (!cancelled) { setW(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setErr(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [chain]);

  const copy = () => {
    if (!w?.address) return;
    void navigator.clipboard.writeText(w.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chainOptions: { id: WalletChain; label: string; hint: string }[] = [
    { id: 'base', label: 'Base', hint: 'USDC on Base (EVM)' },
    { id: 'solana', label: 'Solana', hint: 'USDC on Solana' },
  ];

  const chainSwitch = (
    <div className="wallet-chain-switch" role="tablist" aria-label="Settlement chain">
      {chainOptions.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={chain === o.id}
          className={`wallet-chain-tab ${chain === o.id ? 'is-active' : ''}`}
          onClick={() => setChain(o.id)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  if (err) return (
    <div className="settings-pane-section">
      <h2>Wallet</h2>
      {chainSwitch}
      <p className="settings-foot-note">Couldn't reach the Franklin daemon. Is it running on :3100?</p>
    </div>
  );
  if (loading || !w) return (
    <div className="settings-pane-section">
      <h2>Wallet</h2>
      {chainSwitch}
      <p className="settings-foot-note">Loading {chain === 'solana' ? 'Solana' : 'Base'} wallet…</p>
    </div>
  );

  const short = w.address ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : '—';
  const isEmpty = !w.address;

  return (
    <div className="settings-pane-section">
      <h2>Wallet</h2>
      {chainSwitch}
      {isEmpty ? (
        <p className="settings-foot-note">
          No {chain === 'solana' ? 'Solana' : 'Base'} wallet configured. Save a
          key to <code>{chain === 'solana' ? '~/.blockrun/solana-wallet' : '~/.blockrun/wallet'}</code>{' '}
          (the same file Franklin core uses), or set{' '}
          <code>{chain === 'solana' ? 'SOLANA_WALLET_KEY' : 'BASE_CHAIN_WALLET_KEY'}</code> in your env.
        </p>
      ) : (
      <>
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
        <div>
          <dt>Loaded from</dt>
          <dd><code>{chain === 'solana' ? '~/.blockrun/solana-wallet' : '~/.blockrun/wallet'}</code></dd>
        </div>
        <div><dt>Spent (24h)</dt><dd>${w.recentSpendUsd.toFixed(2)}</dd></div>
        {typeof w.totalSpendUsd === 'number' && w.totalSpendUsd > 0 && (
          <div><dt>Spent (all-time, shared wallet)</dt><dd>${w.totalSpendUsd.toFixed(2)}</dd></div>
        )}
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
      <p className="settings-foot-note">
        Top up by sending USDC on {w.network} to the address above. Every
        generation is paid live per call — no subscription.
      </p>
      </>
      )}
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
  const t = useT();
  const edgeStyle = usePrefsStore((s) => s.edgeStyle);
  const setEdgeStyle = usePrefsStore((s) => s.setEdgeStyle);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const themeOptions: { id: Theme; labelKey: StringKey; hintKey: StringKey }[] = [
    { id: 'dark',  labelKey: 'canvas_theme_dark',  hintKey: 'canvas_theme_dark_hint' },
    { id: 'gold',  labelKey: 'canvas_theme_gold',  hintKey: 'canvas_theme_gold_hint' },
    { id: 'light', labelKey: 'canvas_theme_light', hintKey: 'canvas_theme_light_hint' },
  ];

  const edgeOptions: { id: EdgeStyle; labelKey: StringKey; hintKey: StringKey }[] = [
    { id: 'animated', labelKey: 'canvas_edges_animated', hintKey: 'canvas_edges_animated_hint' },
    { id: 'solid',    labelKey: 'canvas_edges_solid',    hintKey: 'canvas_edges_solid_hint' },
    { id: 'subtle',   labelKey: 'canvas_edges_subtle',   hintKey: 'canvas_edges_subtle_hint' },
  ];

  return (
    <div className="settings-pane-section">
      <h2>{t('settings_section_canvas')}</h2>

      <h3 className="settings-subhead">{t('canvas_theme')}</h3>
      <div className="settings-choices">
        {themeOptions.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`settings-choice ${theme === o.id ? 'is-active' : ''}`}
            onClick={() => setTheme(o.id)}
          >
            <span className="settings-choice-label">{t(o.labelKey)}</span>
            <span className="settings-choice-hint">{t(o.hintKey)}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-subhead">{t('canvas_edges')}</h3>
      <div className="settings-choices">
        {edgeOptions.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`settings-choice ${edgeStyle === o.id ? 'is-active' : ''}`}
            onClick={() => setEdgeStyle(o.id)}
          >
            <span className="settings-choice-label">{t(o.labelKey)}</span>
            <span className="settings-choice-hint">{t(o.hintKey)}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-subhead">{t('canvas_language')}</h3>
      <div className="settings-choices">
        {LOCALES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`settings-choice ${locale === l.id ? 'is-active' : ''}`}
            onClick={() => setLocale(l.id as Locale)}
          >
            <span className="settings-choice-label">{l.native}</span>
            <span className="settings-choice-hint">{l.label}</span>
          </button>
        ))}
      </div>

      <p className="settings-foot-note">{t('canvas_apply_hint')}</p>
    </div>
  );
}

function AboutPane() {
  const t = useT();
  return (
    <div className="settings-pane-section">
      <h2>{t('settings_section_about')}</h2>
      <p className="settings-foot-note">{t('about_blurb')}</p>
      <dl className="settings-kv">
        <div><dt>{t('about_version')}</dt><dd>0.0.1</dd></div>
        <div><dt>{t('about_gateway')}</dt><dd>BlockRun · x402 on Base &amp; Solana</dd></div>
      </dl>
      <h3 className="settings-subhead">{t('about_credits')}</h3>
      <p className="settings-foot-note">{t('about_credits_blurb')}</p>
      <div className="settings-links">
        <a href="https://github.com/BlockRunAI/franklin-canvas" target="_blank" rel="noopener noreferrer">
          Repository <ExternalLink size={12} aria-hidden />
        </a>
        <a href="https://github.com/BlockRunAI/Franklin" target="_blank" rel="noopener noreferrer">
          Franklin core <ExternalLink size={12} aria-hidden />
        </a>
        <a href="https://github.com/BlockRunAI/Prompt-Case-Hub" target="_blank" rel="noopener noreferrer">
          Prompt library source <ExternalLink size={12} aria-hidden />
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
  const t = useT();

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
        aria-label={t('settings_title')}
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="settings-rail">
          <div className="settings-rail-head">
            <h2>{t('settings_title')}</h2>
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
                  <span>{t(it.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="settings-pane">
          <header className="settings-pane-head">
            <span className="settings-version">v0.0.1</span>
            <button className="settings-close" onClick={onClose} aria-label={t('settings_close')}>
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="settings-pane-body">{PANES[active]}</div>
        </main>
      </div>
    </div>
  );
}
