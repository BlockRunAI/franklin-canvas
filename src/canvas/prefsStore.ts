// Canvas appearance preferences — persisted to localStorage and read live by
// the canvas (edge renderer, minimap, dot background) + the Settings dialog.
// Kept tiny on purpose; add more visual prefs here as they come up.

import { create } from 'zustand';

export type EdgeStyle = 'animated' | 'solid' | 'subtle';

const EDGE_KEY     = 'franklin-canvas:edge-style';
const MINIMAP_KEY  = 'franklin-canvas:show-minimap';
const DOTS_KEY     = 'franklin-canvas:show-dots';

function loadEdgeStyle(): EdgeStyle {
  const v = (() => { try { return localStorage.getItem(EDGE_KEY); } catch { return null; } })();
  return v === 'solid' || v === 'subtle' || v === 'animated' ? v : 'solid';
}
function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  } catch { return fallback; }
}
function saveBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore quota */ }
}

interface PrefsState {
  edgeStyle: EdgeStyle;
  setEdgeStyle: (s: EdgeStyle) => void;
  showMinimap: boolean;
  toggleMinimap: () => void;
  showDots: boolean;
  toggleDots: () => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  edgeStyle: loadEdgeStyle(),
  setEdgeStyle: (edgeStyle) => {
    try { localStorage.setItem(EDGE_KEY, edgeStyle); } catch { /* ignore quota */ }
    set({ edgeStyle });
  },
  showMinimap: loadBool(MINIMAP_KEY, true),
  toggleMinimap: () => set((s) => { const v = !s.showMinimap; saveBool(MINIMAP_KEY, v); return { showMinimap: v }; }),
  showDots: loadBool(DOTS_KEY, true),
  toggleDots: () => set((s) => { const v = !s.showDots; saveBool(DOTS_KEY, v); return { showDots: v }; }),
}));
