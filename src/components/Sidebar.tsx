import { MessageSquare, Workflow, LayoutGrid, Wallet as WalletIcon, Settings, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { Route } from '../types';

const ITEMS: { id: Route; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'canvas', label: 'Canvas', Icon: Workflow },
  { id: 'projects', label: 'Projects', Icon: LayoutGrid },
  { id: 'wallet', label: 'Wallet', Icon: WalletIcon },
];

interface Props {
  route: Route;
  collapsed?: boolean;
  onNavigate: (r: Route) => void;
  onToggleCollapse?: () => void;
  onOpenSettings?: () => void;
  onOpenPrompts?: () => void;
}

export default function Sidebar({ route, collapsed = false, onNavigate, onToggleCollapse, onOpenSettings, onOpenPrompts }: Props) {
  return (
    <nav
      className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Primary"
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">
          <Sparkles size={18} className="brand-icon" aria-hidden />
          {!collapsed && <span>Franklin Canvas</span>}
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
              {!collapsed && <span>{label}</span>}
            </button>
          </li>
        ))}
        <li>
          <button
            className="nav-item"
            onClick={onOpenPrompts}
            aria-label="Open prompt library"
            title={collapsed ? 'Prompts' : undefined}
          >
            <Sparkles size={16} strokeWidth={1.75} aria-hidden />
            {!collapsed && <span>Prompts</span>}
          </button>
        </li>
      </ul>
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden />
          {!collapsed && <span>Settings</span>}
        </button>
        {!collapsed && <div className="version" aria-hidden>franklin-canvas · v0.0.1</div>}
      </div>
    </nav>
  );
}
