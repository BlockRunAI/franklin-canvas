<h1 align="center">Franklin Canvas</h1>

<p align="center">
Node-based AI media studio — generate <strong>images, video and music</strong> on an infinite canvas,
with every generation paid live in <strong>USDC</strong> via x402 through the BlockRun gateway.
</p>

Franklin Canvas turns an infinite canvas into a visual AI production line: drop nodes, wire them
up, and generate across dozens of image / video / music / text models — no subscription, you pay
per call from your own wallet. Built on the [Franklin core](https://github.com/BlockRunAI/Franklin)
for wallet + payment, but a separate product aimed at creators rather than CLI users.

---

## Highlights

- **Infinite canvas** — pan / zoom / minimap, drag-to-connect nodes, undo–redo, paste images, and
  multi-**project** persistence (each project is its own saved canvas).
- **Multi-model, multi-modal** — image, video, music and text nodes, each backed by the BlockRun
  gateway catalog.
- **Pay-per-call in USDC** — no subscription. Live wallet balance in the toolbar; spend is settled
  per generation via x402 on Base.
- **Contextual prompt bar** — select a node and type; attach a reference image from the canvas for
  image-to-image and image-to-video.
- **In-canvas image editing** — on any generated image: **Outpaint · Enhance · Cutout · Upscale**
  (image-to-image), plus **Split 2×2** (client-side crop into separate tiles).
- **Timeline node** — sequence finished video / music clips into an ordered cut.
- **Prompt library** — a searchable gallery of ready-made prompts so the canvas is never blank.
- **Settings** — Wallet (balance, address, spend-by-model), Models & pricing, Canvas appearance
  (connection-line styles), About.

## Quick start

One command runs the backend (wallet + x402 + generation) on `:3100` and the Vite UI on `:5173`:

```bash
npm install
npm start            # → http://localhost:5173
```

You need a funded wallet for real generations — the backend reads `~/.blockrun/` (shared with
Franklin if installed), or set `BLOCKRUN_WALLET_KEY`. The UI is fully usable without funds;
generation calls just return an error you can retry.

Run the halves separately if you prefer:

```bash
npm run server       # backend only (:3100)
npm run dev          # UI only (:5173), proxies /api → :3100
```

## Architecture

```
Browser (Vite dev, or the built dist/ served by Franklin in prod)
   │  fetch /api/...  (wallet · generate · prompts · sessions)
   ▼
Backend  ──  server.mjs (local, this repo)   OR   the Franklin daemon (:3100)
   │  @blockrun/llm  (wallet signs x402 payments)
   ▼
BlockRun gateway  ──  image / video / music / chat models
```

The frontend is model-agnostic: it POSTs `{ kind, prompt, model, … }` to `/api/generate`, the
backend maps that onto the `@blockrun/llm` SDK, pays per call, saves the bytes locally and returns a
URL the UI renders.

## Node types

| Node | What it does |
|---|---|
| **Image** | Text-to-image and image-to-image across the gateway image models |
| **Video** | 5–10s clips, multi-model, optional seed image |
| **Music** | Tracks with adaptive or custom lyrics |
| **Text** | Scripts / copy / brand voice via the chat models |
| **Upload** | Drop or pick a reference image |
| **Timeline** *(beta)* | Sequence video / music clips into a cut |
| **Group / Result** | Visually group nodes · final-output preview |

## Tech stack

- Vite + React 19 + TypeScript
- [@xyflow/react](https://reactflow.dev) for the canvas
- Zustand for state (lightweight, no Redux)
- Vanilla CSS variables — neutral dark theme, lime accent
- `server.mjs`: Node, no framework, talks to `@blockrun/llm`

## Project layout

```
src/
  views/        CanvasView · ProjectsView · WalletView · ChatView
  canvas/       nodes · edges · PromptBar · SettingsDialog · stores
  components/   Sidebar · ModelDropdown · …
  api/          franklin.ts  (HTTP client for /api)
  projects.ts   multi-project localStorage store
server.mjs      self-contained backend (wallet · x402 · /api/generate · /api/prompts)
scripts/start.mjs  one-command launcher (backend + UI)
```

## License

Apache-2.0
