// Canvas appearance preferences — persisted to localStorage and read live by
// the canvas (edge renderer) + the Settings dialog. Kept tiny on purpose; add
// more visual prefs here as they come up.

import { create } from 'zustand';

export type EdgeStyle = 'animated' | 'solid' | 'subtle';

const EDGE_KEY = 'franklin-canvas:edge-style';

function loadEdgeStyle(): EdgeStyle {
  const v = (() => { try { return localStorage.getItem(EDGE_KEY); } catch { return null; } })();
  return v === 'solid' || v === 'subtle' || v === 'animated' ? v : 'animated';
}

interface PrefsState {
  edgeStyle: EdgeStyle;
  setEdgeStyle: (s: EdgeStyle) => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  edgeStyle: loadEdgeStyle(),
  setEdgeStyle: (edgeStyle) => {
    try { localStorage.setItem(EDGE_KEY, edgeStyle); } catch { /* ignore quota */ }
    set({ edgeStyle });
  },
}));
