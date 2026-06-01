// Collections (收藏夹) — the user's personal favorites of good canvas results.
// Save an image / video / audio result from any result node into a named
// collection, then re-import it onto the canvas later. Collections are simple
// user-created folders; items reference the result by URL plus a little
// metadata (title / model / prompt) for the gallery.
//
// Persisted to localStorage via zustand/persist so favorites survive reloads
// and are shared across every project/canvas. URLs are stored as-is — generated
// results are short proxied/remote URLs; uploaded data: URLs are stored inline
// (the user controls how many they keep).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FavKind = 'image' | 'video' | 'audio';

export interface FavItem {
  id: string;
  collectionId: string;
  kind: FavKind;
  url: string;
  title?: string;
  model?: string;
  prompt?: string;
  addedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

interface CollectionsState {
  collections: Collection[];
  items: FavItem[];
  createCollection: (name: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  addItem: (item: Omit<FavItem, 'id' | 'addedAt'>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, collectionId: string) => void;
  /** Is this URL already saved anywhere? Used to toggle the bookmark state. */
  isSaved: (url: string) => boolean;
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const DEFAULT_ID = 'c_default';

export const useCollectionsStore = create<CollectionsState>()(
  persist(
    (set, get) => ({
      // Seed a default collection so there's always somewhere to save into.
      collections: [{ id: DEFAULT_ID, name: 'Favorites', createdAt: 0 }],
      items: [],

      createCollection: (name) => {
        const id = uid('c');
        set((s) => ({ collections: [...s.collections, { id, name: name.trim() || 'Untitled', createdAt: Date.now() }] }));
        return id;
      },
      renameCollection: (id, name) =>
        set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)) })),
      deleteCollection: (id) =>
        set((s) => ({
          collections: s.collections.filter((c) => c.id !== id),
          items: s.items.filter((it) => it.collectionId !== id),
        })),

      addItem: (item) =>
        set((s) => {
          // Don't duplicate the same URL inside the same collection.
          if (s.items.some((it) => it.collectionId === item.collectionId && it.url === item.url)) return s;
          return { items: [{ ...item, id: uid('f'), addedAt: Date.now() }, ...s.items] };
        }),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
      moveItem: (id, collectionId) =>
        set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, collectionId } : it)) })),

      isSaved: (url) => get().items.some((it) => it.url === url),
    }),
    { name: 'franklin-canvas:collections' },
  ),
);
