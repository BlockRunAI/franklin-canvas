// Image-card dropdown menu: Outpaint / Enhance / Cutout / Upscale / Split,
// plus Erase / Annotate (which need a mask-paint UI we don't have yet, so
// they stay disabled). Dark glass panel with icon + label rows.

import {
  Maximize, Eraser, PenLine, Sparkles, Crop, Scissors, Grid3x3,
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
// (see CanvasView.runImageEdit); split crops client-side. erase / annotate
// need a mask-paint UI we don't have yet, so they stay disabled.
const DEFAULT_IMAGE_ITEMS: MenuItem[] = [
  { id: 'outpaint',   icon: Maximize,  label: 'Outpaint' },
  { id: 'enhance',    icon: Sparkles,  label: 'Enhance' },
  { id: 'cutout',     icon: Scissors,  label: 'Cutout (remove bg)' },
  { id: 'pixels',     icon: Crop,      label: 'Upscale' },
  { id: 'split',      icon: Grid3x3,   label: 'Split 2×2' },
  { id: 'erase',      icon: Eraser,    label: 'Erase',    disabled: true },
  { id: 'annotate',   icon: PenLine,   label: 'Annotate', disabled: true },
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
