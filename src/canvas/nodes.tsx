// Node types mirror what the BlockRun gateway actually serves through Franklin.
// Image / video catalogs are the known-valid models on the BlockRun gateway.

import { Handle, NodeResizer, Position, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useEffect, useState, useRef } from 'react';
import { Upload, ImageIcon, Film, Type, SquareDashed, Target, Clapperboard, ImagePlus, Upload as ReplaceIcon, Loader2, Music, X, Plus, Download, Copy, Check } from 'lucide-react';
import NodeFrame from './NodeFrame';
import NodeActionMenu from './NodeActionMenu';
import VideoSettingsPanel, { type VideoSettings, type AspectRatio } from './VideoSettingsPanel';
import LyricsPanel, { type LyricsMode } from './LyricsPanel';
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
  { id: 'xai/grok-imagine-video', label: 'Grok Imagine', pricePerS: 0.05 },
  { id: 'bytedance/seedance-1.5-pro', label: 'Seedance 1.5 Pro', pricePerS: 0.092 },
  { id: 'azure/sora-2', label: 'Sora 2', pricePerS: 0.10 },
  { id: 'bytedance/seedance-2.0-fast', label: 'Seedance 2.0 Fast', pricePerS: 0.238 },
  { id: 'bytedance/seedance-2.0', label: 'Seedance 2.0 Pro', pricePerS: 0.298 },
];

export const MUSIC_MODELS = [
  { id: 'minimax/music-2.5+', label: 'MiniMax Music 2.5+', price: 0.15 },
];

// per 1k tokens (blended ~50/50 input/output for display purposes; real cost
// depends on actual prompt + completion size). Gateway IDs use dots, not
// hyphens (e.g. claude-opus-4.7) — getting that wrong means a 404 at send.
export const TEXT_MODELS = [
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', priceK: 0.003 },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', priceK: 0.009 },
  { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', priceK: 0.015 },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8', priceK: 0.015 },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', priceK: 0.0175 },
  { id: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro', priceK: 0.007 },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', priceK: 0.0014 },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', priceK: 0.00075 },
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
        <Lightbox src={d.imageUrl} kind="image" onClose={() => setUploadLightbox(false)} />
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
        className="media-fill media-video nodrag"
        data-testid="canvas-node-video-content"
        onPointerDown={(e) => e.stopPropagation()}
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
        <select className="node-model" value={d.model ?? TEXT_MODELS[0].id} onChange={(e) => { d.model = e.target.value; force((n) => n + 1); }} aria-label="Text model">
          {TEXT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label} · ${m.priceK.toFixed(4)}/1k</option>
          ))}
        </select>
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

// ── Result ──
export function ResultNode({ data, id }: NodeProps) {
  const d = data as BaseNodeData;
  const [copied, setCopied] = useState(false);
  // Pick a sensible filename extension from the URL (best-effort).
  const ext = (d.resultUrl?.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav)(?:$|\?)/i)?.[1] || 'png').toLowerCase();
  const onDownload = () => { if (d.resultUrl) void downloadUrl(d.resultUrl, `result-${id}.${ext}`); };
  const onCopyText = async () => {
    if (!d.resultText) return;
    try {
      await navigator.clipboard.writeText(d.resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="canvas-node node-result">
      <CornerDelete id={id} />
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <NodeHeader icon={Target} title="Result" status={d.status ?? 'idle'} />
      <div className="node-body">
        {d.resultUrl ? <img src={d.resultUrl} alt="Output" className="node-thumb" />
          : d.resultText ? <pre className="node-result-text">{d.resultText}</pre>
            : <span className="dim">No output yet</span>}
      </div>
      {(d.resultUrl || d.resultText) && (
        <div className="node-result-actions">
          {d.resultUrl && (
            <button type="button" className="node-result-action" onClick={onDownload} title="Download result">
              <Download size={12} aria-hidden /> Download
            </button>
          )}
          {d.resultText && (
            <button type="button" className="node-result-action" onClick={onCopyText} title="Copy text result">
              {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {copied ? 'Copied' : 'Copy text'}
            </button>
          )}
        </div>
      )}
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
interface TimelineClip { id: string; url: string; kind: 'video' | 'audio'; label: string; durationS: number; }

// Track length the ruler renders to: the bigger of the actual clip total
// or this floor. Empty timeline still reads "0:00 → 1:00", which lets
// users size the picker before they have any clips on it.
const TIMELINE_MIN_DURATION = 60;
// Pixels per second on the visible track. Tuned so a 60s timeline is
// roughly the width of a generous canvas card (~960px).
const TIMELINE_PX_PER_SEC = 16;

function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function TimelineNode({ data, id }: NodeProps) {
  useRefreshHandles(id);
  const d = data as { title?: string; clips?: TimelineClip[] };
  const clips = d.clips ?? [];
  const { updateNodeData } = useReactFlow();
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const total = clips.reduce((acc, c) => acc + (c.durationS || 0), 0);
  // Round track length up to the next 10s so the ruler always ends on a
  // clean tick (e.g. 47s of clips → 50s track, 63s → 70s).
  const trackSeconds = Math.max(TIMELINE_MIN_DURATION, Math.ceil(total / 10) * 10);
  const trackWidthPx = trackSeconds * TIMELINE_PX_PER_SEC;
  const ticks: number[] = [];
  for (let t = 0; t <= trackSeconds; t += 10) ticks.push(t);

  const setClips = (next: TimelineClip[]) => updateNodeData(id, { clips: next });
  const addClip = (c: TimelineClip) => {
    setClips([...clips, { ...c, id: `${c.id}-${Date.now()}` }]);
    setPickerOpen(false);
  };
  const removeClip = (i: number) => setClips(clips.filter((_, idx) => idx !== i));

  // Cumulative offsets used to position each clip block on the track.
  let offset = 0;
  const placed = clips.map((c) => {
    const x = offset;
    offset += c.durationS || 0;
    return { ...c, leftPx: x * TIMELINE_PX_PER_SEC, widthPx: Math.max(20, (c.durationS || 0) * TIMELINE_PX_PER_SEC) };
  });

  return (
    <div className="canvas-card-wrap">
      <Handle type="target" position={Position.Left} id={`${id}-in`} />
      <div className="canvas-node node-timeline">
        <CornerDelete id={id} />
        <div className="timeline-head">
          <Clapperboard size={13} strokeWidth={1.75} aria-hidden />
          <span>Playlist</span>
          <span className="timeline-head-spacer" />
          <span className="timeline-head-total">{formatMmSs(total)} / {formatMmSs(trackSeconds)}</span>
        </div>

        <div
          className="timeline-track nodrag"
          style={{ width: trackWidthPx + 24 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ruler — fixed ticks every 10s. */}
          <div className="timeline-ruler" style={{ width: trackWidthPx }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="timeline-tick"
                style={{ left: t * TIMELINE_PX_PER_SEC }}
              >
                {formatMmSs(t)}
              </span>
            ))}
          </div>

          <div className="timeline-strip" style={{ width: trackWidthPx }}>
            {placed.length === 0 ? (
              <div className="timeline-empty-pop">
                <button
                  type="button"
                  className="timeline-empty-plus"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Add a clip"
                >
                  <Plus size={28} strokeWidth={2} aria-hidden />
                </button>
                <span className="timeline-empty-hint">Tap + to pick a clip from the canvas</span>
              </div>
            ) : (
              placed.map((c, i) => (
                <div
                  key={c.id}
                  className={`timeline-block ${c.kind === 'audio' ? 'is-audio' : ''}`}
                  style={{ left: c.leftPx, width: c.widthPx }}
                  title={`${c.label} · ${formatMmSs(c.durationS)}`}
                >
                  {c.kind === 'video' ? (
                    <video src={c.url} preload="metadata" muted className="timeline-block-thumb" />
                  ) : (
                    <div className="timeline-block-thumb timeline-block-audio"><Music size={18} aria-hidden /></div>
                  )}
                  <div className="timeline-block-meta">
                    <span className="timeline-block-idx">{i + 1}</span>
                    <span className="timeline-block-label">{c.label}</span>
                    <span className="timeline-block-dur">{formatMmSs(c.durationS)}</span>
                  </div>
                  <button
                    type="button"
                    className="timeline-block-x"
                    aria-label="Remove clip"
                    onClick={() => removeClip(i)}
                  >
                    <X size={11} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>

          {placed.length > 0 && (
            <div className="timeline-add-floating">
              <button
                type="button"
                className="timeline-add"
                aria-label="Add clip"
                onClick={() => setPickerOpen((v) => !v)}
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
          )}

          {pickerOpen && (
            <div className="timeline-picker" role="dialog" aria-label="Pick a clip">
              {available.length === 0
                ? <div className="timeline-picker-empty">No finished video / music clips on the canvas yet.</div>
                : available.map((c) => (
                  <button key={c.id} type="button" className="timeline-picker-item" onClick={() => addClip(c)}>
                    {c.kind === 'video' ? <Film size={13} aria-hidden /> : <Music size={13} aria-hidden />}
                    <span>{c.label}</span>
                    <span className="timeline-picker-dur">{formatMmSs(c.durationS)}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
      <AddSideButton id={id} side="left" />
    </div>
  );
}

export const NODE_TYPES = {
  upload: UploadNode,
  imagegen: ImageGenNode,
  videogen: VideoGenNode,
  musicgen: MusicGenNode,
  text: TextNode,
  result: ResultNode,
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
    defaultData: { model: VIDEO_MODELS[0].id, prompt: '', priceUsd: VIDEO_MODELS[0].pricePerS * 8, durationS: 8 } },
  { type: 'musicgen', label: 'Music', description: '~3min tracks with optional lyrics', category: 'generate', icon: Music,
    defaultData: { model: MUSIC_MODELS[0].id, prompt: '', priceUsd: MUSIC_MODELS[0].price, lyricsMode: 'adaptive', lyrics: '' } },
  // Utility
  { type: 'timeline', label: 'Timeline', description: 'Sequence clips into a cut', category: 'utility', icon: Clapperboard,
    defaultData: { clips: [] } },
  { type: 'group', label: 'Group / Frame', description: 'Visually group nodes', category: 'utility', icon: SquareDashed,
    defaultData: { label: 'Group' } },
  { type: 'result', label: 'Result', description: 'Final output preview', category: 'utility', icon: Target,
    defaultData: {} },
  // Resource
  { type: 'upload', label: 'Upload', description: 'Drop or pick a reference image', category: 'resource', icon: ImagePlus,
    defaultData: {} },
];

export const CATEGORY_TITLES: Record<NodeCategory, string> = {
  generate: 'Generate',
  utility: 'Utility',
  resource: 'Resource',
};
