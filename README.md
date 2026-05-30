<h1 align="center">Franklin Canvas</h1>

<p align="center">
Node-based AI media studio — generate <strong>images, video and music</strong> on an infinite canvas,
with every generation paid live in <strong>USDC</strong> via x402 through the BlockRun gateway.
</p>

<p align="center">
<a href="https://github.com/BlockRunAI/franklin-canvas/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
<a href="https://github.com/BlockRunAI/Franklin"><img alt="Built on Franklin" src="https://img.shields.io/badge/built%20on-Franklin-a3e635.svg"></a>
<img alt="Chains" src="https://img.shields.io/badge/chains-Base%20%C2%B7%20Solana-cba.svg">
</p>

Franklin Canvas turns an infinite canvas into a visual AI production line: drop nodes, wire them
up, and generate across dozens of image / video / music / text models — no subscription, you pay
per call from your own wallet. Built on the [Franklin core](https://github.com/BlockRunAI/Franklin)
for wallet + payment, but a separate product aimed at creators rather than CLI users.

---

## Highlights

- **Infinite canvas** — pan / zoom / minimap, drag-to-connect nodes, undo–redo, paste images,
  drag-a-Group/Frame brings its children along (Figma-style), and multi-**project** persistence
  (each project is its own saved canvas).
- **Multi-model, multi-modal** — image, video, music and text nodes, each backed by the
  BlockRun gateway catalog.
- **Pay-per-call in USDC, Base *or* Solana** — switch chain in `Settings → Wallet`. No
  subscription; every generation settles via x402.
- **Contextual prompt bar** — select a node and type; attach a reference image from the canvas
  for image-to-image and image-to-video.
- **In-canvas image editing** on any generated image:
  - **Outpaint · Enhance · Cutout · Upscale** (image-to-image through the gateway)
  - **Split 2×2 / 3×3** (pure client-side crop into separate tiles — no spend)
  - **Annotate** — freehand pen tool over the image, saved as a new node (no spend)
  - **Cutout → true transparent PNG** via a post-process alpha pass
- **Result node** — preview + one-click download (and copy-text for text results).
- **Timeline node** — sequence finished video / music clips into an ordered cut.
- **Prompt library** — 800+ ready-made prompts sourced from the open
  [BlockRunAI case-library](https://github.com/BlockRunAI/Claude-Code-GPT-IMAGE2-SeeDance-BlockRun),
  filtered by workflow (text→image · image→image · text→video · image→video) and tag.
- **Themes** — Dark (lime accent), Gold (warm cream + petrol-ink), Light (cool minimal). Sidebar
  + toolbar + connection-line colors all adapt.
- **Collapsible sidebar** — Canvas / Projects in the top group, Wallet / Settings in the footer;
  smooth width animation, icon-only when collapsed.

## Quick start

One command runs the backend (wallet + x402 + generation) on `:3100` and the Vite UI on `:5173`:

```bash
npm install
npm start            # → http://localhost:5173
```

Wallet configuration is **identical to [Franklin core](https://github.com/BlockRunAI/Franklin)** —
they share `~/.blockrun/` and the same env vars, so if Franklin works on this machine, the canvas
works too. Use whichever you prefer:

| Chain  | Wallet file (preferred)        | Env override               |
|--------|--------------------------------|----------------------------|
| Base   | `~/.blockrun/wallet`           | `BASE_CHAIN_WALLET_KEY`    |
| Solana | `~/.blockrun/solana-wallet`    | `SOLANA_WALLET_KEY`        |

A funded wallet is needed for real generations. The UI is fully usable without funds; generation
calls just return a clear error you can retry. Switch chain at runtime in
`Settings → Wallet`.

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
Backend  ──  server.mjs (this repo)
   │  @blockrun/llm  (signs x402 payments on Base or Solana)
   ▼
BlockRun gateway  ──  image / video / music / chat models
```

The frontend is model-agnostic: it POSTs `{ kind, prompt, model, … }` to `/api/generate`, the
backend maps that onto the `@blockrun/llm` SDK, pays per call, saves the bytes locally and
returns a URL the UI renders.

Video generations use a manual submit + poll loop (instead of the SDK's auto-poll) so the client
can re-sign `402` challenges that arrive mid-poll, and so we get a real 20-minute deadline for
slow models like cinematic Seedance.

## Node types

| Node | What it does |
|---|---|
| **Text** | Scripts / copy / brand voice via the chat models |
| **Image** | Text-to-image and image-to-image across the gateway image models |
| **Video** | 5–30s clips, multi-model, optional seed image, optional audio |
| **Music** | ~3-minute tracks with adaptive or custom lyrics |
| **Upload** | Drop or pick a reference image (paste with ⌘V on the canvas also works) |
| **Timeline** *(beta)* | Sequence finished video / music clips into a cut |
| **Group / Frame** | Visually group nodes — drag the frame, the contents follow |
| **Result** | Final-output preview with download / copy-text |

## Tech stack

- Vite + React 19 + TypeScript
- [@xyflow/react](https://reactflow.dev) for the canvas
- Zustand for state (lightweight, no Redux)
- Vanilla CSS variables — three themes with shared accent variable
- `server.mjs`: Node, no framework, talks to `@blockrun/llm`

## Project layout

```
src/
  views/        CanvasView · ProjectsView
  canvas/       nodes · edges · PromptBar · PromptLibrary · SettingsDialog ·
                AnnotateModal · NodeActionMenu · prefsStore · themeStore
  components/   Sidebar
  api/          franklin.ts  (HTTP client for /api)
  projects.ts   multi-project localStorage store
server.mjs      self-contained backend (wallet · x402 · /api/generate · /api/prompts)
scripts/start.mjs  one-command launcher (backend + UI)
```

## Credits

- The Prompt Library inside the canvas lazy-loads cases from the open
  [BlockRunAI case-library](https://github.com/BlockRunAI/Claude-Code-GPT-IMAGE2-SeeDance-BlockRun)
  on GitHub — credit goes to the original prompt authors.
- Wallet + payment plumbing is the [Franklin core](https://github.com/BlockRunAI/Franklin) SDK
  (`@blockrun/llm`).

## License

Apache-2.0
