// Floating pill at the canvas bottom-right for view controls — zoom +/- with a
// live percentage readout, fit-to-content, and quick toggles to hide the
// minimap thumbnail and the dotted background. Glass surface matches the
// other floating panels (--panel-bg).

import { useEffect, useState } from 'react';
import { useReactFlow, useStore as useFlowStore } from '@xyflow/react';
import { Minus, Plus, Map as MapIcon, LayoutGrid, Maximize2 } from 'lucide-react';
import { usePrefsStore } from './prefsStore';

export default function CanvasViewBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Subscribe to viewport zoom so the % updates live as the user pinches.
  const zoom = useFlowStore((s) => s.transform[2]);
  const showMinimap = usePrefsStore((s) => s.showMinimap);
  const toggleMinimap = usePrefsStore((s) => s.toggleMinimap);
  const showDots = usePrefsStore((s) => s.showDots);
  const toggleDots = usePrefsStore((s) => s.toggleDots);

  // Local mirror just to avoid a re-render storm if `zoom` updates more often
  // than we display (we round to whole percent anyway).
  const [pct, setPct] = useState(Math.round((zoom ?? 1) * 100));
  useEffect(() => { setPct(Math.round((zoom ?? 1) * 100)); }, [zoom]);

  return (
    <div
      className={`canvas-view-bar ${showMinimap ? 'is-above-minimap' : ''}`}
      role="toolbar"
      aria-label="Canvas view controls"
    >
      <button
        type="button"
        className={`view-bar-btn ${showDots ? 'is-active' : ''}`}
        onClick={toggleDots}
        title={showDots ? 'Hide background dots' : 'Show background dots'}
        aria-pressed={showDots}
      >
        <LayoutGrid size={15} strokeWidth={1.8} aria-hidden />
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
      <span className="view-bar-pct" aria-live="polite">{pct}%</span>
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
