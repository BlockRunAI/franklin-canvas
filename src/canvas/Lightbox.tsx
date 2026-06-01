// Fullscreen media preview — Quick Look-style.
// Default mode: image fit-to-viewport (object-fit: contain).
// Click the image: toggle into "actual size" mode where the stage scrolls
// natively. Click again to return to fit. Esc / backdrop click to close.
// Video & audio use the browser's native controls.
//
// The transform-based pan/zoom from the previous revision was tricky to
// keep in sync (stale closures + clipped strip on rapid wheel events).
// Native overflow:auto on the stage gives the same pannable feel for free
// and matches what users expect from system-level image viewers.

import { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  src: string;
  kind: 'image' | 'video' | 'audio';
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function Lightbox({ src, kind, onClose, onPrev, onNext }: Props) {
  const [zoomed, setZoomed] = useState(false);

  // Reset zoom whenever the source changes (clicking next/prev).
  useEffect(() => { setZoomed(false); }, [src]);

  // Suppress floating React Flow node toolbars / corner-delete / add-side
  // while the preview is open — those portal to body and used to bleed
  // over the image.
  useEffect(() => {
    document.body.classList.add('is-previewing');
    return () => document.body.classList.remove('is-previewing');
  }, []);

  // Keyboard: Esc close, arrows = prev/next (also reset zoom), space toggles
  // zoom on images.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') { setZoomed(false); onPrev?.(); }
      else if (e.key === 'ArrowRight') { setZoomed(false); onNext?.(); }
      else if (e.key === ' ' && kind === 'image') { e.preventDefault(); setZoomed((z) => !z); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, kind]);

  const onImageClick = (e: React.MouseEvent) => {
    if (kind !== 'image') return;
    e.stopPropagation();
    setZoomed((z) => !z);
  };

  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Preview">
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><X size={20} aria-hidden /></button>
      {onPrev && (
        <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); setZoomed(false); onPrev(); }} aria-label="Previous">
          <ChevronLeft size={28} aria-hidden />
        </button>
      )}
      <div
        className={`lightbox-stage ${zoomed ? 'is-zoomed' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {kind === 'image' && (
          <img
            src={src}
            alt=""
            className="lightbox-media"
            draggable={false}
            onClick={onImageClick}
            style={{ cursor: zoomed ? 'zoom-out' : 'zoom-in' }}
          />
        )}
        {kind === 'video' && <video src={src} controls autoPlay className="lightbox-media" />}
        {kind === 'audio' && <audio src={src} controls autoPlay className="lightbox-audio" />}
      </div>
      {onNext && (
        <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); setZoomed(false); onNext(); }} aria-label="Next">
          <ChevronRight size={28} aria-hidden />
        </button>
      )}
    </div>
  );
}
