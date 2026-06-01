// Tiny cross-view UI store. The prompt library lives on the canvas (its
// "Use" action drops a node), but it's opened from the sidebar — so the open
// flag is shared here rather than held in CanvasView local state.

import { create } from 'zustand';

interface UiState {
  promptLibOpen: boolean;
  setPromptLibOpen: (open: boolean) => void;
  // Collections (收藏夹) panel — saved canvas results, opened from the sidebar.
  collectionsOpen: boolean;
  setCollectionsOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  promptLibOpen: false,
  setPromptLibOpen: (promptLibOpen) => set({ promptLibOpen }),
  collectionsOpen: false,
  setCollectionsOpen: (collectionsOpen) => set({ collectionsOpen }),
}));
