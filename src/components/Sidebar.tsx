// Primary left navigation rail. Brand (Franklin Canvas) at top, Canvas /
// Projects nav in the middle, Wallet + Settings in the footer (both open the
// SettingsDialog on the relevant pane). Collapsible via the chevron button —
// width animates between expanded (240px) and collapsed (56px); labels fade.

import {
  Workflow, LayoutGrid, Wallet as WalletIcon, Settings, Sparkles,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import type { Route } from '../types';

type SettingsSection = 'wallet' | 'models' | 'canvas' | 'about';

interface NavItem { id: Route; label: string; Icon: typeof Workflow; }
const ITEMS: NavItem[] = [
  { id: 'canvas', label: 'Canvas', Icon: Workflow },
  { id: 'projects', label: 'Projects', Icon: LayoutGrid },
];

interface Props {
  route: Route;
  collapsed?: boolean;
  onNavigate: (r: Route) => void;
  onToggleCollapse?: () => void;
  onOpenSettings?: (section?: SettingsSection) => void;
}

export default function Sidebar({ route, collapsed = false, onNavigate, onToggleCollapse, onOpenSettings }: Props) {
  return (
    <nav
      className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Primary"
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">
          <Sparkles size={18} className="brand-icon" aria-hidden />
          <span>Franklin Canvas</span>
        </span>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>
      <ul className="sidebar-nav">
        {ITEMS.map(({ id, label, Icon }) => (
          <li key={id}>
            <button
              className={`nav-item ${route === id ? 'active' : ''}`}
              onClick={() => onNavigate(id)}
              aria-current={route === id ? 'page' : undefined}
              title={collapsed ? label : undefined}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => onOpenSettings?.('wallet')}
          aria-label="Open wallet"
          title={collapsed ? 'Wallet' : undefined}
        >
          <WalletIcon size={16} strokeWidth={1.75} aria-hidden />
          <span>Wallet</span>
        </button>
        <button
          className="nav-item"
          onClick={() => onOpenSettings?.('canvas')}
          aria-label="Open settings"
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden />
          <span>Settings</span>
        </button>
        <div className="version" aria-hidden>franklin-canvas · v0.0.1</div>
      </div>
    </nav>
  );
}
