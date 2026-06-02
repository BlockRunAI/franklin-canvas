// Media-agent tool layer (ported from the Franklin CLI's tool-calling agent,
// trimmed to the media studio). Two halves:
//
//   1. AGENT_TOOLS — OpenAI-style function specs for EVERY tool the agent can
//      call. The model sees all of them. "Canvas" tools (generate/edit/upscale/
//      stitch/describe/list/ask) are EXECUTED IN THE BROWSER (they manipulate the
//      React-Flow canvas), so there's no executor for them here — only the spec.
//      "Backend" tools (web / memory / MoA / utility / filesystem / bash) run on
//      this server via runBackendTool().
//
//   2. runAgentChat — one turn of the agent loop: prepend the system prompt,
//      hand the conversation + tools to the gateway, return the assistant message
//      (which may contain tool_calls). The FRONTEND drives the loop: execute the
//      tool calls, append the results as `tool` messages, call again — until the
//      model stops asking for tools.
//
// Excluded vs. Franklin CLI (per product decision): trading/交易 (signals,
// markets, swaps, DeFi, prediction), Modal GPU sandboxes, and social/phone/voice.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { LLMClient, SearchClient, BlockrunClient } from '@blockrun/llm';

const MEMORY_FILE = path.join(os.homedir(), '.franklin', 'agent-memory.jsonl');

// Mirror the frontend catalogs so the planner only names ids the gateway serves.
const IMAGE_MODEL_IDS = 'google/nano-banana, google/nano-banana-pro, openai/gpt-image-1, openai/gpt-image-2, xai/grok-imagine-image, zai/cogview-4';
const VIDEO_MODEL_IDS = 'xai/grok-imagine-video, bytedance/seedance-1.5-pro, azure/sora-2, bytedance/seedance-2.0-fast, bytedance/seedance-2.0';
const MUSIC_MODEL_IDS = 'minimax/music-2.5+';

// Vision model for describe_media (must accept image input via the OpenAI-compat
// chat endpoint's content blocks).
const VISION_MODEL = process.env.AGENT_VISION_MODEL || 'google/gemini-3.1-pro';

// ── Tool specs (OpenAI function-calling format) ───────────────────────────────

/** @type {{type:'function', function:{name:string, description:string, parameters:object}}[]} */
export const AGENT_TOOLS = [
  // ----- Canvas / media (executed in the browser) -----
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: `Generate an image from a text prompt and place it as a node on the canvas. Set reference_node_id to an existing image node to do image-to-image (style/subject reference). Available models: ${IMAGE_MODEL_IDS}. Omit model to use the user's default.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed image prompt (subject, lighting, style, mood).' },
          model: { type: 'string', description: 'Image model id, or omit for the default.' },
          reference_node_id: { type: 'string', description: 'Optional node id of an existing image to use as a reference (image-to-image).' },
          aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Optional aspect ratio.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: `Generate a video and place it as a node on the canvas. Set from_node_id to an existing image node to animate that image (image→video); omit it for text→video. Available models: ${VIDEO_MODEL_IDS}. Note: Sora 2 only supports 4/8/12s; Seedance/Grok support 3-10s.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed motion/scene prompt.' },
          model: { type: 'string', description: 'Video model id, or omit for the default.' },
          from_node_id: { type: 'string', description: 'Optional node id of an image to animate (image→video).' },
          duration_s: { type: 'number', description: 'Clip length in seconds (default 5).' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Optional aspect ratio (9:16 for TikTok).' },
          resolution: { type: 'string', enum: ['480p', '720p', '1080p'], description: 'Optional resolution.' },
          audio: { type: 'boolean', description: 'Whether to generate audio (default true).' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_music',
      description: `Generate a music / audio clip from a text prompt and place it as a node on the canvas. Available models: ${MUSIC_MODEL_IDS}.`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Describe genre, mood, instruments, tempo.' },
          model: { type: 'string', description: 'Music model id, or omit for the default.' },
          duration_s: { type: 'number', description: 'Length in seconds (default 8).' },
          lyrics: { type: 'string', description: 'Optional custom lyrics.' },
          instrumental: { type: 'boolean', description: 'Force instrumental (no vocals).' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description: 'Edit / inpaint (局部重绘) an existing image node: apply an instructed change described by the prompt (e.g. "replace the sky with sunset", "remove the person on the left"). Creates a new image node chained from the source.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'Node id of the image to edit.' },
          prompt: { type: 'string', description: 'The edit instruction.' },
          model: { type: 'string', description: 'Optional image model id.' },
        },
        required: ['node_id', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upscale_image',
      description: 'Upscale an existing image node to a higher resolution, recovering fine detail without changing the content. Creates a new image node.',
      parameters: {
        type: 'object',
        properties: { node_id: { type: 'string', description: 'Node id of the image to upscale.' } },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stitch_videos',
      description: 'Composite several finished video nodes into ONE MP4. mode "grid" plays them simultaneously in a grid; "sequence" plays them one after another. orientation "portrait" stacks them top-to-bottom (TikTok 9:16). Creates a combined video node.',
      parameters: {
        type: 'object',
        properties: {
          node_ids: { type: 'array', items: { type: 'string' }, description: 'Node ids of the videos to combine (in order).' },
          mode: { type: 'string', enum: ['grid', 'sequence'], description: 'grid = all at once, sequence = one at a time (default grid).' },
          orientation: { type: 'string', enum: ['landscape', 'portrait'], description: 'portrait = TikTok 9:16 stack (default landscape).' },
        },
        required: ['node_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assemble_film',
      description: 'Join finished video clips END-TO-END into ONE continuous, full-frame short film, in the given order (clip 1 plays, then clip 2, …). This is the way to turn storyboard shots into a final film. Also drops the clips onto a Timeline node so they can be re-ordered/edited. (For a SIDE-BY-SIDE model comparison instead, use stitch_videos.)',
      parameters: {
        type: 'object',
        properties: {
          node_ids: { type: 'array', items: { type: 'string' }, description: 'Video node ids to join, in play order.' },
          title: { type: 'string', description: 'Optional title for the film node.' },
        },
        required: ['node_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_media',
      description: 'Look at an existing image/video node on the canvas and return a description (use it to write a follow-up prompt, check a result, or caption media). For video, the first frame is analyzed.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'Node id of the image or video to look at.' },
          question: { type: 'string', description: 'Optional specific question, else a general description is returned.' },
        },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'regenerate_node',
      description: 'Re-run an EXISTING generation node in place using its own prompt/model/reference (an invalid model is auto-corrected). Use this to RETRY a node that failed — do NOT create a new node or animate a different node for a retry.',
      parameters: {
        type: 'object',
        properties: { node_id: { type: 'string', description: 'The node to re-run.' } },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disconnect_nodes',
      description: 'Remove the connecting edge(s) between two nodes WITHOUT deleting the nodes themselves. Use to fix an incorrect link between blocks. Direction-agnostic.',
      parameters: {
        type: 'object',
        properties: {
          node_a: { type: 'string', description: 'One node id.' },
          node_b: { type: 'string', description: 'The other node id.' },
        },
        required: ['node_a', 'node_b'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_node',
      description: 'Delete one or more nodes from the canvas (and their connecting edges) — e.g. to clean up failed generations, remove rejected drafts, or tidy up. Irreversible, so only delete what is clearly unwanted.',
      parameters: {
        type: 'object',
        properties: { node_ids: { type: 'array', items: { type: 'string' }, description: 'Node ids to delete.' } },
        required: ['node_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_canvas',
      description: 'List the nodes currently on the canvas (id, type, title, prompt, whether it has a finished result). Call this to reference or reuse existing media before generating something new.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a clarifying question and wait for their answer. Use sparingly — only when you genuinely cannot proceed without a decision.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional suggested answers.' },
        },
        required: ['question'],
      },
    },
  },

  // ----- Web research (executed on the backend) -----
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and return a synthesized summary with source citations. Use for current facts, references, trends, or inspiration for prompts.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          max_results: { type: 'number', description: 'Max sources (default 8).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a single URL and return its readable text content (HTML stripped).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch.' },
          max_chars: { type: 'number', description: 'Truncate to this many characters (default 6000).' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exa_search',
      description: 'Neural web search via Exa — higher-quality, semantic results with content snippets. Good for research papers, articles, company/people lookups.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          num_results: { type: 'number', description: 'Number of results (default 6).' },
          category: { type: 'string', description: 'Optional: github | news | research paper | company | pdf | tweet.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'exa_answer',
      description: 'Ask Exa a factual question and get a synthesized answer with sources.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The question.' } },
        required: ['query'],
      },
    },
  },

  // ----- Memory / MoA / utility (executed on the backend) -----
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Recall facts the user has saved across sessions (preferences, brand guidelines, recurring characters, etc.) matching a query.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to recall.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description: 'Save a durable fact for future sessions (a preference, a brand color, a recurring character description). Keep each memory to one clear fact.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The fact to remember.' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mixture_of_agents',
      description: 'Ask several different LLMs the same question in parallel and synthesize their answers into one stronger response. Use for hard reasoning, brainstorming, or creative direction.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'The question to put to the panel.' } },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webhook_post',
      description: 'POST a JSON payload to a webhook URL (e.g. notify an external system that media is ready).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Webhook URL.' },
          data: { type: 'object', description: 'JSON payload.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wallet_status',
      description: 'Report the wallet address, USDC balance, and recent spend. Use to check whether there are funds before an expensive generation.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ----- Filesystem / shell (executed on the backend, on the user's machine) -----
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the local filesystem, returned with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path.' },
          offset: { type: 'number', description: 'Start line (1-based).' },
          limit: { type: 'number', description: 'Max lines to read (default 400).' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a text file on the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write.' },
          content: { type: 'string', description: 'Full file contents.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact string in a local file with a new string (the old string must be unique in the file).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path.' },
          old_str: { type: 'string', description: 'Exact text to replace.' },
          new_str: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern (e.g. "src/**/*.ts"). Returns matching paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern.' },
          path: { type: 'string', description: 'Base directory (default cwd).' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents for a regex pattern (ripgrep-style). Returns matching lines with file:line.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex to search for.' },
          path: { type: 'string', description: 'File or directory to search (default cwd).' },
          ignore_case: { type: 'boolean', description: 'Case-insensitive.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command on the local machine and return its stdout/stderr. Use for builds, ffmpeg, file management, git, etc. Avoid destructive commands.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command.' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default 60000, max 600000).' },
        },
        required: ['command'],
      },
    },
  },
];

// Names the FRONTEND owns (executed in the browser). Everything else → backend.
export const CANVAS_TOOL_NAMES = new Set([
  'generate_image', 'generate_video', 'generate_music', 'edit_image',
  'upscale_image', 'stitch_videos', 'assemble_film', 'describe_media', 'list_canvas', 'delete_node', 'disconnect_nodes', 'regenerate_node', 'ask_user',
]);

export const AGENT_CHAT_SYSTEM = `You are the Media Agent inside a node-based AI media studio (an infinite canvas). The user describes media they want — usually images, short videos, or music — and you BUILD it by calling tools. Each generation appears as a node on the canvas; chaining tools (image → animate → stitch) connects the nodes visually.

You are a REAL tool-using agent: call a tool, look at its result, then decide the next step. Do NOT plan the whole thing up front and dump it — work one step at a time, reacting to what each tool returns (e.g. read a generated image with describe_media before animating it if useful).

How to work:
- For "make a video of X": usually generate_image (establish the look) → generate_video with from_node_id set to that image (animate it) → optionally generate_music. But adapt to the request.
- Tools that return a node_id let you chain: pass that id as reference_node_id / from_node_id / node_id to the next tool.
- Use list_canvas to see what exists. Each line shows the node's type, status, whether it has a result, AND its connections: "← from X" (X feeds this node) and "→ to Y" (this node feeds Y). Use these to understand the graph before acting. Before animating an image, check if it already has a video "→ to" it — if so, don't create a duplicate; regenerate that existing video instead. Use delete_node to clean up failed/rejected nodes when asked to tidy up.
- To RETRY a node that failed, call regenerate_node with that node's id (find it via list_canvas — it's the one with status=error). Re-run the SAME node; do not create a new node or animate a different node just to retry.
- Node ids encode their kind, so you can tell them apart at a glance: img* = image, vid* = video, mus* = music, film* = stitched film (older nodes may be n*; the [type] in list_canvas is authoritative). So to animate an image, pass an img* (or [image]) node as from_node_id — never a vid*/[video] node.
- Use describe_media to actually look at a result (e.g. to verify it, caption it, or write a better follow-up prompt).
- To turn a multi-shot storyboard into a finished film, generate each shot as its own video, then call assemble_film with those node_ids — it joins them end-to-end into one continuous clip (and lays them on a Timeline). Use stitch_videos ONLY for side-by-side model comparisons, not for storyboard films.
- Web tools (web_search/exa) are for references, facts, and inspiration. Filesystem/bash tools operate on the user's machine — use them when the task involves local files, ffmpeg, or project work.
- The app shows the user a cost confirmation before each paid/destructive tool runs and may auto-approve in auto mode — you don't need to ask permission for cost yourself, just call the tool.
- Write rich, specific prompts (lighting, motion, style, mood) — they drive real paid generations.
- LANGUAGE: write the prompt argument for generate_image / generate_video / generate_music in the SAME language the user wrote in (if the user wrote Chinese, the prompt must be Chinese). Do NOT translate it to English.
- If you have drafted a storyboard / 分镜, feed each scene's description DIRECTLY into that step's prompt — keep its wording, detail and language verbatim; do not paraphrase or shorten it into a new (or English) prompt.
- When the deliverable is done, stop calling tools and give a short, friendly summary of what's on the canvas.

Keep replies concise. Think in actions, not essays.`;

// ── Backend tool execution ────────────────────────────────────────────────────

const clamp = (s, n) => (s.length > n ? s.slice(0, n) + `\n… [truncated, ${s.length} chars total]` : s);

function llm(ctx) { return new LLMClient({ privateKey: ctx.privateKey, apiUrl: ctx.apiUrl }); }

// Strip a fetched HTML document down to readable text.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function memoryRecall(query) {
  if (!fs.existsSync(MEMORY_FILE)) return 'No saved memories yet.';
  const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = fs.readFileSync(MEMORY_FILE, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const scored = rows.map((r) => {
    const t = String(r.text || '').toLowerCase();
    return { r, score: q.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  if (!scored.length) return 'No matching memories.';
  return scored.map((x) => `- ${x.r.text}`).join('\n');
}

function memorySave(text) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.appendFileSync(MEMORY_FILE, JSON.stringify({ ts: Date.now(), text: String(text) }) + '\n');
  return 'Saved.';
}

async function mixtureOfAgents(question, ctx) {
  const panel = ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.5', 'google/gemini-3.1-pro'];
  const client = llm(ctx);
  const answers = await Promise.all(panel.map(async (m) => {
    try {
      const r = await client.chatCompletion(m, [{ role: 'user', content: question }], { maxTokens: 700, temperature: 0.6 });
      return { m, text: r?.choices?.[0]?.message?.content || '' };
    } catch (e) { return { m, text: `(failed: ${e.message || e})` }; }
  }));
  const synthPrompt = `Several AI models answered the question below. Synthesize their best points into one clear, correct answer.\n\nQUESTION: ${question}\n\n${answers.map((a, i) => `=== Model ${i + 1} (${a.m}) ===\n${a.text}`).join('\n\n')}`;
  const synth = await client.chatCompletion('anthropic/claude-sonnet-4.6', [{ role: 'user', content: synthPrompt }], { maxTokens: 900, temperature: 0.4 });
  return synth?.choices?.[0]?.message?.content || answers.map((a) => `${a.m}: ${a.text}`).join('\n\n');
}

function resolveFsPath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function runShell(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], { cwd: process.cwd() });
    let out = '', err = '';
    const to = setTimeout(() => { child.kill('SIGKILL'); }, Math.min(Math.max(timeoutMs || 60000, 1000), 600000));
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(to);
      const body = [out && out, err && `[stderr]\n${err}`].filter(Boolean).join('\n');
      resolve(`(exit ${code})\n${clamp(body || '(no output)', 20000)}`);
    });
    child.on('error', (e) => { clearTimeout(to); resolve(`error: ${e.message}`); });
  });
}

// Execute one backend tool. Returns a STRING (what the model sees). Throws on
// hard failure; the caller wraps thrown errors as an is_error tool result.
export async function runBackendTool(name, input = {}, ctx) {
  switch (name) {
    case 'web_search': {
      const sc = new SearchClient({ privateKey: ctx.privateKey, apiUrl: ctx.apiUrl });
      const r = await sc.search(input.query, { maxResults: input.max_results || 8 });
      const cites = (r.citations || []).map((c) => `- ${c.title || c.url || ''} ${c.url || ''}`.trim()).join('\n');
      return clamp(`${r.summary || ''}${cites ? `\n\nSources:\n${cites}` : ''}`, 8000);
    }
    case 'web_fetch': {
      const resp = await fetch(input.url, { headers: { 'user-agent': 'franklin-canvas-agent' } });
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const ct = resp.headers.get('content-type') || '';
      const raw = await resp.text();
      const text = ct.includes('html') ? htmlToText(raw) : raw;
      return clamp(text, input.max_chars || 6000);
    }
    case 'exa_search': {
      const r = await llm(ctx).exaSearch(input.query, { numResults: input.num_results || 6, ...(input.category ? { category: input.category } : {}) });
      const results = r?.results || [];
      if (!results.length) return 'No results.';
      return clamp(results.map((x, i) => `${i + 1}. ${x.title || ''}\n   ${x.url || ''}\n   ${(x.text || x.snippet || '').slice(0, 300)}`).join('\n\n'), 8000);
    }
    case 'exa_answer': {
      const r = await llm(ctx).exaAnswer(input.query);
      const cites = (r?.citations || []).map((c) => `- ${c.title || ''} ${c.url || ''}`.trim()).join('\n');
      return clamp(`${r?.answer || ''}${cites ? `\n\nSources:\n${cites}` : ''}`, 8000);
    }
    case 'memory_recall': return await memoryRecall(input.query);
    case 'memory_save': return memorySave(input.text);
    case 'mixture_of_agents': return clamp(await mixtureOfAgents(input.question, ctx), 6000);
    case 'webhook_post': {
      const resp = await fetch(input.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.data ?? {}) });
      return `POST ${input.url} → ${resp.status} ${resp.statusText}`;
    }
    case 'wallet_status': {
      try {
        const c = llm(ctx);
        const bal = await c.getBalance().catch(() => null);
        return `Wallet ${ctx.address || c.getWalletAddress?.() || '(unknown)'} — balance: ${typeof bal === 'number' ? `$${bal.toFixed(2)} USDC` : 'unknown'}.`;
      } catch (e) { return `Wallet status unavailable: ${e.message || e}`; }
    }
    case 'read_file': {
      const fp = resolveFsPath(input.path);
      const lines = fs.readFileSync(fp, 'utf8').split('\n');
      const start = Math.max((input.offset || 1) - 1, 0);
      const end = Math.min(start + (input.limit || 400), lines.length);
      return clamp(lines.slice(start, end).map((l, i) => `${String(start + i + 1).padStart(5)}\t${l}`).join('\n'), 20000);
    }
    case 'write_file': {
      const fp = resolveFsPath(input.path);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, input.content ?? '');
      return `Wrote ${input.content?.length ?? 0} bytes to ${fp}.`;
    }
    case 'edit_file': {
      const fp = resolveFsPath(input.path);
      const cur = fs.readFileSync(fp, 'utf8');
      const count = cur.split(input.old_str).length - 1;
      if (count === 0) throw new Error('old_str not found in file');
      if (count > 1) throw new Error(`old_str is not unique (${count} matches)`);
      fs.writeFileSync(fp, cur.replace(input.old_str, input.new_str));
      return `Edited ${fp}.`;
    }
    case 'glob': {
      const base = input.path ? resolveFsPath(input.path) : process.cwd();
      const out = await runShell(`find ${JSON.stringify(base)} -type f 2>/dev/null | head -400`, 20000);
      // crude glob filter
      const rx = globToRegExp(input.pattern);
      const matches = out.split('\n').filter((l) => rx.test(l)).slice(0, 200);
      return matches.length ? matches.join('\n') : 'No matches.';
    }
    case 'grep': {
      const base = input.path ? resolveFsPath(input.path) : process.cwd();
      const flags = input.ignore_case ? '-rniI' : '-rnI';
      return await runShell(`grep ${flags} -- ${JSON.stringify(input.pattern)} ${JSON.stringify(base)} 2>/dev/null | head -200`, 30000);
    }
    case 'bash': return await runShell(input.command, input.timeout_ms);
    default: throw new Error(`Unknown backend tool: ${name}`);
  }
}

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*').replace(/\?/g, '.');
  return new RegExp(esc + '$');
}

// ── describe_media (vision) ───────────────────────────────────────────────────
// The frontend hands us a node's media URL. For local /api/generated/ files we
// run ONE ffmpeg pass → a downscaled (≤1024px) JPEG: this grabs the first frame
// of a video AND shrinks images, so the vision payload is small and fast (large
// full-res frames were slow enough to hit the request timeout = "aborted").

// Produce a small JPEG (first frame for video, scaled for image). Returns path.
function toSmallJpeg(srcPath) {
  return new Promise((resolve, reject) => {
    const out = `${srcPath}.desc.jpg`;
    const pp = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', srcPath, '-frames:v', '1',
      '-vf', "scale='min(1024,iw)':-2", '-q:v', '4', out]);
    pp.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve(out) : reject(new Error('image prep failed'))));
    pp.on('error', reject);
  });
}

export async function describeMedia({ imageUrl, question }, ctx) {
  let url = imageUrl;
  let tmp = null;
  if (url && url.startsWith('/api/generated/')) {
    const fp = path.join(ctx.jobsDir, path.basename(url.split('?')[0]));
    if (fs.existsSync(fp)) {
      try {
        tmp = await toSmallJpeg(fp);
        url = `data:image/jpeg;base64,${fs.readFileSync(tmp).toString('base64')}`;
      } catch {
        // Fallback: inline the raw image bytes (skip videos — can't inline those).
        const ext = path.extname(fp).slice(1).toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          url = `data:${mime};base64,${fs.readFileSync(fp).toString('base64')}`;
        }
      }
    }
  }
  if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } }
  if (!url) throw new Error('no image to describe');
  const br = new BlockrunClient({ privateKey: ctx.privateKey, apiUrl: ctx.apiUrl, timeout: 120000 });
  const resp = await br.post('/v1/chat/completions', {
    model: VISION_MODEL,
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: question || 'Describe this media in detail — subject, composition, colors, lighting, style. Be concise.' },
        { type: 'image_url', image_url: { url } },
      ],
    }],
  });
  return resp?.choices?.[0]?.message?.content || '(no description)';
}

// ── One agent turn ────────────────────────────────────────────────────────────

// Guarantee valid OpenAI tool threading: every assistant tool_call is
// immediately followed by its tool result (a stub if the real one is missing),
// and orphan tool messages (no matching tool_call) are dropped. A malformed
// thread — e.g. a generation that errored mid-flight, or a half-saved history —
// otherwise makes the gateway reject the whole turn with a 400.
function sanitizeMessages(messages) {
  const msgs = (Array.isArray(messages) ? messages : []).filter(Boolean);
  const toolById = new Map();
  for (const m of msgs) if (m.role === 'tool' && m.tool_call_id) toolById.set(m.tool_call_id, m);
  const out = [];
  for (const m of msgs) {
    if (m.role === 'tool') continue; // re-emitted right after its assistant below
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      out.push(m);
      for (const c of m.tool_calls) {
        out.push(toolById.get(c.id) || { role: 'tool', tool_call_id: c.id, name: c.function?.name, content: '(no result recorded)' });
      }
    } else {
      out.push(m);
    }
  }
  return out;
}

export async function runAgentChat({ model, messages }, ctx) {
  const client = llm(ctx);
  const planModel = model || 'anthropic/claude-sonnet-4.6';
  const msgs = [{ role: 'system', content: AGENT_CHAT_SYSTEM }, ...sanitizeMessages(messages)];
  const resp = await client.chatCompletion(planModel, msgs, {
    tools: AGENT_TOOLS,
    toolChoice: 'auto',
    maxTokens: 2000,
    temperature: 0.4,
  });
  const choice = resp?.choices?.[0];
  const message = choice?.message || { role: 'assistant', content: '' };
  return { message, finish_reason: choice?.finish_reason || 'stop' };
}

// Compress the earlier part of an agent conversation into a short running memory
// (auto-compact). The frontend feeds the early turns here when history grows too
// large, then replaces them with the returned summary to keep the context lean.
export async function summarizeConversation(messages, ctx) {
  const transcript = (Array.isArray(messages) ? messages : []).map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls.map((c) => `${c.function?.name}(${clamp(String(c.function?.arguments || ''), 200)})`).join(', ');
      return `ASSISTANT called: ${calls}${m.content ? `\nASSISTANT: ${m.content}` : ''}`;
    }
    if (m.role === 'tool') return `TOOL RESULT (${m.name}): ${clamp(String(m.content || ''), 500)}`;
    return `${String(m.role).toUpperCase()}: ${m.content || ''}`;
  }).join('\n');
  const sys = `You compress the earlier part of an AI media-studio agent conversation into a brief running memory. PRESERVE: the user's overall goal; every asset created (node id + media kind + result_url + model); key creative decisions; and any unfinished tasks. Drop chit-chat. Output concise plain-text notes (<= 250 words).`;
  const client = llm(ctx);
  const resp = await client.chatCompletion('anthropic/claude-haiku-4.5',
    [{ role: 'system', content: sys }, { role: 'user', content: clamp(transcript, 40000) }],
    { maxTokens: 700, temperature: 0.2 });
  return resp?.choices?.[0]?.message?.content || '';
}
