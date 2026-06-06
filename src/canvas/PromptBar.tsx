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
  ArrowUp, ImageIcon, Film, Music, X, Plus, Upload, AlertCircle, Settings2,
  type LucideIcon,
} from 'lucide-react';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS } from './nodes';
import ModelDropdown from '../components/ModelDropdown';
import VideoSettingsPanel, { type VideoSettings, type AspectRatio } from './VideoSettingsPanel';
import ImageSettingsPanel, { type ImageSettings, type ImageRatio, type ImageQuality } from './ImageSettingsPanel';
import { getWallet } from '../api/franklin';
import { prepareImageForUpload } from '../lib/image-compress';
import { useT } from '../i18n';

type Mode = 'imagegen' | 'videogen' | 'musicgen';

const MODE_META: Record<Mode, { label: string; icon: LucideIcon; models: { id: string; label: string }[] }> = {
  imagegen: { label: 'Image', icon: ImageIcon, models: IMAGE_MODELS },
  videogen: { label: 'Video', icon: Film, models: VIDEO_MODELS },
  musicgen: { label: 'Music', icon: Music, models: MUSIC_MODELS },
};

// Image models that accept multi-image fusion on the gateway
// (/api/v1/images/image2image image[]). Mirrors EDIT_SUPPORTED_MODELS there.
const MULTI_IMAGE_MODELS = new Set<string>([
  'openai/gpt-image-1', 'openai/gpt-image-2',
  'google/nano-banana', 'google/nano-banana-pro',
]);

// Seedance 2.0 adds "omni" multi-reference: instead of first/last frame, you
// supply several reference images (character / style / scene). The two modes are
// mutually exclusive per generation (see LibTV / Seedance docs), so for these
// models the bar shows a First-Last ↔ References toggle. 1.5-pro is first/last
// only and never sees the toggle.
export const SEEDANCE_OMNI_MODELS = new Set<string>([
  'bytedance/seedance-2.0', 'bytedance/seedance-2.0-fast',
]);
const MAX_OMNI_REFS = 9;

interface Props {
  onSend: (payload: {
    nodeId: string | null;
    mode: Mode;
    prompt: string;
    model: string;
    /** Reference image attached via the picker / paperclip. Drives
     *  image-to-image (imagegen.edit) and image-to-video (first frame). */
    referenceUrl: string | null;
    /** Second reference image. For imagegen → multi-image fusion (e.g. style
     *  from img1 + subject from img2). For videogen → the LAST frame
     *  (first-and-last-frame interpolation, Seedance only). */
    referenceUrl2?: string | null;
    /** Seedance 2.0 omni multi-reference images. Mutually exclusive with
     *  referenceUrl/referenceUrl2 — set only when the user is in "References"
     *  mode; null otherwise. */
    referenceImageUrls?: string[] | null;
  }) => void;
}

function costFor(mode: Mode, modelId: string, durationS = 5): number {
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
  caption,
}: {
  attachment: string | null;
  onPick: (url: string) => void;
  onClear: () => void;
  onUploadClick: () => void;
  /** Optional tiny label under the slot — used to distinguish dual slots
   *  (e.g. "参考1 / 参考2" for fusion, "首帧 / 尾帧" for first-last video). */
  caption?: string;
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
    <div className={`pb-ref-picker ${caption ? 'has-caption' : ''}`} ref={rootRef}>
      {caption && <span className="pb-ref-caption">{caption}</span>}
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
  const t = useT();
  const { getNode, getNodes } = useReactFlow();
  const selectedIds = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id));
  const selectedId = selectedIds[0] ?? null;
  const selectedNode = selectedId ? getNode(selectedId) : null;
  const selectedKind = selectedNode?.type as Mode | undefined;
  const bound = selectedKind && MODE_META[selectedKind] ? selectedKind : null;

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].id);
  const [attachment, setAttachment] = useState<string | null>(null);
  // Second reference: image fusion (imagegen) or last frame (videogen).
  const [attachment2, setAttachment2] = useState<string | null>(null);
  // Seedance 2.0 omni multi-reference images, and which reference mode is active
  // for this node ('frames' = first/last, 'refs' = omni multi-reference).
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refMode, setRefMode] = useState<'frames' | 'refs'>('frames');
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

  // Hydrate from the bound node whenever the SELECTION changes — keyed on the
  // node id only. Depending on the whole `selectedNode` object would re-run this
  // on every data mutation (e.g. tweaking resolution/duration in the settings
  // panel calls updateNodeData → new object), which would clobber the prompt the
  // user is typing but hasn't sent yet. Re-sync on id/mode change only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bound && selectedNode) {
      const d = selectedNode.data as { prompt?: string; model?: string; referenceUrl?: string };
      setPrompt(d.prompt ?? '');
      setModel(d.model ?? MODE_META[bound].models[0].id);
      setAttachment(d.referenceUrl ?? null);
      setAttachment2((d as { referenceUrl2?: string }).referenceUrl2 ?? null);
      setRefImages((d as { referenceImageUrls?: string[] }).referenceImageUrls ?? []);
      setRefMode((d as { refMode?: 'frames' | 'refs' }).refMode ?? 'frames');
    }
  }, [selectedNode?.id, bound]);

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
  // Second slot (fusion / last frame) — same flow, separate file input + key.
  const fileRef2 = useRef<HTMLInputElement>(null);
  const onAttachClick2 = () => fileRef2.current?.click();
  const onAttachFile2 = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setAttachment2(url);
      if (selectedId) updateNodeData(selectedId, { referenceUrl2: url });
    };
    reader.readAsDataURL(file);
  };
  const clearAttachment2 = () => {
    setAttachment2(null);
    if (selectedId) updateNodeData(selectedId, { referenceUrl2: undefined });
  };

  // Omni multi-reference (Seedance 2.0): a growable list of reference images.
  const fileRefOmni = useRef<HTMLInputElement>(null);
  const setRefs = (next: string[]) => {
    const capped = next.slice(0, MAX_OMNI_REFS);
    setRefImages(capped);
    if (selectedId) updateNodeData(selectedId, { referenceImageUrls: capped });
  };
  const addRef = (url: string) => setRefs([...refImages, url]);
  const removeRefAt = (i: number) => setRefs(refImages.filter((_, idx) => idx !== i));
  const onAttachOmniClick = () => fileRefOmni.current?.click();
  const onAttachOmniFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addRef(reader.result as string);
    reader.readAsDataURL(file);
  };
  const changeRefMode = (m: 'frames' | 'refs') => {
    setRefMode(m);
    if (selectedId) updateNodeData(selectedId, { refMode: m });
  };

  // The bar is contextual to a generation node — hide it when nothing
  // relevant is selected.
  if (!bound) return null;
  const mode: Mode = bound;

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;

  // Seedance 2.0 supports the omni multi-reference mode (a list of refs) as an
  // alternative to first/last frame. When such a model is selected the bar shows
  // a mode toggle; `omniMode` is whether the user has switched to references.
  const supportsOmni = mode === 'videogen' && SEEDANCE_OMNI_MODELS.has(model);
  const omniMode = supportsOmni && refMode === 'refs';

  // A second image input is meaningful only for: image fusion (gpt-image /
  // nano-banana) and first-and-last-frame video (Seedance). Other models hide
  // the slot and never receive a second reference. In omni mode there are no
  // first/last slots at all.
  const supportsSecondImage =
    !omniMode && (
      (mode === 'imagegen' && MULTI_IMAGE_MODELS.has(model)) ||
      (mode === 'videogen' && model.startsWith('bytedance/seedance'))
    );
  // Progressive disclosure: the 2nd slot only appears once the 1st is filled,
  // so the bar stays clean until you actually want a second reference.
  const showSecondSlot = supportsSecondImage && !!attachment;
  // Video frames are order-sensitive (first vs last), so label them; image
  // fusion references are interchangeable and need no caption.
  const captions: [string, string] | null =
    mode === 'videogen' ? ['First', 'Last'] : null;

  const send = () => {
    if (!prompt.trim()) return;
    onSend({
      nodeId: selectedId, mode, prompt, model,
      // Omni and first/last are mutually exclusive — only send one set.
      referenceUrl: omniMode ? null : attachment,
      referenceUrl2: supportsSecondImage ? attachment2 : null,
      referenceImageUrls: omniMode ? refImages : null,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Paste a clipboard image anywhere in the bar → drop it into the first empty
  // reference slot (slot 2 only when this model supports a second image). The
  // canvas-level paste handler defers to us (see CanvasView) so it won't also
  // spawn an upload node.
  const onPasteImage = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (!it.type.startsWith('image/')) continue;
      const file = it.getAsFile();
      if (!file) continue;
      e.preventDefault();
      let url: string;
      try {
        url = await prepareImageForUpload(file);
      } catch {
        return; // too large / unreadable — silently ignore, matches file picker
      }
      if (omniMode) {
        if (refImages.length < MAX_OMNI_REFS) addRef(url);
        return;
      }
      if (!attachment) {
        setAttachment(url);
        if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
      } else if (supportsSecondImage && !attachment2) {
        setAttachment2(url);
        if (selectedId) updateNodeData(selectedId, { referenceUrl2: url });
      } else {
        setAttachment(url);
        if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
      }
      return;
    }
  };

  return (
    <div className="prompt-bar nodrag nopan" onClick={(e) => e.stopPropagation()} onPaste={onPasteImage}>
      {needsFunding && walletState && (
        <div className="prompt-bar-banner" role="status">
          <AlertCircle size={13} aria-hidden />
          <span>
            {t(walletState.isNew ? 'pb_wallet_new' : 'pb_wallet_ready', { network: walletState.network })}{' '}
            <button type="button" className="prompt-bar-banner-addr" onClick={copyAddr} title="Copy full address">
              <code>{shortAddr}</code>
            </button>{' '}
            {t('pb_wallet_tail')}
          </span>
        </div>
      )}
      {/* Seedance 2.0: first/last frame ↔ omni references mode toggle. */}
      {supportsOmni && (
        <div className="pb-refmode" role="tablist" aria-label="Reference mode">
          <button
            type="button"
            role="tab"
            aria-selected={!omniMode}
            className={`pb-refmode-tab ${!omniMode ? 'is-on' : ''}`}
            onClick={() => changeRefMode('frames')}
            title={t('pb_ref_frames_hint')}
          >
            {t('pb_ref_frames')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={omniMode}
            className={`pb-refmode-tab ${omniMode ? 'is-on' : ''}`}
            onClick={() => changeRefMode('refs')}
            title={t('pb_ref_refs_hint')}
          >
            {t('pb_ref_refs')}
          </button>
        </div>
      )}
      <div className="prompt-bar-top">
        {omniMode ? (
          <div className="pb-ref-multi">
            {refImages.map((url, i) => (
              <div className="pb-ref-thumb pb-ref-thumb-static" key={i}>
                <img src={url} alt="" />
                <span
                  role="button"
                  tabIndex={0}
                  className="pb-ref-thumb-x"
                  aria-label="Remove reference"
                  onClick={() => removeRefAt(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeRefAt(i); } }}
                >
                  <X size={9} aria-hidden />
                </span>
              </div>
            ))}
            {refImages.length < MAX_OMNI_REFS && (
              <ReferencePicker
                attachment={null}
                onPick={addRef}
                onClear={() => {}}
                onUploadClick={onAttachOmniClick}
              />
            )}
            <input ref={fileRefOmni} type="file" accept="image/*" onChange={onAttachOmniFile} hidden />
          </div>
        ) : (
          <>
            <ReferencePicker
              attachment={attachment}
              caption={captions?.[0]}
              onPick={(url) => {
                setAttachment(url);
                if (selectedId) updateNodeData(selectedId, { referenceUrl: url });
              }}
              onClear={clearAttachment}
              onUploadClick={onAttachClick}
            />
            <input ref={fileRef} type="file" accept="image/*" onChange={onAttachFile} hidden />
            {showSecondSlot && (
              <>
                <ReferencePicker
                  attachment={attachment2}
                  caption={captions?.[1]}
                  onPick={(url) => {
                    setAttachment2(url);
                    if (selectedId) updateNodeData(selectedId, { referenceUrl2: url });
                  }}
                  onClear={clearAttachment2}
                  onUploadClick={onAttachClick2}
                />
                <input ref={fileRef2} type="file" accept="image/*" onChange={onAttachFile2} hidden />
              </>
            )}
          </>
        )}
        <div className="pb-flex" />
        {bound && selectedNode && (
          <span className="pb-bound-chip">
            {t('pb_editing')} · <strong>{selectedNode.data?.title as string || meta.label}</strong> · {selectedId?.slice(0, 6)}
          </span>
        )}
      </div>

      <textarea
        className="prompt-bar-input"
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          // Persist as you type so the draft survives deselect→reselect (the
          // hydrate effect reads it back from node data). No effect re-run since
          // it's keyed on node id, not the data object.
          if (selectedId) updateNodeData(selectedId, { prompt: e.target.value });
        }}
        onKeyDown={onKeyDown}
        placeholder={t('pb_placeholder')}
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
        <ModelDropdown models={meta.models} value={model} onChange={(m) => { setModel(m); if (selectedId) updateNodeData(selectedId, { model: m }); }} />
        {/* Settings gear — Video (aspect / resolution / duration / audio) and
            Image (aspect ratio / quality). Music settings live in the music
            node's lyrics popover. */}
        {mode === 'imagegen' && (
          <div className="pb-settings-wrap">
            <button
              type="button"
              className={`pb-icon-btn pb-settings-btn ${settingsOpen ? 'is-active' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Open image settings"
              aria-expanded={settingsOpen}
              title="Image settings"
            >
              <Settings2 size={20} strokeWidth={2.2} aria-hidden />
            </button>
            {settingsOpen && (() => {
              const nd = selectedNode?.data as { ratio?: ImageRatio; quality?: ImageQuality } | undefined;
              const value: ImageSettings = { ratio: nd?.ratio ?? '1:1', quality: nd?.quality ?? 'standard' };
              return (
                <div className="pb-settings-pop">
                  <ImageSettingsPanel
                    value={value}
                    onChange={(next) => {
                      if (selectedId) updateNodeData(selectedId, { ratio: next.ratio, quality: next.quality });
                    }}
                  />
                </div>
              );
            })()}
          </div>
        )}
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
                durationS: nd?.durationS ?? 5,
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
            ${costFor(mode, model, (selectedNode?.data as { durationS?: number })?.durationS ?? 5).toFixed(3)}
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
