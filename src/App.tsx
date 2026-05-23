import { useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './views/ChatView';
import CanvasView from './views/CanvasView';
import WalletView from './views/WalletView';
import ProjectsView from './views/ProjectsView';
import SettingsDialog from './canvas/SettingsDialog';
import { useUiStore } from './uiStore';
import type { Route } from './types';

const TITLES: Record<Route, string> = {
  chat: 'Chat',
  canvas: 'Canvas',
  projects: 'Projects',
  wallet: 'Wallet',
};

export default function App() {
  const [route, setRoute] = useState<Route>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setPromptLibOpen = useUiStore((s) => s.setPromptLibOpen);
  // Track the previous route so re-clicking the active sidebar item bounces
  // back instead of leaving the user stranded on a view they finished with.
  const prevRouteRef = useRef<Route>('chat');
  const navigate = (next: Route) => {
    if (next === route) {
      const back = prevRouteRef.current;
      if (back !== route) {
        prevRouteRef.current = route;
        setRoute(back);
      }
      return;
    }
    prevRouteRef.current = route;
    setRoute(next);
  };

  return (
    <div className="app">
      <Sidebar
        route={route}
        collapsed={sidebarCollapsed}
        onNavigate={navigate}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenPrompts={() => { navigate('canvas'); setPromptLibOpen(true); }}
      />
      <main className="main" aria-label={TITLES[route]}>
        {route === 'chat' && <ChatView />}
        {route === 'canvas' && <CanvasView />}
        {route === 'wallet' && <WalletView />}
        {route === 'projects' && <ProjectsView onOpenCanvas={() => navigate('canvas')} />}
      </main>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
