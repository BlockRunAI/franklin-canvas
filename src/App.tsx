import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import CanvasView from './views/CanvasView';
import ProjectsView from './views/ProjectsView';
import ComparisonView from './views/ComparisonView';
import SettingsDialog from './canvas/SettingsDialog';
import { useThemeStore } from './canvas/themeStore';
import type { Route } from './types';

type SettingsSection = 'wallet' | 'models' | 'canvas' | 'about';

const TITLES: Record<Route, string> = {
  canvas: 'Canvas',
  projects: 'Projects',
  wallet: 'Wallet',
  comparison: 'Comparison',
};

export default function App() {
  const [route, setRoute] = useState<Route>('canvas');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitial, setSettingsInitial] = useState<SettingsSection>('wallet');
  // Apply the persisted theme on mount (data-theme on <html>).
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const openSettings = (section: SettingsSection = 'wallet') => {
    setSettingsInitial(section);
    setSettingsOpen(true);
  };

  return (
    <div className="app">
      <Sidebar
        route={route}
        collapsed={sidebarCollapsed}
        onNavigate={setRoute}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onOpenSettings={openSettings}
      />
      <main className="main" aria-label={TITLES[route]}>
        {route === 'canvas' && <CanvasView />}
        {route === 'projects' && <ProjectsView onOpenCanvas={() => setRoute('canvas')} />}
        {route === 'comparison' && <ComparisonView />}
      </main>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={settingsInitial}
      />
    </div>
  );
}
