// Image-card dropdown menu: Outpaint / Enhance / Cutout / Upscale / Split 2×2 /
// Split 3×3 / Annotate. Erase needs a mask-paint UI we don't have yet — it's
// in the Notion backlog, not in the menu.

import {
  Maximize, PenLine, Sparkles, Crop, Scissors, Grid3x3,
  type LucideIcon,
} from 'lucide-react';

export interface MenuItem {
  id: string;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}

// outpaint / enhance / cutout / pixels run as image-to-image generations
// (see CanvasView.runImageEdit); split crops client-side; annotate opens a
// freehand drawing modal then saves a new upload node.
const DEFAULT_IMAGE_ITEMS: MenuItem[] = [
  { id: 'outpaint',   icon: Maximize,  label: 'Outpaint' },
  { id: 'enhance',    icon: Sparkles,  label: 'Enhance' },
  { id: 'cutout',     icon: Scissors,  label: 'Cutout (transparent bg)' },
  { id: 'pixels',     icon: Crop,      label: 'Upscale' },
  { id: 'split2',     icon: Grid3x3,   label: 'Split 2×2' },
  { id: 'split3',     icon: Grid3x3,   label: 'Split 3×3' },
  { id: 'annotate',   icon: PenLine,   label: 'Annotate' },
];

interface Props {
  items?: MenuItem[];
  onItemClick?: (item: MenuItem) => void;
  /** When false, the active edit ops are disabled — they need a generated
   *  image to act on (image-to-image). Shows a hint instead of doing nothing. */
  imageReady?: boolean;
}

export default function NodeActionMenu({ items = DEFAULT_IMAGE_ITEMS, onItemClick, imageReady = true }: Props) {
  return (
    <div className="action-menu nodrag nopan" role="menu" onClick={(e) => e.stopPropagation()}>
      {!imageReady && (
        <div className="action-menu-note">Generate an image first to edit it</div>
      )}
      {items.map((it) => {
        const Icon = it.icon;
        const blocked = it.disabled || !imageReady;
        return (
          <button
            key={it.id}
            role="menuitem"
            className={`action-menu-item ${blocked ? 'is-disabled' : ''}`}
            type="button"
            disabled={blocked}
            title={it.disabled ? `${it.label} — coming soon` : !imageReady ? `${it.label} — needs an image first` : it.label}
            onClick={(e) => { e.stopPropagation(); if (blocked) return; it.onClick?.(); onItemClick?.(it); }}
          >
            <span className="action-menu-icon"><Icon size={16} strokeWidth={1.75} aria-hidden /></span>
            <span>{it.label}</span>
            {it.disabled && <span className="action-menu-soon">Soon</span>}
          </button>
        );
      })}
    </div>
  );
}
