// Canvas-node visual frame:
//   - Editable title input above the card (with type icon + status check)
//   - Floating pill toolbar above the node when selected (two groups split
//     by a divider)
//   - The card body is whatever children you pass in
// Each node type wraps its content in NodeFrame and can override the
// toolbar items if needed.

import { useReactFlow, useStore, NodeToolbar, Position } from '@xyflow/react';
import {
  MoreHorizontal,
  FolderPlus, Download, Maximize2, CheckCircle2, Trash2,
  type LucideIcon,
} from 'lucide-react';
import { createElement, useState, type ReactNode } from 'react';
import type { NodeStatus } from './nodes';

export interface ToolbarItem {
  id: string;
  /** Either a Lucide icon component (rendered at size 16) or a pre-rendered ReactNode. */
  iconComponent?: LucideIcon;
  iconNode?: ReactNode;
  label: string;
  dot?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function buildDefaultLeft(onMore?: () => void): ToolbarItem[] {
  return [
    { id: 'more', iconComponent: MoreHorizontal, label: 'More', onClick: onMore },
  ];
}

function buildDefaultRight(opts: {
  onDelete?: () => void;
  onDownload?: () => void;
  onExpand?: () => void;
  onAddFolder?: () => void;
  hasResult?: boolean;
}): ToolbarItem[] {
  const enabled = !!opts.hasResult;
  return [
    { id: 'folder',   iconComponent: FolderPlus, label: 'Add to folder — coming soon', disabled: true,         onClick: opts.onAddFolder },
    { id: 'download', iconComponent: Download,   label: enabled ? 'Download' : 'Download (no result yet)',     disabled: !enabled, onClick: opts.onDownload },
    { id: 'expand',   iconComponent: Maximize2,  label: enabled ? 'Expand'   : 'Expand (no result yet)',       disabled: !enabled, onClick: opts.onExpand },
    { id: 'delete',   iconComponent: Trash2,     label: 'Delete node',                                          onClick: opts.onDelete },
  ];
}

interface Props {
  id: string;
  title?: string;
  placeholder?: string;
  icon?: LucideIcon;
  status?: NodeStatus;
  toolbarLeft?: ToolbarItem[];
  toolbarRight?: ToolbarItem[];
  /** Called when the default "More" button is clicked. Ignored if toolbarLeft is overridden. */
  onMore?: () => void;
  /** Toolbar callbacks for the default right group. */
  onDownload?: () => void;
  onExpand?: () => void;
  /** Whether a result exists — controls Download/Expand enabled state. */
  hasResult?: boolean;
  /** Rendered inside NodeToolbar below the pill — used for floating popovers. */
  toolbarExtra?: ReactNode;
  children: ReactNode;
}

function renderItemIcon(item: ToolbarItem): ReactNode {
  if (item.iconNode) return item.iconNode;
  if (item.iconComponent) {
    return createElement(item.iconComponent, { size: 16, strokeWidth: 1.75, 'aria-hidden': true });
  }
  return null;
}

export default function NodeFrame({
  id,
  title,
  placeholder = 'Untitled',
  icon: Icon,
  status,
  toolbarLeft,
  toolbarRight,
  onMore,
  onDownload,
  onExpand,
  hasResult,
  toolbarExtra,
  children,
}: Props) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const onDelete = () => { void deleteElements({ nodes: [{ id }] }); };
  const left = toolbarLeft ?? buildDefaultLeft(onMore);
  const right = toolbarRight ?? buildDefaultRight({ onDelete, onDownload, onExpand, hasResult });

  // Toolbar visibility: appears on hover OR when the node is selected.
  // Default NodeToolbar behavior only triggers on selected — but users
  // expect to glance at the bar without committing to a click, so we OR
  // hover into the mix.
  const [hover, setHover] = useState(false);
  const selected = useStore((s) => s.nodes.find((n) => n.id === id)?.selected ?? false);
  const toolbarVisible = hover || selected;

  return (
    <div
      className="node-frame-wrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Title row, positioned above the card via CSS */}
      <div className="node-title-row">
        {Icon && (
          <span className="node-title-icon">
            <Icon size={11} strokeWidth={1.75} aria-hidden />
          </span>
        )}
        <input
          className="node-title-input"
          value={title ?? ''}
          placeholder={placeholder}
          onChange={(e) => updateNodeData(id, { title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          aria-label="Node title"
        />
        {status === 'done' && (
          <CheckCircle2 size={13} className="node-title-check" aria-hidden />
        )}
      </div>

      {/* Floating pill toolbar — visible on hover OR when the node is selected. */}
      <NodeToolbar isVisible={toolbarVisible} position={Position.Top} offset={12} className="node-toolbar-pill">
        <div className="node-toolbar-pill-row">
        <ul className="toolbar-group">
          {left.map((it) => (
            <li key={it.id}>
              <button
                className={`toolbar-btn ${it.disabled ? 'is-disabled' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!it.disabled) it.onClick?.(); }}
                aria-label={it.label}
                aria-disabled={it.disabled || undefined}
                title={it.label}
                type="button"
              >
                {renderItemIcon(it)}
                {it.dot && <span className="toolbar-btn-dot" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        <div className="toolbar-divider" aria-hidden />
        <ul className="toolbar-group">
          {right.map((it) => (
            <li key={it.id}>
              <button
                className={`toolbar-btn ${it.disabled ? 'is-disabled' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!it.disabled) it.onClick?.(); }}
                aria-label={it.label}
                aria-disabled={it.disabled || undefined}
                title={it.label}
                type="button"
              >
                {renderItemIcon(it)}
              </button>
            </li>
          ))}
        </ul>
        </div>
        {toolbarExtra && <div className="node-toolbar-extra">{toolbarExtra}</div>}
      </NodeToolbar>

      {children}
    </div>
  );
}
