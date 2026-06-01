// Small popover for saving a node's result into one (or several) collections.
// Listed collections show a check when they already contain this result;
// clicking toggles membership. "New collection" creates one and adds in place.

import { useState } from 'react';
import { Check, Plus, FolderPlus } from 'lucide-react';
import { useCollectionsStore, type FavKind } from '../collectionsStore';

export interface SaveItem {
  kind: FavKind;
  url: string;
  title?: string;
  model?: string;
  prompt?: string;
}

export default function SaveToCollectionMenu({ item, onClose }: { item: SaveItem; onClose: () => void }) {
  const collections = useCollectionsStore((s) => s.collections);
  const items = useCollectionsStore((s) => s.items);
  const createCollection = useCollectionsStore((s) => s.createCollection);
  const addItem = useCollectionsStore((s) => s.addItem);
  const removeItem = useCollectionsStore((s) => s.removeItem);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const membership = (cid: string) => items.find((it) => it.collectionId === cid && it.url === item.url);

  const toggle = (cid: string) => {
    const existing = membership(cid);
    if (existing) removeItem(existing.id);
    else addItem({ collectionId: cid, ...item });
  };

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = createCollection(trimmed);
    addItem({ collectionId: id, ...item });
    setName('');
    setCreating(false);
  };

  return (
    <div className="save-collection-menu nodrag" onClick={(e) => e.stopPropagation()}>
      <div className="save-collection-head">
        <FolderPlus size={13} aria-hidden />
        <span>Save to collection</span>
      </div>
      <ul className="save-collection-list">
        {collections.map((c) => {
          const inIt = !!membership(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`save-collection-item ${inIt ? 'is-in' : ''}`}
                onClick={() => toggle(c.id)}
              >
                <span className="save-collection-name">{c.name}</span>
                {inIt && <Check size={14} aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {creating ? (
        <div className="save-collection-create">
          <input
            autoFocus
            className="save-collection-input"
            value={name}
            placeholder="Collection name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); else if (e.key === 'Escape') { setCreating(false); setName(''); } }}
            aria-label="New collection name"
          />
          <button type="button" className="save-collection-add" onClick={create}>Add</button>
        </div>
      ) : (
        <button type="button" className="save-collection-new" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden /> New collection
        </button>
      )}
      <button type="button" className="save-collection-done" onClick={onClose}>Done</button>
    </div>
  );
}
