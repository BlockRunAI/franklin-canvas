<h1 align="center">Franklin Canvas</h1>

<p align="center">
A node-based AI media studio — generate <strong>images, video and music</strong> on an
infinite canvas, chain them into visual workflows, and let an <strong>AI agent</strong> build them for you.
<br/><sub>Use a BlockRun API key or pay per request in USDC via x402 — no subscription.</sub>
</p>

<p align="center">
<a href="https://github.com/BlockRunAI/franklin-canvas/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
<a href="https://github.com/BlockRunAI/Franklin"><img alt="Built on Franklin" src="https://img.shields.io/badge/built%20on-Franklin-a3e635.svg"></a>
<img alt="Chains" src="https://img.shields.io/badge/chains-Solana%20%C2%B7%20Base-cba.svg">
<img alt="x402" src="https://img.shields.io/badge/payment-x402-blue.svg">
</p>

https://github.com/user-attachments/assets/7bbced39-90fd-4fb8-9346-83c0a52d6e49

<p align="center"><sub>▶︎ The 3-feature demo — prompt library · one-sentence AI short film · model comparison</sub></p>

> **Franklin Canvas is live — and fully open source.** If it's useful, please ⭐️ the repo.
> To try it, [clone & run](#quick-start) and create a free [BlockRun account](https://user.blockrun.ai), add credits, and set an API key (pay-per-use, no subscription).

Drop a node, type a prompt, hit Send — then wire nodes into a workflow (image → animate →
stitch), or just describe what you want and let the **Media Agent** build it on the canvas.
An infinite canvas for **image, video and music**, with side-by-side **model comparison**,
in-canvas editing, a 848-case prompt library, timeline, and three themes. Generations use BlockRun account credits or pay per call from a local Solana/Base wallet
(built on the [Franklin core](https://github.com/BlockRunAI/Franklin) SDK).

## Demos

<table>
<tr>
<td width="50%" align="center">

**🤖 Media Agent**

<sub>One sentence → the agent storyboards, generates every shot, and cuts a whole short film on the canvas.</sub>

![Media Agent demo](assets/agent-demo.gif)

<sub>▶︎ <a href="assets/agent-demo.mp4">Watch in HD (MP4)</a></sub>

</td>
<td width="50%" align="center">

**⚖️ Model Comparison**

<sub>One prompt → several video models in parallel → one stitched comparison clip.</sub>

![Model Comparison demo](assets/comparison-demo.gif)

<sub>▶︎ <a href="assets/comparison-demo.mp4">Watch in HD (MP4)</a></sub>

</td>
</tr>
</table>

---

## Highlights

- **🤖 Media Agent.** Describe what you want — *"a cinematic fox clip in a snowy forest,
  with a soundtrack"* — and a real **tool-calling agent** builds it on the canvas step by
  step. It generates, chains image→video, edits / inpaints, upscales, stitches, and
  *looks at* its own results with vision before deciding the next move — and can search
  the web, recall saved preferences, poll a model panel, or touch local files / shell
  when a task needs it. Manual mode confirms each paid step with its cost; Auto mode runs
  the whole workflow. A live tool trace shows every action as nodes appear on the canvas.
- **⚖️ Model Comparison.** Run one prompt through up to **5 video models at once**, watch
  them play in a synchronized grid, then stitch into a single deliverable MP4 — *grid*
  (all together) or *sequence* (one at a time, others frozen on their first frame),
  landscape or **portrait 9:16 for TikTok**. Per-clip model watermark is optional and
  **drag-to-position** so it never covers the action.
- **Multi-model, multi-modal.** 7 image models, 5 video models, 1 music model, plus the
  full chat catalog — mix and match per node, with the live per-call cost shown next to Send.
- **Contextual PromptBar.** Select a node and type — the bar binds to it. Attach a
  reference image with the paperclip (or pick one already on the canvas) for
  image-to-image and image-to-video. A gear opens video settings (aspect / resolution
  / duration / audio) without leaving the bar.
- **In-canvas image editing** on any generated image (the ⋯ menu):
  - **Outpaint · Enhance · Cutout · Upscale** — image-to-image through the gateway.
  - **Split 2×2 / 3×3** — pure client-side crop, no spend.
  - **Annotate** — freehand pen + 7 colors, saved as a new node, no spend.
  - **Cutout → true transparent PNG** via a client-side alpha pass after gen.
- **Timeline.** A real time-axis playlist with a `00:00 / 00:10 / 00:20 …` ruler;
  drop finished video / music clips, blocks sit at their actual duration. Pick a
  cut at a glance.
- **Group / Frame.** Drag the frame, the contents follow (Figma-style sync drag).
  No data model rewrite — purely positional.
- **Prompt library.** 848 ready-made cases scraped from the open
  [BlockRunAI Prompt-Case-Hub](https://github.com/BlockRunAI/Prompt-Case-Hub),
  filtered two-tier: workflow (text→image · image→image · text→video · image→video)
  then tag. Clicking *Use* drops the right node type (video prompts → videogen,
  image prompts → imagegen).
- **Three themes.** Dark (lime accent), Gold (warm cream + petrol-ink), Light (cool
  minimal). Sidebar / toolbar / connection-line palette / floating panels all adapt.
- **View controls.** Bottom-right pill bar with zoom +/− (live %), Fit-to-content,
  and toggles for the background dot grid + minimap.
- **Projects.** Each project is its own saved canvas; ProjectsView lists them with
  cover thumbnails, rename, delete. Esc returns to the canvas.
- **Multi-project, undo/redo, ⌘V paste-to-upload, drag-from-handle to spawn next.**
- **Two pay-per-use options.** Use a BlockRun account API key, or settle in USDC via x402
  from a local wallet (Solana first, Base also supported). Account credentials stay in the local
  backend and are never sent to the browser.

## Quick start

Create a free account at **[user.blockrun.ai](https://user.blockrun.ai)**, add credits at
[Billing](https://user.blockrun.ai/dashboard/credits), then create a key at
[API Keys](https://user.blockrun.ai/dashboard/keys).

```bash
git clone https://github.com/BlockRunAI/franklin-canvas.git
cd franklin-canvas
npm install
BLOCKRUN_API_KEY=brk_... npm start   # → http://localhost:5173
```

The API key stays in the local Node backend. Franklin Canvas never stores it in browser
storage or returns it from an endpoint. To use a self-hosted account API, set
`BLOCKRUN_API_BASE_URL` alongside the key. Requires Node 18+ (native `fetch`).

### x402 wallet mode

If `BLOCKRUN_API_KEY` is unset, Canvas keeps the existing wallet flow. Wallet config is
shared with [Franklin core](https://github.com/BlockRunAI/Franklin). Solana is shown first
and Base remains available in Settings → Billing.

| Chain  | Wallet file (auto-created)     | Env override               |
|--------|--------------------------------|----------------------------|
| Solana | `~/.blockrun/solana-wallet`    | `SOLANA_WALLET_KEY`        |
| Base   | `~/.blockrun/wallet`           | `BASE_CHAIN_WALLET_KEY`    |

Fund the selected address with USDC on the same chain. Every generation settles per call
through x402. Do not set a wallet key together with `BLOCKRUN_API_KEY`; account mode takes
priority and does not create or read a wallet.

### Running the halves separately

```bash
npm run server       # backend only (:3100)
npm run dev          # UI only (:5173), proxies /api → :3100
```

### Deploying behind a real domain (optional)

If you serve the backend on a public host, set:

```bash
ALLOWED_ORIGINS=https://your.app   # comma-separated whitelist; rejects everything else
```

Otherwise CORS stays wide open for localhost dev. The backend uses one billing
credential per process, so a public multi-tenant deployment needs per-user auth
and credential isolation.

## Architecture

```
Browser  (Vite dev / built dist/)
   │  fetch /api/...  (billing · generate · prompts · agent · comparison · transactions)
   ▼
server.mjs  (holds account key or wallet credentials locally)
   │  @blockrun/llm  (account API or x402 on Solana / Base)
   ▼
BlockRun gateway  ──  image / video / music / chat models
```

**The Media Agent** is a real tool-calling loop, run frontend-driven: `/api/agent/chat`
does one model turn (returning OpenAI-style tool calls), the panel executes them, and
the results feed back until the model stops. Canvas/media tools run in the browser
(create/chain/edit/upscale/stitch/describe nodes); the rest — web search, memory,
mixture-of-agents, filesystem, shell — run on the backend via `/api/agent/tool`. Tool
specs and the backend executors live in `agent-tools.mjs`.

**Model Comparison** fans one prompt out to N video models in parallel, then composites
the finished clips with ffmpeg (`/api/comparison/stitch`) — grid or sequence, landscape
or portrait, with the model badge burned in at a caller-chosen position.

The frontend is model-agnostic: it POSTs `{ kind, prompt, model, … }` to
`/api/generate`, and the backend maps that onto the right `@blockrun/llm` client
(`ImageClient`, `MusicClient`, `VideoClient` for account billing; the existing signed flow for wallet video), pays per call, saves the
bytes locally, and returns a `/api/generated/<id>.<ext>` URL the UI renders.

**Video generation** uses the SDK's account-owned polling in API key mode. Wallet mode
keeps the signed submit + poll loop so it can refresh x402 authorization during long jobs.
Account video requires the account API video deployment to be enabled by the operator.

**Pricing** is read live from the gateway's `/v1/models` endpoint at edit time, so
`src/canvas/nodes.tsx`'s `IMAGE_MODELS` / `VIDEO_MODELS` mirror what the gateway
actually charges (not a hardcoded guess that drifts).

## Node types

| Node                 | What it does                                                                       |
|----------------------|------------------------------------------------------------------------------------|
| **Text**             | Scripts / copy / brand voice via the chat models                                   |
| **Image**            | Text-to-image and image-to-image; ⋯ menu has Outpaint/Enhance/Cutout/Upscale/Split/Annotate |
| **Video**            | 5–30s clips, multi-model, optional seed image, optional synced audio               |
| **Music**            | ~3-minute tracks with adaptive or custom lyrics                                    |
| **Upload**           | Drop or pick a reference image (paste with ⌘V on the canvas works too)             |
| **Timeline**         | Real time-axis playlist — drops finished video/music clips proportional to duration |
| **Group / Frame**    | Visually group nodes; drag the frame and contents follow                           |

## Tech stack

- Vite 6 + React 19 + TypeScript 5 (strict)
- [@xyflow/react](https://reactflow.dev) 12 for the canvas
- Zustand for state (per-canvas projects, theme, prefs)
- Vanilla CSS variables — three themes with shared accent + panel vars
- `server.mjs`: Node, no framework, talks to `@blockrun/llm`
- `scripts/start.mjs`: zero-dep launcher that multiplexes both halves' stdout

## Project layout

```
src/
  views/        CanvasView · ProjectsView · ComparisonView
  canvas/       nodes · edges · PromptBar · PromptLibrary · SettingsDialog ·
                VideoSettingsPanel · LyricsPanel · NodeActionMenu ·
                AnnotateModal · CanvasViewBar · prefsStore · themeStore ·
                CanvasContext · AgentPanel · agentTools · agentPrefsStore ·
                agentSessionsStore
  components/   Sidebar · ModelDropdown · NodeFrame · Lightbox · AgentMascot
  api/          franklin.ts  (HTTP client for /api)
  projects.ts   multi-project localStorage store
  uiStore.ts    cross-cutting UI state (prompt library open, etc.)
agent-tools.mjs    agent tool specs + backend tool executors (web · memory · fs · shell …)
server.mjs      self-contained backend (wallet · x402 · generate · prompts · agent · comparison)
scripts/start.mjs  one-command launcher (backend + UI multiplexed stdout)
```

## Credits

- The Prompt Library lazy-loads cases from the open
  [BlockRunAI Prompt-Case-Hub](https://github.com/BlockRunAI/Prompt-Case-Hub)
  — credit goes to the original prompt authors.
- Wallet + x402 payment is the [Franklin core](https://github.com/BlockRunAI/Franklin)
  SDK (`@blockrun/llm`).

## License

Apache-2.0
