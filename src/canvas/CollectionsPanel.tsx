// Collections (收藏夹) panel — the user's saved canvas results, organized into
// folders they create. Left rail = collections (create / rename / delete);
// right = the selected collection's items as a gallery. Clicking an item (or
// its Use button) imports it back onto the canvas.

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, FolderOpen, Image as ImageIcon, Film, Music, Wand2 } from 'lucide-react';
import { useCollectionsStore, type FavItem } from '../collectionsStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onUse: (item: FavItem) => void;
}

export default function CollectionsPanel({ open, onClose, onUse }: Props) {
  const collections = useCollectionsStore((s) => s.collections);
  const items = useCollectionsStore((s) => s.items);
  const createCollection = useCollectionsStore((s) => s.createCollection);
  const renameCollection = useCollectionsStore((s) => s.renameCollection);
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection);
  const removeItem = useCollectionsStore((s) => s.removeItem);

  const [activeId, setActiveId] = useState<string | null>(collections[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Keep a valid selection as collections change.
  useEffect(() => {
    if (!open) return;
    if (!activeId || !collections.some((c) => c.id === activeId)) {
      setActiveId(collections[0]?.id ?? null);
    }
  }, [open, collections, activeId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const countOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.collectionId] = (m[it.collectionId] || 0) + 1;
    return m;
  }, [items]);

  const activeItems = useMemo(
    () => items.filter((it) => it.collectionId === activeId),
    [items, activeId],
  );

  if (!open) return null;

  const create = () => {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    const id = createCollection(name);
    setActiveId(id);
    setNewName('');
    setCreating(false);
  };

  const commitRename = () => {
    if (renamingId) renameCollection(renamingId, renameText);
    setRenamingId(null);
  };

  const activeName = collections.find((c) => c.id === activeId)?.name ?? '';

  return (
    <div className="collections-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Collections">
      <div className="collections-dialog" onClick={(e) => e.stopPropagation()}>
        {/* ── Rail: collections ── */}
        <aside className="collections-rail">
          <div className="collections-rail-head">
            <h2>Collections</h2>
            <button className="collections-icon-btn" onClick={() => setCreating(true)} aria-label="New collection" title="New collection">
              <Plus size={16} aria-hidden />
            </button>
          </div>
          <ul className="collections-list">
            {collections.map((c) => (
              <li key={c.id}>
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    className="collections-rename-input"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenamingId(null); }}
                    aria-label="Rename collection"
                  />
                ) : (
                  <button
                    className={`collections-item ${c.id === activeId ? 'is-active' : ''}`}
                    onClick={() => setActiveId(c.id)}
                    onDoubleClick={() => { setRenamingId(c.id); setRenameText(c.name); }}
                    title={c.name}
                  >
                    <FolderOpen size={15} strokeWidth={1.75} aria-hidden />
                    <span className="collections-item-name">{c.name}</span>
                    <span className="collections-item-count">{countOf[c.id] || 0}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {creating && (
            <div className="collections-create">
              <input
                autoFocus
                className="collections-create-input"
                value={newName}
                placeholder="Collection name"
                onChange={(e) => setNewName(e.target.value)}
                onBlur={create}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); else if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                aria-label="New collection name"
              />
            </div>
          )}
        </aside>

        {/* ── Main: items in the active collection ── */}
        <section className="collections-main">
          <header className="collections-main-head">
            <div className="collections-main-title">
              <span>{activeName || 'No collection'}</span>
              <span className="collections-main-count">{activeItems.length} item{activeItems.length === 1 ? '' : 's'}</span>
            </div>
            <div className="collections-main-actions">
              {activeId && (
                <button
                  className="collections-icon-btn"
                  onClick={() => { setRenamingId(activeId); setRenameText(activeName); }}
                  aria-label="Rename collection"
                  title="Rename"
                >
                  <span className="collections-rename-label">Rename</span>
                </button>
              )}
              {activeId && collections.length > 1 && (
                <button
                  className="collections-icon-btn collections-danger"
                  onClick={() => { deleteCollection(activeId); }}
                  aria-label="Delete collection"
                  title="Delete collection"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
              <button className="collections-close" onClick={onClose} aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>
          </header>

          {activeItems.length === 0 ? (
            <div className="collections-empty">
              <FolderOpen size={30} strokeWidth={1.3} aria-hidden />
              <p>No saved items yet.</p>
              <p className="collections-empty-hint">On the canvas, hover a finished image / video / music node and click the <strong>folder</strong> icon to save it here.</p>
            </div>
          ) : (
            <ul className="collections-grid">
              {activeItems.map((it) => (
                <li key={it.id} className="collections-tile">
                  <div className="collections-tile-media" onClick={() => onUse(it)} title="Use on canvas">
                    {it.kind === 'image' && <img src={it.url} alt={it.title || ''} loading="lazy" />}
                    {it.kind === 'video' && <video src={it.url} muted preload="metadata" />}
                    {it.kind === 'audio' && <div className="collections-tile-audio"><Music size={22} aria-hidden /></div>}
                    <span className="collections-tile-kind">
                      {it.kind === 'image' ? <ImageIcon size={11} /> : it.kind === 'video' ? <Film size={11} /> : <Music size={11} />}
                    </span>
                  </div>
                  <div className="collections-tile-body">
                    <span className="collections-tile-title" title={it.title}>{it.title || 'Untitled'}</span>
                    {it.model && <span className="collections-tile-model">{it.model}</span>}
                  </div>
                  <div className="collections-tile-actions">
                    <button className="collections-tile-use" onClick={() => onUse(it)} title="Use on canvas">
                      <Wand2 size={12} aria-hidden /> Use
                    </button>
                    <button className="collections-tile-del" onClick={() => removeItem(it.id)} aria-label="Remove" title="Remove">
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
