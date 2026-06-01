// Saved comparisons — persist a whole model-comparison (prompt, the per-model
// result videos, and the stitched clip) so it can be reopened later in the
// Comparison view exactly as it was, instead of being lost on reload.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedJob { model: string; label: string; resultUrl: string }

export interface SavedComparison {
  id: string;
  name: string;
  prompt: string;
  durationS: number;
  orientation: 'landscape' | 'portrait';
  jobs: SavedJob[];
  combinedUrl?: string;
  createdAt: number;
}

interface ComparisonsState {
  items: SavedComparison[];
  save: (c: Omit<SavedComparison, 'id' | 'createdAt'>) => void;
  remove: (id: string) => void;
}

export const useComparisonsStore = create<ComparisonsState>()(
  persist(
    (set) => ({
      items: [],
      save: (c) => set((s) => ({ items: [{ ...c, id: `cmp_${crypto.randomUUID()}`, createdAt: Date.now() }, ...s.items] })),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
    }),
    { name: 'franklin-canvas:comparisons' },
  ),
);
