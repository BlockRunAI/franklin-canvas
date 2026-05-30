// Minimal in-canvas annotate modal: draws the source image into a canvas,
// captures freehand pen strokes on top, and exports a flat PNG. Used by the
// "Annotate" action on an image node — saves the result as a new upload node.

import { useEffect, useRef, useState } from 'react';
import { X, Pen, Undo2, Trash2, Save } from 'lucide-react';

interface Props {
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

interface Stroke { color: string; size: number; points: { x: number; y: number }[]; }

const COLORS = ['#ef4444', '#f59e0b', '#a3e635', '#22d3ee', '#a78bfa', '#ffffff', '#000000'];
const SIZES = [3, 6, 12];

export default function AnnotateModal({ open, imageUrl, onClose, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState<number>(SIZES[1]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);

  // Load the source image once when the modal opens.
  useEffect(() => {
    if (!open || !imageUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; redraw(); };
    img.src = imageUrl;
    setStrokes([]);
    drawingRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageUrl]);

  // Redraw whenever strokes change.
  useEffect(() => { redraw(); }, [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const redraw = () => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    // Lock canvas to image dimensions (capped at 1600 long-side for perf).
    const MAX = 1600;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.max(w, h) > MAX ? MAX / Math.max(w, h) : 1;
    w = Math.round(w * scale); h = Math.round(h * scale);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const s of strokes) drawStroke(ctx, s);
    if (drawingRef.current) drawStroke(ctx, drawingRef.current);
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    if (s.points.length === 0) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  };

  // Translate a pointer event into canvas-pixel coordinates.
  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { color, size, points: [pointAt(e)] };
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(pointAt(e));
    redraw();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    setStrokes((prev) => [...prev, drawingRef.current!]);
    drawingRef.current = null;
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => setStrokes([]);
  const save = () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      const url = c.toDataURL('image/png');
      onSave(url);
      onClose();
    } catch {
      // tainted canvas — image was cross-origin without CORS
      // fall back: just close
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="annotate-modal" role="dialog" aria-modal="true" aria-label="Annotate image" onClick={(e) => e.stopPropagation()}>
        <header className="annotate-head">
          <span className="annotate-title"><Pen size={14} aria-hidden /> Annotate</span>
          <div className="annotate-tools">
            <div className="annotate-tool-group" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`annotate-color ${color === c ? 'is-active' : ''}`}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <div className="annotate-tool-group" aria-label="Brush size">
              {SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`annotate-size ${size === s ? 'is-active' : ''}`}
                  onClick={() => setSize(s)}
                  aria-label={`Brush size ${s}`}
                >
                  <span style={{ width: s + 2, height: s + 2 }} />
                </button>
              ))}
            </div>
            <button type="button" className="annotate-action" onClick={undo} disabled={strokes.length === 0} title="Undo">
              <Undo2 size={14} aria-hidden />
            </button>
            <button type="button" className="annotate-action" onClick={clear} disabled={strokes.length === 0} title="Clear all">
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
          <div className="annotate-head-end">
            <button type="button" className="btn btn-primary annotate-save" onClick={save}>
              <Save size={13} aria-hidden /> Save as new node
            </button>
            <button className="settings-close" onClick={onClose} aria-label="Close annotate"><X size={16} aria-hidden /></button>
          </div>
        </header>
        <div className="annotate-stage">
          <canvas
            ref={canvasRef}
            className="annotate-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>
    </div>
  );
}
