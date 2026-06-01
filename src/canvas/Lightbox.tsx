// Fullscreen media preview — Quick Look-style: scroll-wheel / pinch to zoom
// centered on the cursor, click-and-drag to pan when zoomed in, double-click
// to toggle 1× ↔ fit, Esc / backdrop click to close. Only the image branch
// has zoom/pan; video & audio fall back to the browser's native controls.

import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  src: string;
  kind: 'image' | 'video' | 'audio';
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.2;

export default function Lightbox({ src, kind, onClose, onPrev, onNext }: Props) {
  // All three transform values in ONE state object so the functional
  // updater can read them atomically — rapid wheel events were producing
  // drift because separate setScale / setTx / setTy closures saw stale
  // values from previous renders. With a single setView((v) => …) every
  // event reads the latest committed transform.
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const RESET = { scale: 1, tx: 0, ty: 0 };
  const dragRef = useRef<{ startX: number; startY: number; tx0: number; ty0: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Reset transform whenever the source changes (clicking next/prev).
  useEffect(() => { setView(RESET); /* eslint-disable-next-line */ }, [src]);

  // Suppress floating React Flow node toolbars while the preview is open —
  // those NodeToolbars portal to body and used to bleed over the image.
  useEffect(() => {
    document.body.classList.add('is-previewing');
    return () => document.body.classList.remove('is-previewing');
  }, []);

  // Keyboard: esc / arrows / +/- / 0 to reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') { setView(RESET); onPrev?.(); }
      else if (e.key === 'ArrowRight') { setView(RESET); onNext?.(); }
      else if (e.key === '+' || e.key === '=') setView((v) => ({ ...v, scale: Math.min(ZOOM_MAX, v.scale + ZOOM_STEP) }));
      else if (e.key === '-' || e.key === '_') setView((v) => {
        const next = Math.max(ZOOM_MIN, v.scale - ZOOM_STEP);
        return next === 1 ? RESET : { ...v, scale: next };
      });
      else if (e.key === '0') setView(RESET);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, onPrev, onNext]);

  // Scroll-wheel zoom centered on the cursor. Trackpad pinch arrives as a
  // wheel event with ctrlKey on macOS — same code path. The functional
  // setView keeps the three transform values in sync atomically across
  // rapid events (the previous split state was drifting on fast scrolls).
  const onWheel = (e: React.WheelEvent) => {
    if (kind !== 'image') return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const dir = e.deltaY < 0 ? 1 : -1;
    setView((v) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.scale + dir * ZOOM_STEP));
      if (next === v.scale) return v;
      if (next === 1) return RESET;
      // Image-space point currently under the cursor.
      const ix = (cx - v.tx) / v.scale;
      const iy = (cy - v.ty) / v.scale;
      // Re-anchor so that point stays put after the zoom.
      return { scale: next, tx: cx - ix * next, ty: cy - iy * next };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (kind !== 'image' || view.scale === 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx0: view.tx, ty0: view.ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx0 + (e.clientX - d.startX), ty: d.ty0 + (e.clientY - d.startY) }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (kind !== 'image') return;
    e.stopPropagation();
    setView((v) => {
      if (v.scale !== 1) return RESET;
      const stage = stageRef.current;
      if (!stage) return { scale: 2, tx: 0, ty: 0 };
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      // Zoom to 2× centered on the cursor.
      return { scale: 2, tx: -cx, ty: -cy };
    });
  };

  const { scale, tx, ty } = view;
  const dragging = !!dragRef.current;
  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Preview">
      <button className="lightbox-close" onClick={onClose} aria-label="Close"><X size={20} aria-hidden /></button>
      {kind === 'image' && scale !== 1 && (
        <div className="lightbox-zoom-badge" aria-live="polite">{Math.round(scale * 100)}%</div>
      )}
      {onPrev && (
        <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous">
          <ChevronLeft size={28} aria-hidden />
        </button>
      )}
      <div
        ref={stageRef}
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={kind === 'image' ? { cursor: scale === 1 ? 'zoom-in' : (dragging ? 'grabbing' : 'grab') } : undefined}
      >
        {kind === 'image' && (
          <img
            src={src}
            alt=""
            className="lightbox-media"
            draggable={false}
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: dragging ? 'none' : 'transform 0.16s ease',
              willChange: 'transform',
            }}
          />
        )}
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
