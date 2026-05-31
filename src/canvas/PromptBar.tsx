// Floating bottom prompt bar — chat-style generation input. Lives
// absolute-bottom inside the canvas viewport.
//
// Behavior:
//   • If an imagegen / videogen / musicgen node is selected, the bar
//     binds to its prompt / model / settings. Send triggers that
//     node's generation.
//   • If nothing is selected, the bar is hidden.

import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import {
  Paperclip, ArrowUp, ImageIcon, Film, Music, X, Plus, Upload, AlertCircle, Settings2,
  type LucideIcon,
} from 'lucide-react';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS } from './nodes';
import ModelDropdown from '../components/ModelDropdown';
import VideoSettingsPanel, { type VideoSettings, type AspectRatio } from './VideoSettingsPanel';
import { getWallet } from '../api/franklin';

type Mode = 'imagegen' | 'videogen' | 'musicgen';

const MODE_META: Record<Mode, { label: string; icon: LucideIcon; models: { id: string; label: string }[] }> = {
  imagegen: { label: 'Image', icon: ImageIcon, models: IMAGE_MODELS },
  videogen: { label: 'Video', icon: Film, models: VIDEO_MODELS },
  musicgen: { label: 'Music', icon: Music, models: MUSIC_MODELS },
};

interface Props {
  onSend: (payload: {
    nodeId: string | null;
    mode: Mode;
    prompt: string;
    model: string;
    /** Reference image attached via the picker / paperclip. Drives
     *  image-to-image (imagegen.edit) and image-to-video. */
    referenceUrl: string | null;
  }) => void;
}

function costFor(mode: Mode, modelId: string, durationS = 8): number {
  if (mode === 'imagegen') {
    const m = IMAGE_MODELS.find((x) => x.id === modelId);
    return m?.price ?? 0;
  }
  if (mode === 'videogen') {
    const m = VIDEO_MODELS.find((x) => x.id === modelId);
    return (m?.pricePerS ?? 0) * durationS;
  }
  const m = MUSIC_MODELS.find((x) => x.id === modelId);
  return m?.price ?? 0;
}

// Reference picker: a thumbnail slot at the prompt bar's top-left. Empty →
// "+", clicking opens a popover that lists every image already on the canvas
// (upload nodes + completed imagegens). Pick one to use it as referenceUrl
// for the next gen. "Upload from disk" is also in the popover.
function ReferencePicker({
  attachment,
  onPick,
  onClear,
  onUploadClick,
}: {
  attachment: string | null;
  onPick: (url: string) => void;
  onClear: () => void;
  onUploadClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasImages = useStore((s) => {
    const out: { id: string; url: string; label: string }[] = [];
    for (const n of s.nodes) {
      const d = n.data as { imageUrl?: string; resultUrl?: string; title?: string };
      if (n.type === 'upload' && d.imageUrl) {
        out.push({ id: n.id, url: d.imageUrl, label: d.title || 'upload' });
      } else if (n.type === 'imagegen' && d.resultUrl) {
        out.push({ id: n.id, url: d.resultUrl, label: d.title || 'image' });
      }
    }
    return out;
  });
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
    <div className="pb-ref-picker" ref={rootRef}>
      {attachment ? (
        <button
          type="button"
          className="pb-ref-thumb"
          onClick={() => setOpen((v) => !v)}
          aria-label="Change reference image"
          title="Change reference image"
        >
          <img src={attachment} alt="" />
          <span
            role="button"
            tabIndex={0}
            className="pb-ref-thumb-x"
            aria-label="Remove reference"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClear(); } }}
          >
            <X size={9} aria-hidden />
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="pb-ref-empty"
          onClick={() => setOpen((v) => !v)}
          aria-label="Add reference image"
          title="Add reference image"
        >
          <Plus size={18} strokeWidth={2.5} aria-hidden />
        </button>
      )}
      {open && (
        <div className="pb-ref-menu" role="dialog" aria-label="Pick reference image">
          <div className="pb-ref-menu-head">
            <span>Pick from canvas</span>
            <button
              type="button"
              className="pb-ref-upload"
              onClick={() => { setOpen(false); onUploadClick(); }}
            >
              <Upload size={12} aria-hidden /> Upload
            </button>
          </div>
          {canvasImages.length === 0 ? (
            <div className="pb-ref-empty-state">No images on the canvas yet.</div>
          ) : (
            <ul className="pb-ref-grid">
              {canvasImages.map((img) => (
                <li key={img.id}>
                  <button
                    type="button"
                    className={`pb-ref-tile ${attachment === img.url ? 'is-selected' : ''}`}
                    onClick={() => { onPick(img.url); setOpen(false); }}
                    title={img.label}
                  >
                    <img src={img.url} alt={img.label} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function PromptBar({ onSend }: Props) {
  const { getNode, getNodes } = useReactFlow();
  const selectedIds = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id));
  const selectedId = selectedIds[0] ?? null;
  const selectedNode = selectedId ? getNode(selectedId) : null;
  const selectedKind = selectedNode?.type as Mode | undefined;
  const bound = selectedKind && MODE_META[selectedKind] ? selectedKind : null;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].id);
  const [attachment, setAttachment] = useState<string | null>(null);
  // Settings popover state for the gear button. Same panel surface used on
  // the node, just anchored to the PromptBar so users can tweak size /
  // aspect / duration without clicking away from the prompt area.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Wallet snapshot (null while loading). Wallet is auto-created on first
  // /api/wallet call, so `address` is always non-empty once loaded — the
  // banner now nudges users to FUND the address, not to set one up.
  const [walletState, setWalletState] = useState<{
    address: string; balanceUsdc: number; isNew: boolean; network: string;
  } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData } = useReactFlow();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Prefer Base by default; only fall back to Solana if Base errored.
        const w = await getWallet('base').catch(() => null);
        if (cancelled) return;
        if (w?.address) {
          setWalletState({ address: w.address, balanceUsdc: w.balanceUsdc, isNew: !!w.isNew, network: w.network });
        }
      } catch { /* leave null */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const needsFunding = walletState !== null && walletState.balanceUsdc < 0.01;
  const shortAddr = walletState?.address
    ? `${walletState.address.slice(0, 6)}…${walletState.address.slice(-4)}`
    : '';
  const copyAddr = () => {
    if (walletState?.address) void navigator.clipboard.writeText(walletState.address);
  };

  // Hydrate from the bound node whenever the selection changes.
  useEffect(() => {
    if (bound && selectedNode) {
      const d = selectedNode.data as { prompt?: string; model?: string; referenceUrl?: string };
      setPrompt(d.prompt ?? '');
      setModel(d.model ?? MODE_META[bound].models[0].id);
      setAttachment(d.referenceUrl ?? null);
    }
  }, [selectedNode?.id, bound, selectedNode]);

  const onAttachClick = () => fileRef.current?.click();
  const onAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setAttachment(url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
    };
    reader.readAsDataURL(file);
  };
  const clearAttachment = () => {
    setAttachment(null);
    if (selectedId) updateNodeData(selectedId, { referenceUrl: undefined });
  };

  // The bar is contextual to a generation node — hide it when nothing
  // relevant is selected.
  if (!bound) return null;
  const mode: Mode = bound;

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;

  const send = () => {
    if (!prompt.trim()) return;
    onSend({ nodeId: selectedId, mode, prompt, model, referenceUrl: attachment });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="prompt-bar nodrag nopan" onClick={(e) => e.stopPropagation()}>
      {needsFunding && walletState && (
        <div className="prompt-bar-banner" role="status">
          <AlertCircle size={13} aria-hidden />
          <span>
            {walletState.isNew ? 'Wallet just created' : 'Wallet ready'} on{' '}
            <strong>{walletState.network}</strong>. Send USDC to{' '}
            <button type="button" className="prompt-bar-banner-addr" onClick={copyAddr} title="Copy full address">
              <code>{shortAddr}</code>
            </button>{' '}
            to start generating.
          </span>
        </div>
      )}
      <div className="prompt-bar-top">
        <ReferencePicker
          attachment={attachment}
          onPick={(url) => {
            setAttachment(url);
            if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
          }}
          onClear={clearAttachment}
          onUploadClick={onAttachClick}
        />
        <input ref={fileRef} type="file" accept="image/*" onChange={onAttachFile} hidden />
        <button
          className="pb-icon-btn"
          type="button"
          aria-label="Upload reference from disk"
          title="Upload reference from disk"
          onClick={onAttachClick}
        >
          <Paperclip size={22} strokeWidth={2} aria-hidden />
        </button>
        <div className="pb-flex" />
        {bound && selectedNode && (
          <span className="pb-bound-chip">
            Editing · <strong>{selectedNode.data?.title as string || meta.label}</strong> · {selectedId?.slice(0, 6)}
          </span>
        )}
      </div>

      <textarea
        className="prompt-bar-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe anything you want to generate…"
        rows={3}
      />

      <div className="prompt-bar-bottom">
        <div className="pb-mode">
          <span className={`pb-mode-btn is-active`}>
            <ModeIcon size={14} aria-hidden />
            <span>{meta.label}</span>
          </span>
        </div>
        <div className="pb-divider" />
        <ModelDropdown models={meta.models} value={model} onChange={setModel} />
        {/* Settings gear — Video only (aspect / resolution / duration /
            audio). Image generation has no per-call knobs worth exposing;
            music settings live in the music node's lyrics popover. */}
        {mode === 'videogen' && (
          <div className="pb-settings-wrap">
            <button
              type="button"
              className={`pb-icon-btn pb-settings-btn ${settingsOpen ? 'is-active' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Open video settings"
              aria-expanded={settingsOpen}
              title="Video settings"
            >
              <Settings2 size={20} strokeWidth={2.2} aria-hidden />
            </button>
            {settingsOpen && (() => {
              const nd = selectedNode?.data as { mode?: 'standard' | 'pro'; ratio?: AspectRatio; durationS?: number; resolution?: '480p' | '720p' | '1080p'; audio?: boolean } | undefined;
              const value: VideoSettings = {
                mode: nd?.mode ?? 'standard',
                ratio: nd?.ratio ?? '16:9',
                durationS: nd?.durationS ?? 8,
                resolution: nd?.resolution ?? '720p',
                audio: nd?.audio ?? true,
              };
              return (
                <div className="pb-settings-pop">
                  <VideoSettingsPanel
                    value={value}
                    onChange={(next) => {
                      if (selectedId) updateNodeData(selectedId, { mode: next.mode, ratio: next.ratio, durationS: next.durationS, resolution: next.resolution, audio: next.audio });
                    }}
                  />
                </div>
              );
            })()}
          </div>
        )}
        <div className="pb-flex" />
        <div
          className="pb-cost"
          title="Estimated USDC cost for this run, settled via x402 on Base"
        >
          <span className="pb-cost-symbol">USDC</span>
          <span className="pb-cost-n">
            ${costFor(mode, model, (selectedNode?.data as { durationS?: number })?.durationS ?? 8).toFixed(3)}
          </span>
        </div>
        <button
          className="pb-send"
          type="button"
          onClick={send}
          disabled={!prompt.trim()}
          aria-label="Send"
          title="Send (Enter)"
        >
          <ArrowUp size={24} strokeWidth={3} aria-hidden />
        </button>
      </div>

      <span hidden>{getNodes().length}</span>
    </div>
  );
}
