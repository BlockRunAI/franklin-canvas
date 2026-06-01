// Primary left navigation rail. Brand (Franklin Canvas) at top, Canvas /
// Projects nav in the middle, Wallet + Settings in the footer (both open the
// SettingsDialog on the relevant pane). Collapsible via the chevron button —
// width animates between expanded (240px) and collapsed (56px); labels fade.

import {
  Workflow, LayoutGrid, Wallet as WalletIcon, Settings, Sparkles,
  LibraryBig, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import type { Route } from '../types';
import { useT, type StringKey } from '../i18n';
import { useUiStore } from '../uiStore';

type SettingsSection = 'wallet' | 'models' | 'canvas' | 'about';

interface NavItem { id: Route; labelKey: StringKey; Icon: typeof Workflow; }
const ITEMS: NavItem[] = [
  { id: 'canvas',   labelKey: 'sidebar_canvas',   Icon: Workflow },
  { id: 'projects', labelKey: 'sidebar_projects', Icon: LayoutGrid },
];

interface Props {
  route: Route;
  collapsed?: boolean;
  onNavigate: (r: Route) => void;
  onToggleCollapse?: () => void;
  onOpenSettings?: (section?: SettingsSection) => void;
}

export default function Sidebar({ route, collapsed = false, onNavigate, onToggleCollapse, onOpenSettings }: Props) {
  const t = useT();
  const openCollections = useUiStore((s) => s.setCollectionsOpen);
  return (
    <nav
      className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Primary"
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">
          <Sparkles size={18} className="brand-icon" aria-hidden />
          <span>{t('sidebar_brand')}</span>
        </span>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('sidebar_expand') : t('sidebar_collapse')}
            aria-pressed={collapsed}
            title={collapsed ? t('sidebar_expand') : t('sidebar_collapse')}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        )}
      </div>
      <ul className="sidebar-nav">
        {ITEMS.map(({ id, labelKey, Icon }) => {
          const label = t(labelKey);
          return (
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
          );
        })}
        <li>
          <button
            className="nav-item"
            onClick={() => { onNavigate('canvas'); openCollections(true); }}
            title={collapsed ? t('sidebar_library') : undefined}
          >
            <LibraryBig size={16} strokeWidth={1.75} aria-hidden />
            <span>{t('sidebar_library')}</span>
          </button>
        </li>
      </ul>
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => onOpenSettings?.('wallet')}
          aria-label={t('sidebar_wallet')}
          title={collapsed ? t('sidebar_wallet') : undefined}
        >
          <WalletIcon size={16} strokeWidth={1.75} aria-hidden />
          <span>{t('sidebar_wallet')}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => onOpenSettings?.('canvas')}
          aria-label={t('sidebar_settings')}
          title={collapsed ? t('sidebar_settings') : undefined}
        >
          <Settings size={16} strokeWidth={1.75} aria-hidden />
          <span>{t('sidebar_settings')}</span>
        </button>
        <div className="version" aria-hidden>franklin-canvas · v0.0.1</div>
      </div>
    </nav>
  );
}
