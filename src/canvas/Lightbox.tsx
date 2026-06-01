// Windowed preview dialog — image on the left, prompt + info on the right.
// Backdrop click or Escape closes; arrow keys page through siblings; the
// info panel exposes the generation metadata (model, quality, ratio,
// file size, date, creator) plus a Download button.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';
import { useT } from '../i18n';

export interface PreviewMeta {
  prompt?: string;
  model?: string;       // human label, e.g. "Nano Banana Pro"
  quality?: string;     // e.g. "2K", "1080p"
  ratio?: string;       // e.g. "16:9"
  durationS?: number;   // video only
  createdAt?: number;   // epoch ms
  creator?: string;     // display name
}

interface Props {
  src: string;
  kind: 'image' | 'video' | 'audio';
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  meta?: PreviewMeta;
  onDownload?: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export default function Lightbox({ src, kind, onClose, onPrev, onNext, meta, onDownload }: Props) {
  const t = useT();
  const [fileSize, setFileSize] = useState<number | null>(null);

  useEffect(() => {
    document.body.classList.add('is-previewing');
    return () => document.body.classList.remove('is-previewing');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // Measure the resource size — the asset is already cached after the node
  // rendered it, so fetch() resolves from cache. data: URLs compute locally.
  useEffect(() => {
    let cancelled = false;
    setFileSize(null);
    if (src.startsWith('data:')) {
      const idx = src.indexOf(',');
      if (idx >= 0) {
        const b64 = src.slice(idx + 1);
        // base64 → bytes: 4 chars => 3 bytes, minus padding.
        const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
        setFileSize(Math.floor((b64.length * 3) / 4) - pad);
      }
      return;
    }
    fetch(src, { method: 'GET', cache: 'force-cache' })
      .then((r) => r.blob())
      .then((b) => { if (!cancelled) setFileSize(b.size); })
      .catch(() => { /* size remains null — drop the row */ });
    return () => { cancelled = true; };
  }, [src]);

  // Portal to <body> — a React Flow node carries a CSS transform, and a
  // fixed-position child is positioned relative to the nearest transformed
  // ancestor, not the viewport. Without this the window renders trapped
  // inside the node's box.
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('preview_title')}>
      <div className="preview-window" onClick={(e) => e.stopPropagation()}>
        <div className="preview-media">
          {kind === 'image' && <img src={src} alt="" className="preview-media-img" draggable={false} />}
          {kind === 'video' && <video src={src} controls autoPlay className="preview-media-video" />}
          {kind === 'audio' && <audio src={src} controls autoPlay className="preview-media-audio" />}
        </div>

        <aside className="preview-info">
          <header className="preview-info-head">
            <h2>{t('preview_prompt')}</h2>
            <button className="preview-close" onClick={onClose} aria-label={t('preview_close')}>
              <X size={18} aria-hidden />
            </button>
          </header>

          <div className="preview-info-card preview-prompt-card">
            {meta?.prompt
              ? <p className="preview-prompt-text">{meta.prompt}</p>
              : <p className="preview-prompt-empty">—</p>}
          </div>

          <h3 className="preview-info-section">{t('preview_info')}</h3>
          <div className="preview-info-card preview-info-kv">
            {meta?.model && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_model')}</span>
                <span className="preview-kv-val">{meta.model}</span>
              </div>
            )}
            {meta?.quality && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_quality')}</span>
                <span className="preview-kv-val">{meta.quality}</span>
              </div>
            )}
            {meta?.ratio && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_ratio')}</span>
                <span className="preview-kv-val">{meta.ratio}</span>
              </div>
            )}
            {typeof meta?.durationS === 'number' && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_duration')}</span>
                <span className="preview-kv-val">{meta.durationS}s</span>
              </div>
            )}
            {fileSize != null && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_filesize')}</span>
                <span className="preview-kv-val">{formatBytes(fileSize)}</span>
              </div>
            )}
            {meta?.createdAt && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_date')}</span>
                <span className="preview-kv-val">{formatDate(meta.createdAt)}</span>
              </div>
            )}
            {meta?.creator && (
              <div className="preview-kv-row">
                <span className="preview-kv-key">{t('preview_creator')}</span>
                <span className="preview-kv-val">{meta.creator}</span>
              </div>
            )}
          </div>

          {onDownload && (
            <button className="preview-download-btn" onClick={onDownload}>
              <Download size={15} aria-hidden />
              <span>{t('preview_download')}</span>
            </button>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
