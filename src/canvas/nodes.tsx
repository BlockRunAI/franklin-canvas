// Node types mirror what the BlockRun gateway actually serves through Franklin.
// Image / video catalogs are the known-valid models on the BlockRun gateway.

import { Handle, NodeResizer, Position, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Upload, ImageIcon, Film, Type, SquareDashed, Clapperboard, ImagePlus, Upload as ReplaceIcon, Loader2, Music, X, Plus } from 'lucide-react';
import NodeFrame from './NodeFrame';
import NodeActionMenu from './NodeActionMenu';
import VideoSettingsPanel, { type VideoSettings, type AspectRatio } from './VideoSettingsPanel';
import LyricsPanel, { type LyricsMode } from './LyricsPanel';
import ModelDropdown from '../components/ModelDropdown';
import Lightbox from './Lightbox';
import { useCanvasCtx } from './CanvasContext';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface BaseNodeData extends Record<string, unknown> {
  status?: NodeStatus;
  progress?: number;
  resultUrl?: string;
  resultText?: string;
  errorMsg?: string;
}

export interface UploadNodeData extends BaseNodeData {
  imageUrl?: string;
}

export interface GenNodeData extends BaseNodeData {
  model: string;
  prompt: string;
  priceUsd: number;
  durationS?: number;
}

export interface TextNodeData extends BaseNodeData {
  model: string;
  prompt: string;
  priceUsd: number;
}

// ── Catalogs (BlockRun gateway) ──

// All prices below mirror the BlockRun gateway's /v1/models response as of
// 2026-05-31. Models that aren't in the gateway catalog have been removed
// (otherwise a Send hits a 404). Keep this list in sync with gateway updates.
export const IMAGE_MODELS = [
  { id: 'google/nano-banana', label: 'Nano Banana', price: 0.05 },
  { id: 'google/nano-banana-pro', label: 'Nano Banana Pro', price: 0.10 },
  { id: 'openai/gpt-image-1', label: 'GPT Image 1', price: 0.02 },
  { id: 'openai/gpt-image-2', label: 'GPT Image 2', price: 0.06 },
  { id: 'xai/grok-imagine-image', label: 'Grok Imagine', price: 0.02 },
  { id: 'xai/grok-imagine-image-pro', label: 'Grok Imagine Pro', price: 0.07 },
  { id: 'zai/cogview-4', label: 'CogView 4', price: 0.015 },
];

// per-second pricing; cheapest first so the demo default cost stays low.
export const VIDEO_MODELS = [
  // pricePerS = the gateway's actual per-second charge incl. its 5% margin
  // (verified against the live /v1/videos/generations quote). Seedance is
  // token-billed at 720p; 1080p costs ~2.25× (not reflected in this flat estimate).
  { id: 'xai/grok-imagine-video', label: 'Grok Imagine', pricePerS: 0.0525 },
  { id: 'bytedance/seedance-1.5-pro', label: 'Seedance 1.5 Pro', pricePerS: 0.092 },
  { id: 'azure/sora-2', label: 'Sora 2', pricePerS: 0.105 },
  { id: 'bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', pricePerS: 0.238 },
  { id: 'bytedance/seedance-2.0', label: 'Seedance 2.0 Pro', pricePerS: 0.298 },
];

export const MUSIC_MODELS = [
  { id: 'minimax/music-2.5+', label: 'MiniMax Music 2.5+', price: 0.15 },
];

// per 1k tokens (blended ~50/50 input/output for display purposes; real cost
// depends on actual prompt + completion size). Gateway IDs use dots, not
// hyphens (e.g. claude-opus-4.7) — getting that wrong means a 404 at send.
// `tools: false` marks a model that can't reliably do function calling — it's
// fine for the Text node (plain chat) but hidden from the Agent model picker
// (the Agent needs tool calls to actually build things).
export const TEXT_MODELS: { id: string; label: string; priceK: number; tools?: boolean }[] = [
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', priceK: 0.003 },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', priceK: 0.009 },
  { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', priceK: 0.015 },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', priceK: 0.015 },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', priceK: 0.0175 },
  { id: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro', priceK: 0.007 },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', priceK: 0.0014 },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', priceK: 0.00075 },
  // Free (NVIDIA-hosted). Great for the Text node; usable as an Agent model only
  // if they support tool calling — verified before listing.
  { id: 'nvidia/qwen3.5-397b-a17b', label: 'Qwen3.5 397B · Free', priceK: 0 },
];

// ── Helpers ──

const STATUS_PILL: Record<NodeStatus, { label: string; color: string }> = {
  idle: { label: 'idle', color: '#6b6b6f' },
  running: { label: 'running', color: '#a3e635' },
  done: { label: 'done', color: '#4ade80' },
  error: { label: 'error', color: '#ef4444' },
};

function StatusPill({ status }: { status: NodeStatus }) {
  const s = STATUS_PILL[status];
  return <span className="node-pill" style={{ background: s.color }}>{s.label}</span>;
}

// Triggers a browser download for a remote URL — handles same-origin
// blobs and cross-origin URLs by fetching the bytes when needed.
async function downloadUrl(url: string, suggestedName: string) {
  try {
    const r = await fetch(url, { mode: 'cors' });
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // CORS may block direct fetch on some providers — fall back to a plain
    // link click; the browser then handles whatever the server allows.
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

// Remeasure handle positions across a few frames: aspect-ratio cards (upload)
// and images resolve their height after first paint, so a single measure can
// pin the handle to a stale (often bottom-offset) position.
function useRefreshHandles(id: string) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    const timers = [60, 200, 500].map((ms) => setTimeout(() => updateNodeInternals(id), ms));
    updateNodeInternals(id);
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
  }, [id, updateNodeInternals]);
}

function AddSideButton({ id, side = 'right' }: { id: string; side?: 'left' | 'right' }) {
  const { openConnectMenu } = useCanvasCtx();
  // Once the side has an edge attached, the "+" becomes ambient — hidden when
  // idle, revealed on hover / selection so you can still branch off it.
  const isConnected = useStore((s) =>
    s.edges.some((e) => (side === 'right' ? e.source === id : e.target === id)),
  );
  return (
    <button
      type="button"
      className={`node-add-side node-add-${side} nodrag ${isConnected ? 'is-connected' : ''}`}
      aria-label="Add connected node"
      title="Add connected node"
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const anchorX = side === 'right' ? r.right + 8 : r.left - 8;
        openConnectMenu(id, anchorX, r.top + r.height / 2, side);
      }}
    >
      <Plus size={18} strokeWidth={2.75} aria-hidden />
    </button>
  );
}

function CornerDelete({ id }: { id: string }) {
  const { deleteElements } = useReactFlow();
  return (
    <button
      type="button"
      className="node-corner-delete nodrag"
      aria-label="Delete node"
      title="Delete"
      onClick={(e) => { e.stopPropagation(); void deleteElements({ nodes: [{ id }] }); }}
    >
      <X size={12} strokeWidth={2.25} aria-hidden />
    </button>
  );
}

function NodeHeader({ icon: Icon, title, status }: { icon: typeof Upload; title: string; status: NodeStatus }) {
  return (
    <div className="node-header">
      <span className="node-title">
        <Icon size={13} strokeWidth={1.75} aria-hidden />
        <span>{title}</span>
      </span>
      <StatusPill status={status} />
    </div>
  );
}

// ── Upload (image-first card with title above + floating toolbar) ──
export function UploadNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as UploadNodeData & { title?: string };
  const [, force] = useState(0);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      d.imageUrl = reader.result as string;
      d.status = 'done';
      d.createdAt = Date.now();
      force((n) => n + 1);
    };
    reader.readAsDataURL(file);
  };

  const [uploadLightbox, setUploadLightbox] = useState(false);

  return (
    <div className="canvas-card-wrap">
      <NodeFrame
        id={id}
        title={d.title}
        placeholder="photo"
        icon={Upload}
        status={d.status}
        hasResult={!!d.imageUrl}
        saveItem={d.imageUrl ? { kind: 'image', url: d.imageUrl, title: d.title } : null}
        onDownload={() => d.imageUrl && void downloadUrl(d.imageUrl, `${d.title || id}.png`)}
        onExpand={() => d.imageUrl && setUploadLightbox(true)}
      >
        <div className="canvas-node node-upload card-mode">
          <CornerDelete id={id} />
          <div className="card-image">
            {d.imageUrl ? (
              <img src={d.imageUrl} alt="Uploaded reference" />
            ) : (
              <div className="card-placeholder">drop or upload</div>
            )}
            <label className="card-upload-overlay">
              <input
                type="file"
                accept="image/*"
                onChange={onFile}
                style={{ display: 'none' }}
                aria-label="Pick reference image"
              />
              <ReplaceIcon size={12} strokeWidth={2} aria-hidden />
              <span>{d.imageUrl ? 'Replace' : 'Upload'}</span>
            </label>
          </div>
        </div>
      </NodeFrame>
      <AddSideButton id={id} side="left" />
      <AddSideButton id={id} side="right" />
      <Handle type="source" position={Position.Right} id={`${id}-out`} />
      {uploadLightbox && d.imageUrl && (
        <Lightbox
          src={d.imageUrl}
          kind="image"
          onClose={() => setUploadLightbox(false)}
          meta={{ createdAt: d.createdAt as number | undefined }}
          onDownload={() => void downloadUrl(d.imageUrl!, `${d.title || id}.png`)}
        />
      )}
    </div>
  );
}

// ── Image Gen ──
export function ImageGenNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as GenNodeData & { title?: string };
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData, getNodes } = useReactFlow();
  const { runImageEdit, runImageSplit, runAnnotate } = useCanvasCtx();
  const navLightbox = (dir: 1 | -1) => {
    const peers = getNodes().filter((n) => n.type === 'imagegen' && (n.data as GenNodeData)?.resultUrl);
    if (peers.length < 2) return;
    const idx = peers.findIndex((n) => (n.data as GenNodeData).resultUrl === lightboxSrc);
    const next = peers[(idx + dir + peers.length) % peers.length];
    setLightboxSrc((next.data as GenNodeData).resultUrl as string);
  };

  const onReplaceClick = () => fileRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateNodeData(id, { resultUrl: reader.result as string, status: 'done' });
    reader.readAsDataURL(file);
  };

  return (
    <div className="canvas-card-wrap">
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <NodeFrame
        id={id}
        title={d.title}
        placeholder="image"
        icon={ImageIcon}
        status={d.status}
        hasResult={!!d.resultUrl}
        saveItem={d.resultUrl ? { kind: 'image', url: d.resultUrl, title: d.title, model: IMAGE_MODELS.find((m) => m.id === d.model)?.label ?? d.model, prompt: d.prompt } : null}
        onDownload={() => d.resultUrl && void downloadUrl(d.resultUrl, `${d.title || id}.png`)}
        onExpand={() => d.resultUrl && setLightboxSrc(d.resultUrl as string)}
        onMore={() => setMenuOpen((v) => !v)}
        toolbarExtra={
          menuOpen ? (
            <NodeActionMenu
              imageReady={!!d.resultUrl}
              onItemClick={(item) => {
                setMenuOpen(false);
                if (['outpaint', 'enhance', 'cutout', 'pixels'].includes(item.id)) {
                  runImageEdit(id, item.id as 'outpaint' | 'enhance' | 'cutout' | 'pixels');
                } else if (item.id === 'split2') {
                  runImageSplit(id, 2, 2);
                } else if (item.id === 'split3') {
                  runImageSplit(id, 3, 3);
                } else if (item.id === 'annotate') {
                  runAnnotate(id);
                }
              }}
            />
          ) : null
        }
      >
        <div className="media-card">
          <CornerDelete id={id} />
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} hidden />
          {d.resultUrl ? (
            <>
              <img
                src={d.resultUrl}
                alt=""
                className="media-fill media-img"
                data-testid="canvas-node-image-content"
                onError={() => updateNodeData(id, {
                  status: 'error',
                  resultUrl: undefined,
                  errorMessage: 'Image failed to load — try again',
                })}
              />
              <button className="media-replace" type="button" aria-label="Replace" onClick={(e) => { e.stopPropagation(); onReplaceClick(); }}>
                <ReplaceIcon size={14} aria-hidden /> Replace
              </button>
            </>
          ) : d.status === 'error' ? (
            <div className="media-placeholder media-error">
              <ImageIcon size={26} strokeWidth={1.4} aria-hidden />
              <span>{(d.errorMessage as string) || 'Generation failed'}</span>
              <span className="media-error-hint">Hit Send again to retry, or open the URL below to see the raw response.</span>
              {!!d.lastTriedUrl && (
                <a
                  className="media-error-link"
                  href={d.lastTriedUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open last URL
                </a>
              )}
            </div>
          ) : (
            <div className="media-placeholder">
              <ImageIcon size={26} strokeWidth={1.4} aria-hidden />
              <span>Select this node and type a prompt below</span>
            </div>
          )}
          {d.status === 'running' && (
            <div className="media-overlay">
              <Loader2 className="media-spin" size={20} aria-hidden />
              <div className="media-progress"><div style={{ width: `${(d.progress ?? 0) * 100}%` }} /></div>
              <span className="media-overlay-hint">
                {(d.progress ?? 0) >= 0.85 ? 'Rendering — almost there' : 'Generating…'}
              </span>
            </div>
          )}
        </div>
      </NodeFrame>
      <AddSideButton id={id} side="left" />
      <AddSideButton id={id} side="right" />
      <Handle type="source" position={Position.Right} id={`${id}-out`} />
      {lightboxSrc && (
        <Lightbox
          src={lightboxSrc}
          kind="image"
          onClose={() => setLightboxSrc(null)}
          onPrev={() => navLightbox(-1)}
          onNext={() => navLightbox(1)}
          meta={{
            prompt: d.prompt,
            model: IMAGE_MODELS.find((m) => m.id === d.model)?.label ?? d.model,
            createdAt: d.createdAt as number | undefined,
          }}
          onDownload={() => void downloadUrl(lightboxSrc, `${d.title || id}.png`)}
        />
      )}
    </div>
  );
}

// ── Video Gen ──
function VideoCard({
  id, src, poster, status, progress, errorMessage, elapsedS,
}: {
  id: string;
  src?: string;
  poster?: string;
  status?: NodeStatus;
  progress: number;
  errorMessage?: string;
  elapsedS?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!src) {
    return (
      <div className="media-card">
        <CornerDelete id={id} />
        {status === 'error' ? (
          <div className="media-placeholder media-error">
            <Film size={26} strokeWidth={1.4} aria-hidden />
            <span>{errorMessage || 'Generation failed'}</span>
            <span className="media-error-hint">Hit Send again to retry. No payment was taken.</span>
          </div>
        ) : (
          <div className="media-placeholder">
            <Film size={26} strokeWidth={1.4} aria-hidden />
            <span>Select this node and type a prompt below</span>
          </div>
        )}
        {status === 'running' && (
          <div className="media-overlay">
            <Loader2 className="media-spin" size={20} aria-hidden />
            <div className="media-progress"><div style={{ width: `${progress * 100}%` }} /></div>
            <span className="media-overlay-hint">
              {(progress ?? 0) >= 0.85 ? 'Rendering — almost there' : 'Generating… video can take 1–6 min'}
              {typeof elapsedS === 'number' && elapsedS > 0 && (
                <> · {elapsedS >= 60 ? `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s` : `${elapsedS}s`}</>
              )}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="media-card has-result">
      <CornerDelete id={id} />
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        className="media-fill media-video"
        data-testid="canvas-node-video-content"
      />
    </div>
  );
}

export function VideoGenNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as GenNodeData & { title?: string; ratio?: AspectRatio; mode?: 'standard' | 'pro'; resolution?: '480p' | '720p' | '1080p'; audio?: boolean };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const { getNodes, updateNodeData } = useReactFlow();
  const navLightbox = (dir: 1 | -1) => {
    const peers = getNodes().filter((n) => n.type === 'videogen' && (n.data as GenNodeData)?.resultUrl);
    if (peers.length < 2) return;
    const idx = peers.findIndex((n) => (n.data as GenNodeData).resultUrl === lightboxSrc);
    const next = peers[(idx + dir + peers.length) % peers.length];
    setLightboxSrc((next.data as GenNodeData).resultUrl as string);
  };
  const [settings, setSettings] = useState<VideoSettings>({
    mode: d.mode ?? 'standard',
    ratio: d.ratio ?? '16:9',
    durationS: d.durationS ?? 8,
    resolution: d.resolution ?? '720p',
    audio: d.audio ?? true,
  });

  const model = VIDEO_MODELS.find((m) => m.id === (d.model ?? VIDEO_MODELS[0].id)) ?? VIDEO_MODELS[0];
  d.priceUsd = model.pricePerS * settings.durationS;

  return (
    <div className="canvas-card-wrap">
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <NodeFrame
        id={id}
        title={d.title}
        placeholder="video"
        icon={Film}
        status={d.status}
        hasResult={!!d.resultUrl}
        saveItem={d.resultUrl ? { kind: 'video', url: d.resultUrl, title: d.title, model: VIDEO_MODELS.find((m) => m.id === d.model)?.label ?? d.model, prompt: d.prompt } : null}
        onDownload={() => d.resultUrl && void downloadUrl(d.resultUrl, `${d.title || id}.mp4`)}
        onExpand={() => d.resultUrl && setLightboxSrc(d.resultUrl as string)}
        onMore={() => setSettingsOpen((v) => !v)}
        toolbarExtra={settingsOpen && (
          <VideoSettingsPanel
            value={settings}
            onChange={(next) => {
              setSettings(next);
              updateNodeData(id, { mode: next.mode, ratio: next.ratio, durationS: next.durationS, resolution: next.resolution, audio: next.audio });
            }}
          />
        )}
      >
        <VideoCard
          id={id}
          src={d.resultUrl}
          poster={d.posterUrl as string | undefined}
          status={d.status}
          progress={d.progress ?? 0}
          errorMessage={d.errorMessage as string | undefined}
          elapsedS={d.elapsedS as number | undefined}
        />
      </NodeFrame>
      <AddSideButton id={id} side="left" />
      <AddSideButton id={id} side="right" />
      <Handle type="source" position={Position.Right} id={`${id}-out`} />
      {lightboxSrc && (
        <Lightbox
          src={lightboxSrc}
          kind="video"
          onClose={() => setLightboxSrc(null)}
          onPrev={() => navLightbox(-1)}
          onNext={() => navLightbox(1)}
          meta={{
            prompt: d.prompt,
            model: VIDEO_MODELS.find((m) => m.id === d.model)?.label ?? d.model,
            quality: settings.resolution,
            ratio: settings.ratio,
            durationS: settings.durationS,
            createdAt: d.createdAt as number | undefined,
          }}
          onDownload={() => void downloadUrl(lightboxSrc, `${d.title || id}.mp4`)}
        />
      )}
    </div>
  );
}

// ── Music Gen ──
export function MusicGenNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as GenNodeData & { title?: string; lyricsMode?: LyricsMode; lyrics?: string };
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const { getNodes } = useReactFlow();
  const navLightbox = (dir: 1 | -1) => {
    const peers = getNodes().filter((n) => n.type === 'musicgen' && (n.data as GenNodeData)?.resultUrl);
    if (peers.length < 2) return;
    const idx = peers.findIndex((n) => (n.data as GenNodeData).resultUrl === lightboxSrc);
    const next = peers[(idx + dir + peers.length) % peers.length];
    setLightboxSrc((next.data as GenNodeData).resultUrl as string);
  };
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>(d.lyricsMode ?? 'adaptive');
  const [lyrics, setLyrics] = useState(d.lyrics ?? '');

  const model = MUSIC_MODELS.find((m) => m.id === (d.model ?? MUSIC_MODELS[0].id)) ?? MUSIC_MODELS[0];
  d.priceUsd = model.price;

  return (
    <div className="canvas-card-wrap">
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <NodeFrame
        id={id}
        title={d.title}
        placeholder="music"
        icon={Music}
        status={d.status}
        hasResult={!!d.resultUrl}
        saveItem={d.resultUrl ? { kind: 'audio', url: d.resultUrl, title: d.title, model: MUSIC_MODELS.find((m) => m.id === d.model)?.label ?? d.model, prompt: d.prompt } : null}
        onDownload={() => d.resultUrl && void downloadUrl(d.resultUrl, `${d.title || id}.mp3`)}
        onExpand={() => d.resultUrl && setLightboxSrc(d.resultUrl as string)}
        onMore={() => setLyricsOpen((v) => !v)}
        toolbarExtra={lyricsOpen && (
          <LyricsPanel
            mode={lyricsMode}
            lyrics={lyrics}
            onChange={(next) => {
              setLyricsMode(next.mode);
              setLyrics(next.lyrics);
              d.lyricsMode = next.mode;
              d.lyrics = next.lyrics;
            }}
          />
        )}
      >
        <div className="media-card">
          <CornerDelete id={id} />
          {d.resultUrl ? (
            <div className="media-audio-fill">
              <audio src={d.resultUrl} controls className="media-audio" />
            </div>
          ) : (
            <div className="media-placeholder">
              <Music size={26} strokeWidth={1.4} aria-hidden />
              <span>Select this node and type a prompt below</span>
            </div>
          )}
          {d.status === 'running' && (
            <div className="media-overlay">
              <Loader2 className="media-spin" size={20} aria-hidden />
              <div className="media-progress"><div style={{ width: `${(d.progress ?? 0) * 100}%` }} /></div>
            </div>
          )}
        </div>
      </NodeFrame>
      <AddSideButton id={id} side="left" />
      <AddSideButton id={id} side="right" />
      <Handle type="source" position={Position.Right} id={`${id}-out`} />
      {lightboxSrc && (
        <Lightbox
          src={lightboxSrc}
          kind="audio"
          onClose={() => setLightboxSrc(null)}
          onPrev={() => navLightbox(-1)}
          onNext={() => navLightbox(1)}
          meta={{
            prompt: d.prompt,
            model: MUSIC_MODELS.find((m) => m.id === d.model)?.label ?? d.model,
            createdAt: d.createdAt as number | undefined,
          }}
          onDownload={() => void downloadUrl(lightboxSrc, `${d.title || id}.mp3`)}
        />
      )}
    </div>
  );
}

// ── Text / LLM ──
export function TextNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as TextNodeData;
  const [prompt, setPrompt] = useState(d.prompt ?? '');
  const [, force] = useState(0);

  return (
    <div className="canvas-card-wrap">
    <div className="canvas-node node-text">
      <CornerDelete id={id} />
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <NodeHeader icon={Type} title="Text / LLM" status={d.status ?? 'idle'} />
      <div className="node-body">
        <ModelDropdown
          className="node-model-dd nodrag"
          placement="down"
          models={TEXT_MODELS.map((m) => ({ id: m.id, label: `${m.label} · $${m.priceK.toFixed(4)}/1k` }))}
          value={d.model ?? TEXT_MODELS[0].id}
          onChange={(id) => { d.model = id; force((n) => n + 1); }}
        />
        <textarea
          className="node-prompt"
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); d.prompt = e.target.value; }}
          placeholder="Prompt…"
          rows={3}
          aria-label="Text prompt"
        />
        {d.status === 'running' && <div className="node-progress" style={{ width: `${(d.progress ?? 0) * 100}%` }} />}
        {d.resultText && <div className="node-result-text">{d.resultText}</div>}
      </div>
      <Handle type="source" position={Position.Right} id={`${id}-out`} />
    </div>
      <AddSideButton id={id} side="left" />
      <AddSideButton id={id} side="right" />
    </div>
  );
}

// ── Group / frame ──
export function GroupNode({ data, id, selected }: NodeProps) {
  const d = data as { label?: string };
  return (
    <div className="canvas-group">
      <CornerDelete id={id} />
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        lineClassName="group-resize-line"
        handleClassName="group-resize-handle"
      />
      <div className="group-label">
        <SquareDashed size={11} strokeWidth={1.5} aria-hidden />
        <span>{d.label ?? 'Group'}</span>
      </div>
    </div>
  );
}

// ── Timeline / Playlist ──
// Horizontal time-axis playlist for chaining finished video/music clips —
// the "assemble" step that closes the generate → arrange → cut loop.
// Each clip lays down on a real time ruler based on its duration so the
// overall length is visible at a glance, like a non-destructive NLE
// timeline.
interface TimelineClip {
  id: string;
  url: string;
  kind: 'video' | 'audio';
  label: string;
  durationS: number;      // length kept on the timeline (after trimming)
  srcDurationS?: number;  // full source length — the cap when trimming back out
  inS?: number;           // trim-in: seconds into the source where this clip starts
}

// Track length the ruler renders to: the bigger of the actual clip total
// or this floor. Empty timeline still reads "0:00 → 0:30", which lets
// users size the picker before they have any clips on it.
const TIMELINE_MIN_DURATION = 30;
// Pixels per second on the visible track. Tuned so the track reads like a
// real NLE — wide enough that sub-second trims feel precise.
const TIMELINE_PX_PER_SEC = 20;
// Smallest a clip can be trimmed to (seconds).
const TIMELINE_MIN_CLIP = 0.5;

const round1 = (v: number) => Math.round(v * 10) / 10;
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
// Short clock for clip chips: drop the leading 0 minutes when under a minute
// (e.g. 4.0s → "4.0s", 72.5s → "1:12").
function formatClip(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s.toFixed(1)}s`;
  return formatMmSs(s);
}

type DragMode = 'move' | 'trim-l' | 'trim-r';

export function TimelineNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as { title?: string; clips?: TimelineClip[] };
  const clips = d.clips ?? [];
  const { updateNodeData } = useReactFlow();
  const { exportTimeline } = useCanvasCtx();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Floating readout shown while dragging/trimming (duration / drop position).
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  // Timeline zoom = pixels per second. Lets you spread short 4–8s clips wide
  // enough to trim precisely, or zoom out to see a long cut at a glance.
  const [pps, setPps] = useState(TIMELINE_PX_PER_SEC);

  // React Flow scales the DOM via a CSS transform, so screen-pixel deltas must
  // be divided by the zoom to recover canvas pixels (→ seconds). Read it live.
  const zoom = useStore((s) => s.transform[2]);

  // Latest clips snapshot for pointer handlers (updateNodeData has no functional
  // form, so handlers read/write against this ref to avoid stale closures).
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  // True while a clip is being dragged/trimmed — suppresses hover-scrub.
  const draggingRef = useRef(false);

  // Pull every finished video/music clip from the canvas, capturing each
  // source node's durationS so the track can lay them out proportionally.
  const available = useStore((s) => {
    const out: TimelineClip[] = [];
    for (const n of s.nodes) {
      const nd = n.data as { resultUrl?: string; title?: string; durationS?: number };
      if (n.type === 'videogen' && nd.resultUrl) {
        out.push({ id: n.id, url: nd.resultUrl, kind: 'video', label: nd.title || 'video', durationS: nd.durationS ?? 8 });
      } else if (n.type === 'musicgen' && nd.resultUrl) {
        out.push({ id: n.id, url: nd.resultUrl, kind: 'audio', label: nd.title || 'music', durationS: nd.durationS ?? 60 });
      }
    }
    return out;
  });

  const videoClips = clips.filter((c) => c.kind === 'video');
  const audioClips = clips.filter((c) => c.kind === 'audio');
  const videoTotal = videoClips.reduce((a, c) => a + (c.durationS || 0), 0);
  const audioTotal = audioClips.reduce((a, c) => a + (c.durationS || 0), 0);
  const total = Math.max(videoTotal, audioTotal);
  // Round track length up to the next 5s so the ruler ends on a clean tick.
  const trackSeconds = Math.max(TIMELINE_MIN_DURATION, Math.ceil(total / 5) * 5);
  const trackWidthPx = trackSeconds * pps;
  // Tick spacing adapts to zoom so labels never crowd (keep ≥ 48px apart).
  let tickStep = trackSeconds > 60 ? 10 : 5;
  while (tickStep * pps < 48) tickStep *= 2;
  const ticks: number[] = [];
  for (let t = 0; t <= trackSeconds; t += tickStep) ticks.push(t);
  const gridPx = `${tickStep * pps}px`;

  const setClips = (next: TimelineClip[]) => updateNodeData(id, { clips: next });
  const addClip = (c: TimelineClip) => {
    const src = c.durationS || 0;
    setClips([...clipsRef.current, { ...c, id: `${c.id}-${Date.now()}`, srcDurationS: c.srcDurationS ?? src, inS: 0, durationS: src }]);
    setPickerOpen(false);
  };
  const removeClip = (cid: string) => setClips(clipsRef.current.filter((c) => c.id !== cid));

  // Lay a lane out left→right by cumulative trimmed duration (canvas px).
  const layout = (lane: TimelineClip[]) => {
    let off = 0;
    return lane.map((c) => {
      const left = off * pps;
      const width = Math.max(14, (c.durationS || 0) * pps);
      off += c.durationS || 0;
      return { ...c, leftPx: left, widthPx: width };
    });
  };
  const placedVideo = layout(videoClips);
  const placedAudio = layout(audioClips);

  // Rebuild the global clips array after reordering one lane, leaving the other
  // lane's clips in their original slots.
  const applyLaneOrder = (kind: 'video' | 'audio', laneOrder: TimelineClip[]) => {
    const q = [...laneOrder];
    return clipsRef.current.map((c) => (c.kind === kind ? (q.shift() as TimelineClip) : c));
  };
  const patchClip = (cid: string, patch: Partial<TimelineClip>) =>
    setClips(clipsRef.current.map((c) => (c.id === cid ? { ...c, ...patch } : c)));

  // Pointer-driven drag: body = reorder within lane, edges = trim in/out. Done
  // on window listeners so the gesture survives leaving the small handle.
  const startDrag = (e: React.PointerEvent, clip: TimelineClip, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    const kind = clip.kind;
    const startX = e.clientX;
    const origIn = clip.inS ?? 0;
    const origDur = clip.durationS || 0;
    const srcDur = clip.srcDurationS ?? origDur;
    setDragId(clip.id);
    draggingRef.current = true;
    let moved = false;

    // px → seconds at the current timeline zoom AND canvas zoom.
    const secAt = (ev: PointerEvent) => ((ev.clientX - startX) / (ppsRef.current * (zoomRef.current || 1)));
    // Magnetic snap to the nearest whole second when within ~7px — gives the
    // "clicks into place" feel of a real NLE without blocking fine control.
    const snap = (sec: number) => {
      const whole = Math.round(sec);
      return Math.abs(sec - whole) * ppsRef.current <= 7 ? whole : round1(sec);
    };

    const onMove = (ev: PointerEvent) => {
      const dSec = secAt(ev);
      if (mode === 'trim-r') {
        const nd = clampN(snap(origDur + dSec), TIMELINE_MIN_CLIP, Math.max(TIMELINE_MIN_CLIP, srcDur - origIn));
        patchClip(clip.id, { durationS: nd });
        setTip({ x: ev.clientX, y: ev.clientY, text: `${formatClip(nd)}` });
      } else if (mode === 'trim-l') {
        const nIn = clampN(snap(origIn + dSec), 0, origIn + origDur - TIMELINE_MIN_CLIP);
        const nd = round1(origDur - (nIn - origIn));
        patchClip(clip.id, { inS: nIn, durationS: nd });
        setTip({ x: ev.clientX, y: ev.clientY, text: `${formatClip(nd)}` });
      } else {
        // Reorder: find where the dragged clip's new center lands among the
        // lane's clip widths, then splice it there.
        moved = true;
        const ppsNow = ppsRef.current;
        const lane = clipsRef.current.filter((c) => c.kind === kind);
        const from = lane.findIndex((c) => c.id === clip.id);
        if (from < 0) return;
        let acc = 0;
        const lefts = lane.map((c) => { const l = acc; acc += (c.durationS || 0) * ppsNow; return l; });
        const draggedLeft = lefts[from] + (ev.clientX - startX) / (zoomRef.current || 1);
        const center = draggedLeft + ((clip.durationS || 0) * ppsNow) / 2;
        let to = 0;
        for (let i = 0; i < lane.length; i++) {
          const mid = lefts[i] + ((lane[i].durationS || 0) * ppsNow) / 2;
          if (center > mid) to = i; else break;
        }
        setTip({ x: ev.clientX, y: ev.clientY, text: `#${to + 1}` });
        if (to !== from) {
          const next = [...lane];
          const [m] = next.splice(from, 1);
          next.splice(to, 0, m);
          setClips(applyLaneOrder(kind, next));
        }
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragId(null);
      setTip(null);
      draggingRef.current = false;
      void moved;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Hover-scrub: moving the cursor across a video clip seeks its preview frame
  // to that point in the (trimmed) clip — like CapCut / Finder Quick Look.
  const scrubThumb = (e: React.PointerEvent<HTMLVideoElement>, clip: TimelineClip) => {
    if (draggingRef.current) return;
    const v = e.currentTarget;
    const rect = v.getBoundingClientRect();
    const f = clampN((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const t = (clip.inS ?? 0) + f * (clip.durationS || 0);
    if (Number.isFinite(t)) { try { v.currentTime = t; } catch { /* not seekable yet */ } }
  };
  const resetThumb = (e: React.PointerEvent<HTMLVideoElement>, clip: TimelineClip) => {
    const v = e.currentTarget;
    try { v.currentTime = clip.inS ?? 0; } catch { /* ignore */ }
  };
  // Double-click a trim handle to reset that clip back to its full source length.
  const untrim = (clip: TimelineClip) =>
    patchClip(clip.id, { inS: 0, durationS: clip.srcDurationS ?? clip.durationS });

  const renderBlock = (c: ReturnType<typeof layout>[number], i: number) => (
    <div
      key={c.id}
      className={`timeline-block ${c.kind === 'audio' ? 'is-audio' : ''} ${dragId === c.id ? 'is-dragging' : ''}`}
      style={{ left: c.leftPx, width: c.widthPx }}
      title={`${c.label} · ${formatClip(c.durationS)}`}
      onPointerDown={(e) => startDrag(e, c, 'move')}
    >
      <span
        className="timeline-trim timeline-trim-l nodrag"
        onPointerDown={(e) => startDrag(e, c, 'trim-l')}
        onDoubleClick={() => untrim(c)}
        aria-label="Trim start"
      />
      {c.kind === 'video' ? (
        <video
          src={c.url}
          preload="metadata"
          muted
          className="timeline-block-thumb"
          onPointerMove={(e) => scrubThumb(e, c)}
          onPointerLeave={(e) => resetThumb(e, c)}
        />
      ) : (
        <div className="timeline-block-thumb timeline-block-audio"><Music size={16} aria-hidden /></div>
      )}
      <div className="timeline-block-meta">
        <span className="timeline-block-idx">{i + 1}</span>
        <span className="timeline-block-label">{c.label}</span>
        <span className="timeline-block-dur">{formatClip(c.durationS)}</span>
      </div>
      <button
        type="button"
        className="timeline-block-x nodrag"
        aria-label="Remove clip"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => removeClip(c.id)}
      >
        <X size={11} aria-hidden />
      </button>
      <span
        className="timeline-trim timeline-trim-r nodrag"
        onPointerDown={(e) => startDrag(e, c, 'trim-r')}
        onDoubleClick={() => untrim(c)}
        aria-label="Trim end"
      />
    </div>
  );

  const canExport = videoClips.length >= 2;

  return (
    <div className="canvas-card-wrap">
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <Handle type="source" position={Position.Bottom} id={`${id}-out`} />
      <div className="canvas-node node-timeline">
        <CornerDelete id={id} />
        <div className="timeline-head">
          <Clapperboard size={13} strokeWidth={1.75} aria-hidden />
          <span>{d.title || 'Timeline'}</span>
          <span className="timeline-head-spacer" />
          <span className="timeline-head-total">{formatMmSs(total)} / {formatMmSs(trackSeconds)}</span>
          <div className="timeline-zoom nodrag" role="group" aria-label="Timeline zoom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={pps <= 8}
              onClick={() => setPps((p) => clampN(round1(p / 1.4), 8, 80))}
            >−</button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={pps >= 80}
              onClick={() => setPps((p) => clampN(round1(p * 1.4), 8, 80))}
            >+</button>
          </div>
          <button
            type="button"
            className="timeline-export nodrag"
            disabled={!canExport}
            title={canExport ? 'Render the cut into one film' : 'Add at least 2 video clips to export'}
            onClick={() => exportTimeline(id, clipsRef.current.map(({ url, kind, inS, durationS }) => ({ url, kind, inS, durationS })))}
          >
            <Film size={12} aria-hidden /> Export
          </button>
        </div>

        <div
          className="timeline-track nowheel"
          style={{ width: trackWidthPx + 24 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ruler */}
          <div className="timeline-ruler" style={{ width: trackWidthPx }}>
            {ticks.map((t) => (
              <span key={t} className="timeline-tick" style={{ left: t * pps }}>
                {formatMmSs(t)}
              </span>
            ))}
          </div>

          {/* Video lane */}
          <div
            className="timeline-lane timeline-lane-video"
            style={{ width: trackWidthPx, ['--tl-grid' as string]: gridPx } as CSSProperties}
          >
            {placedVideo.length === 0 ? (
              <div className="timeline-empty-pop">
                <button
                  type="button"
                  className="timeline-empty-plus nodrag"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Add a clip"
                >
                  <Plus size={26} strokeWidth={2} aria-hidden />
                </button>
                <span className="timeline-empty-hint">Tap + to pick a clip from the canvas</span>
              </div>
            ) : (
              placedVideo.map((c, i) => renderBlock(c, i))
            )}
          </div>

          {/* Audio / music lane — only shown once a soundtrack is added. */}
          {placedAudio.length > 0 && (
            <div
              className="timeline-lane timeline-lane-audio"
              style={{ width: trackWidthPx, ['--tl-grid' as string]: gridPx } as CSSProperties}
            >
              {placedAudio.map((c, i) => renderBlock(c, i))}
            </div>
          )}

          <div className="timeline-add-floating">
            <button
              type="button"
              className="timeline-add nodrag"
              aria-label="Add clip"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus size={16} aria-hidden />
            </button>
          </div>

          {pickerOpen && (
            <div className="timeline-picker nodrag" role="dialog" aria-label="Pick a clip">
              {available.length === 0
                ? <div className="timeline-picker-empty">No finished video / music clips on the canvas yet.</div>
                : available.map((c) => (
                  <button key={c.id} type="button" className="timeline-picker-item" onClick={() => addClip(c)}>
                    {c.kind === 'video' ? <Film size={13} aria-hidden /> : <Music size={13} aria-hidden />}
                    <span>{c.label}</span>
                    <span className="timeline-picker-dur">{formatClip(c.durationS)}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
      <AddSideButton id={id} side="left" />
      {tip && createPortal(
        <div className="timeline-tip" style={{ left: tip.x + 14, top: tip.y + 16 }}>{tip.text}</div>,
        document.body,
      )}
    </div>
  );
}

export const NODE_TYPES = {
  upload: UploadNode,
  imagegen: ImageGenNode,
  videogen: VideoGenNode,
  musicgen: MusicGenNode,
  text: TextNode,
  group: GroupNode,
  timeline: TimelineNode,
};

// Metadata for the node drawer + popups
export type NodeCategory = 'generate' | 'utility' | 'resource';
export interface NodeCatalogEntry {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  icon: typeof Upload;
  defaultData: Record<string, unknown>;
  beta?: boolean;
  dot?: boolean;
}

export const NODE_CATALOG: NodeCatalogEntry[] = [
  // Generate
  { type: 'text', label: 'Text', description: 'Scripts, ad copy, brand voice', category: 'generate', icon: Type,
    defaultData: { model: TEXT_MODELS[0].id, prompt: '', priceUsd: 0 } },
  { type: 'imagegen', label: 'Image', description: 'Photoreal, stylized, anime', category: 'generate', icon: ImageIcon,
    defaultData: { model: IMAGE_MODELS[0].id, prompt: '', priceUsd: IMAGE_MODELS[0].price } },
  { type: 'videogen', label: 'Video', description: '5–30s clips, multi-model', category: 'generate', icon: Film,
    defaultData: { model: VIDEO_MODELS[0].id, prompt: '', priceUsd: VIDEO_MODELS[0].pricePerS * 8, durationS: 8, audio: true } },
  { type: 'musicgen', label: 'Music', description: '~3min tracks with optional lyrics', category: 'generate', icon: Music,
    defaultData: { model: MUSIC_MODELS[0].id, prompt: '', priceUsd: MUSIC_MODELS[0].price, lyricsMode: 'adaptive', lyrics: '' } },
  // Utility
  { type: 'timeline', label: 'Timeline', description: 'Sequence clips into a cut', category: 'utility', icon: Clapperboard,
    defaultData: { clips: [] } },
  { type: 'group', label: 'Group / Frame', description: 'Visually group nodes', category: 'utility', icon: SquareDashed,
    defaultData: { label: 'Group' } },
  // Resource
  { type: 'upload', label: 'Upload', description: 'Drop or pick a reference image', category: 'resource', icon: ImagePlus,
    defaultData: {} },
];

export const CATEGORY_TITLES: Record<NodeCategory, string> = {
  generate: 'Generate',
  utility: 'Utility',
  resource: 'Resource',
};
