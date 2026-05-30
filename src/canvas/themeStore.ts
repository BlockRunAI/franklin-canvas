// Theme switcher — three palettes ported from the Franklin marketing site:
//   • dark  — our default. Neutral zinc dark + lime gradient accent.
//   • gold  — warm cream + deep petrol-ink + gold thread (Franklin "gold").
//   • light — cool minimal white + petrol accent.
// Applied via `data-theme` on <html>; persisted in localStorage so the choice
// survives reloads (App.tsx applies it on mount).

import { create } from 'zustand';

export type Theme = 'dark' | 'gold' | 'light';
const KEY = 'franklin-canvas:theme';

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'gold' || v === 'light' || v === 'dark' ? v : 'dark';
  } catch { return 'dark'; }
}

interface ThemeState { theme: Theme; setTheme: (t: Theme) => void; }

export const useThemeStore = create<ThemeState>((set) => ({
  theme: load(),
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    set({ theme });
  },
}));
