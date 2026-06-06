import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { wagmiConfig } from './lib/wagmi-config';
import { hydrateFromFiles } from './projects';
import { hydrateAgentSessionsFromFile } from './canvas/agentSessionsStore';
import './styles.css';

// Wallet context is always mounted (inert without a connection) so the x402
// hooks resolve in both builds; only the web build actually signs with it.
const queryClient = new QueryClient();

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}

// Hydrate projects from the on-disk JSON files before mounting so the canvas
// loads the file-authoritative state (survives cache clear / external edits).
// Never block forever — fall back to localStorage if the backend is slow/down.
Promise.race([
  Promise.all([hydrateFromFiles(), hydrateAgentSessionsFromFile()]),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).finally(mount);
