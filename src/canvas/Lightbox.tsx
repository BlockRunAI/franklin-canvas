// Fullscreen media preview overlay for a node's result. Click backdrop or
// press Escape to close; optional prev/next to page through sibling results.

import { useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  src: string;
  kind: 'image' | 'video' | 'audio';
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function Lightbox({ src, kind, onClose, onPrev, onNext }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev?.();
      else if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Preview">
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><X size={20} aria-hidden /></button>
      {onPrev && (
        <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous">
          <ChevronLeft size={28} aria-hidden />
        </button>
      )}
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {kind === 'image' && <img src={src} alt="" className="lightbox-media" />}
        {kind === 'video' && <video src={src} controls autoPlay className="lightbox-media" />}
        {kind === 'audio' && <audio src={src} controls autoPlay className="lightbox-audio" />}
      </div>
      {onNext && (
        <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Next">
          <ChevronRight size={28} aria-hidden />
        </button>
      )}
    </div>
  );
}
