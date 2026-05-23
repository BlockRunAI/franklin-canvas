// Categorized node picker drawer (left panel):
// large rounded-square icon + label + tagline, sections (Generate / Utility
// / Resource), optional Beta badge + new-blue-dot indicator.

import { X } from 'lucide-react';
import { NODE_CATALOG, CATEGORY_TITLES, type NodeCatalogEntry, type NodeCategory } from './nodes';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (entry: NodeCatalogEntry) => void;
}

const CATEGORY_ORDER: NodeCategory[] = ['generate', 'utility', 'resource'];

export default function NodeDrawer({ open, onClose, onPick }: Props) {
  if (!open) return null;

  return (
    <aside
      className="node-drawer"
      role="dialog"
      aria-modal="false"
      aria-label="Add a node to the canvas"
    >
      <header className="drawer-header">
        <h3 className="drawer-title">Add node</h3>
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="Close node drawer"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="drawer-body">
        {CATEGORY_ORDER.map((cat) => {
          const items = NODE_CATALOG.filter((n) => n.category === cat);
          if (items.length === 0) return null;
          return (
            <section key={cat} className="drawer-section">
              <h4 className="drawer-section-title">{CATEGORY_TITLES[cat]}</h4>
              <ul className="drawer-items">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.type}>
                      <button
                        className="drawer-item"
                        onClick={() => onPick(item)}
                        aria-label={`Add ${item.label} node — ${item.description}`}
                      >
                        <span className="drawer-item-icon">
                          <Icon size={18} strokeWidth={1.5} aria-hidden />
                          {item.dot && <span className="drawer-item-dot" aria-label="New" />}
                        </span>
                        <span className="drawer-item-text">
                          <span className="drawer-item-label">
                            {item.label}
                            {item.beta && <span className="drawer-item-beta">Beta</span>}
                          </span>
                          <span className="drawer-item-desc">{item.description}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
