// Tiny zustand store for the global mask-edit modal. Nodes that want to
// open the editor call `open(nodeId, imageUrl)`; CanvasView renders the
// modal at the top level and calls `setMask` on save.

import { create } from 'zustand';

interface EditorState {
  openFor: string | null;
  imageUrl: string | null;
  open: (nodeId: string, imageUrl: string) => void;
  close: () => void;
  onSave: ((nodeId: string, maskDataUrl: string) => void) | null;
  setOnSave: (cb: ((nodeId: string, maskDataUrl: string) => void) | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  openFor: null,
  imageUrl: null,
  onSave: null,
  open: (openFor, imageUrl) => set({ openFor, imageUrl }),
  close: () => set({ openFor: null, imageUrl: null }),
  setOnSave: (onSave) => set({ onSave }),
}));
