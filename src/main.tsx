import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { hydrateFromFiles } from './projects';
import './styles.css';

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Hydrate projects from the on-disk JSON files before mounting so the canvas
// loads the file-authoritative state (survives cache clear / external edits).
// Never block forever — fall back to localStorage if the backend is slow/down.
Promise.race([
  hydrateFromFiles(),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).finally(mount);
