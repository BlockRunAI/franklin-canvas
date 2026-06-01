// Floating pill at the canvas bottom-right for view controls:
//   - Auto-arrange (lays nodes out left-to-right by edge depth)
//   - Toggle minimap
//   - Fit to content
//   - Zoom out / live % / zoom in
// Glass surface matches the other floating panels (--panel-bg).

import { useEffect, useState } from 'react';
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react';
import { Minus, Plus, Map as MapIcon, Maximize2, Wand2 } from 'lucide-react';
import { usePrefsStore } from './prefsStore';
import { useT } from '../i18n';

// Per-column horizontal pitch and per-row vertical gap for the auto-layout.
// Tuned for the typical 280-px-wide node card.
const COL_PITCH = 380;
const ROW_GAP = 56;
const START_X = 80;
const START_Y = 80;
const DEFAULT_NODE_H = 280;

export default function CanvasViewBar() {
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes, getEdges, setNodes } = useReactFlow();
  // Subscribe to viewport zoom so the % updates live as the user pinches.
  const zoom = useFlowStore((s) => s.transform[2]);
  const showMinimap = usePrefsStore((s) => s.showMinimap);
  const toggleMinimap = usePrefsStore((s) => s.toggleMinimap);
  const t = useT();

  // Local mirror just to avoid a re-render storm if `zoom` updates more often
  // than we display (we round to whole percent anyway).
  const [pct, setPct] = useState(Math.round((zoom ?? 1) * 100));
  useEffect(() => { setPct(Math.round((zoom ?? 1) * 100)); }, [zoom]);

  // Zoom-% dropdown (Fit to screen / 50 / 100 / 200).
  const [zoomMenu, setZoomMenu] = useState(false);
  const doFit = () => { fitView({ padding: 0.2, duration: 300 }); setZoomMenu(false); };
  const setZoom = (z: number) => { zoomTo(z, { duration: 200 }); setZoomMenu(false); };

  // Shift+1 fits the view (the menu shows this hint), but not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.shiftKey && (e.key === '1' || e.key === '!')) { e.preventDefault(); fitView({ padding: 0.2, duration: 300 }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView]);

  // ── Auto-arrange: column-by-depth left-to-right layout ──
  // Build incoming-edge counts, BFS from sources to assign each node a
  // "depth" (column index), then stack nodes within each column using their
  // measured heights. Disconnected nodes land in column 0. Snap positions,
  // then fitView so the user sees the whole new layout settle.
  const autoArrange = () => {
    const nodes = getNodes();
    const edges = getEdges();
    if (nodes.length === 0) return;

    const inMap = new Map<string, string[]>();
    const outMap = new Map<string, string[]>();
    for (const e of edges) {
      (inMap.get(e.target) ?? inMap.set(e.target, []).get(e.target)!).push(e.source);
      (outMap.get(e.source) ?? outMap.set(e.source, []).get(e.source)!).push(e.target);
    }

    const depth = new Map<string, number>();
    const queue: { id: string; d: number }[] = [];
    for (const n of nodes) {
      if (!inMap.has(n.id) || inMap.get(n.id)!.length === 0) {
        depth.set(n.id, 0);
        queue.push({ id: n.id, d: 0 });
      }
    }
    while (queue.length) {
      const { id, d } = queue.shift()!;
      for (const t of outMap.get(id) ?? []) {
        const next = d + 1;
        if ((depth.get(t) ?? -1) < next) {
          depth.set(t, next);
          queue.push({ id: t, d: next });
        }
      }
    }
    for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

    // Group ids by depth, preserving original input order for stable layout.
    const byDepth = new Map<number, string[]>();
    for (const n of nodes) {
      const d = depth.get(n.id)!;
      (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(n.id);
    }

    // Walk each column top-to-bottom, accumulating y by measured height.
    const positions = new Map<string, { x: number; y: number }>();
    for (const [d, ids] of byDepth) {
      let y = START_Y;
      for (const id of ids) {
        const n = nodes.find((nn) => nn.id === id);
        const h = n?.measured?.height ?? (n?.height as number | undefined) ?? DEFAULT_NODE_H;
        positions.set(id, { x: START_X + d * COL_PITCH, y });
        y += h + ROW_GAP;
      }
    }

    setNodes((nds) => nds.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })));
    // Re-frame after positions settle so the user sees the new layout.
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 60);
  };

  return (
    <div
      className="canvas-view-bar"
      role="toolbar"
      aria-label="Canvas view controls"
    >
      <button
        type="button"
        className="view-bar-btn"
        onClick={autoArrange}
        title="Auto-arrange nodes by flow"
      >
        <Wand2 size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className={`view-bar-btn ${showMinimap ? 'is-active' : ''}`}
        onClick={toggleMinimap}
        title={showMinimap ? 'Hide minimap' : 'Show minimap'}
        aria-pressed={showMinimap}
      >
        <MapIcon size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="view-bar-btn"
        onClick={() => fitView({ padding: 0.2, duration: 240 })}
        title="Fit to content"
      >
        <Maximize2 size={14} strokeWidth={1.8} aria-hidden />
      </button>
      <span className="view-bar-divider" aria-hidden />
      <button
        type="button"
        className="view-bar-btn"
        onClick={() => zoomOut({ duration: 160 })}
        title="Zoom out"
      >
        <Minus size={15} strokeWidth={2} aria-hidden />
      </button>
      <div className="view-bar-zoom-wrap">
        <button
          type="button"
          className="view-bar-pct"
          onClick={() => setZoomMenu((v) => !v)}
          title="Zoom"
          aria-haspopup="menu"
          aria-expanded={zoomMenu}
        >
          {pct}%
        </button>
        {zoomMenu && (
          <>
            <div className="view-bar-zoom-backdrop" onClick={() => setZoomMenu(false)} />
            <div className="view-bar-zoom-menu" role="menu">
              <button className="zoom-menu-item" role="menuitem" onClick={doFit}>
                <span>{t('vb_fit')}</span>
                <kbd className="zoom-menu-kbd">⇧1</kbd>
              </button>
              <span className="zoom-menu-divider" />
              <button className="zoom-menu-item" role="menuitem" onClick={() => setZoom(0.5)}>
                {t('vb_zoom_to', { pct: 50 })}
              </button>
              <button className="zoom-menu-item" role="menuitem" onClick={() => setZoom(1)}>
                {t('vb_zoom_to', { pct: 100 })}
              </button>
              <button className="zoom-menu-item" role="menuitem" onClick={() => setZoom(2)}>
                {t('vb_zoom_to', { pct: 200 })}
              </button>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="view-bar-btn"
        onClick={() => zoomIn({ duration: 160 })}
        title="Zoom in"
      >
        <Plus size={15} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
