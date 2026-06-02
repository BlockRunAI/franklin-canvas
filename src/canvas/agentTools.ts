// Frontend tool dispatch for the Media Agent's tool-calling loop.
//
// The model (via /api/agent/chat) asks for tools by name. CANVAS tools are
// executed here in the browser through a CanvasAgentApi the CanvasView provides
// (they create / chain / read nodes on the React-Flow canvas). Every other tool
// is a BACKEND tool, forwarded to /api/agent/tool. Each executor returns the
// plain string the model sees as the tool result.

import { agentTool } from '../api/franklin';
import { IMAGE_MODELS, VIDEO_MODELS, MUSIC_MODELS } from './nodes';

export type GenKind = 'imagegen' | 'videogen' | 'musicgen';

export interface CanvasNodeInfo {
  nodeId: string;
  type: string;
  title: string;
  prompt: string;
  hasResult: boolean;
  resultKind?: 'image' | 'video' | 'music';
  status?: string; // idle | running | done | error
  from?: string[]; // ids of nodes feeding INTO this one (incoming edges)
  to?: string[];   // ids of nodes this one feeds (outgoing edges)
}

export interface CanvasToolResult {
  ok: boolean;
  nodeId?: string;
  resultUrl?: string;
  text?: string;
  error?: string;
}

// Implemented by CanvasView and handed to the AgentPanel.
export interface CanvasAgentApi {
  generate(kind: GenKind, args: {
    prompt: string; model?: string; referenceNodeId?: string; fromNodeId?: string;
    durationS?: number; aspectRatio?: string; resolution?: string; audio?: boolean;
    lyrics?: string; instrumental?: boolean;
  }): Promise<CanvasToolResult>;
  editImage(args: { nodeId: string; prompt: string; model?: string }): Promise<CanvasToolResult>;
  upscaleImage(nodeId: string): Promise<CanvasToolResult>;
  stitchVideos(nodeIds: string[], mode: 'grid' | 'sequence', orientation: 'landscape' | 'portrait'): Promise<CanvasToolResult>;
  assembleFilm(nodeIds: string[], title?: string): Promise<CanvasToolResult>;
  describe(nodeId: string, question?: string): Promise<CanvasToolResult>;
  listCanvas(): CanvasNodeInfo[];
  deleteNodes(nodeIds: string[]): Promise<CanvasToolResult>;
  disconnectNodes(a: string, b: string): Promise<CanvasToolResult>;
  regenerateNode(nodeId: string): Promise<CanvasToolResult>;
}

export interface ToolDeps {
  canvas: CanvasAgentApi;
  askUser: (question: string, options?: string[]) => Promise<string>;
}

// Tools that spend real money or mutate the machine / external systems — these
// get a cost/confirm gate in manual mode. Read-only research/vision tools run
// without prompting (cheap, no side effects).
export const CONFIRM_TOOLS = new Set([
  'generate_image', 'generate_video', 'generate_music', 'edit_image', 'upscale_image',
  'regenerate_node', 'delete_node', 'write_file', 'edit_file', 'bash', 'webhook_post',
]);

// Tools the canvas executes in-browser (everything else → backend).
const CANVAS_TOOLS = new Set([
  'generate_image', 'generate_video', 'generate_music', 'edit_image',
  'upscale_image', 'stitch_videos', 'assemble_film', 'describe_media', 'list_canvas',
  'delete_node', 'disconnect_nodes', 'regenerate_node', 'ask_user',
]);

// Rough USD estimate for the confirm gate (0 when not a paid media op).
export function estimateToolCost(name: string, input: Record<string, unknown>, prefs: { imageModel: string; videoModel: string }): number {
  if (name === 'generate_image' || name === 'edit_image' || name === 'upscale_image') {
    const id = (input.model as string) || prefs.imageModel;
    return (IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0]).price;
  }
  if (name === 'generate_video') {
    const id = (input.model as string) || prefs.videoModel;
    const m = VIDEO_MODELS.find((x) => x.id === id) ?? VIDEO_MODELS[1];
    return m.pricePerS * (Number(input.duration_s) || 5);
  }
  if (name === 'generate_music') {
    const id = (input.model as string) || MUSIC_MODELS[0].id;
    return (MUSIC_MODELS.find((m) => m.id === id) ?? MUSIC_MODELS[0]).price;
  }
  return 0;
}

// Short human label for a tool call, shown in the chat trace.
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const p = (input.prompt as string) || (input.query as string) || (input.question as string) || (input.command as string) || (input.path as string) || '';
  const short = p.length > 48 ? p.slice(0, 48) + '…' : p;
  switch (name) {
    case 'generate_image': return `Generate image · ${short}`;
    case 'generate_video': return `Generate video · ${short}`;
    case 'generate_music': return `Generate music · ${short}`;
    case 'edit_image': return `Edit image · ${short}`;
    case 'upscale_image': return `Upscale image`;
    case 'stitch_videos': return `Stitch ${(input.node_ids as string[])?.length ?? 0} videos`;
    case 'assemble_film': return `Assemble film · ${(input.node_ids as string[])?.length ?? 0} clips`;
    case 'describe_media': return `Look at media`;
    case 'list_canvas': return `Read canvas`;
    case 'delete_node': return `Delete ${(input.node_ids as string[])?.length ?? 0} node(s)`;
    case 'disconnect_nodes': return `Disconnect ${input.node_a as string} ↔ ${input.node_b as string}`;
    case 'regenerate_node': return `Regenerate node ${(input.node_id as string) || ''}`;
    case 'ask_user': return `Ask: ${short}`;
    case 'web_search': return `Web search · ${short}`;
    case 'web_fetch': return `Fetch ${short}`;
    case 'exa_search': return `Exa search · ${short}`;
    case 'exa_answer': return `Exa answer · ${short}`;
    case 'memory_recall': return `Recall memory · ${short}`;
    case 'memory_save': return `Save memory`;
    case 'mixture_of_agents': return `Ask model panel · ${short}`;
    case 'webhook_post': return `Webhook → ${short}`;
    case 'wallet_status': return `Check wallet`;
    case 'read_file': return `Read ${short}`;
    case 'write_file': return `Write ${short}`;
    case 'edit_file': return `Edit ${short}`;
    case 'glob': return `Glob ${input.pattern as string}`;
    case 'grep': return `Grep ${input.pattern as string}`;
    case 'bash': return `Run · ${short}`;
    default: return name;
  }
}

// Execute one tool call and return the string the model sees as its result.
export async function executeToolCall(name: string, input: Record<string, unknown>, deps: ToolDeps): Promise<string> {
  if (CANVAS_TOOLS.has(name)) return executeCanvasTool(name, input, deps);
  const { output } = await agentTool(name, input);
  return output;
}

async function executeCanvasTool(name: string, input: Record<string, unknown>, { canvas, askUser }: ToolDeps): Promise<string> {
  const str = (k: string) => (input[k] == null ? undefined : String(input[k]));
  const num = (k: string) => (input[k] == null ? undefined : Number(input[k]));

  switch (name) {
    case 'generate_image': {
      const r = await canvas.generate('imagegen', { prompt: str('prompt')!, model: str('model'), referenceNodeId: str('reference_node_id'), aspectRatio: str('aspect_ratio') });
      return genResult(r, 'image');
    }
    case 'generate_video': {
      const r = await canvas.generate('videogen', {
        prompt: str('prompt')!, model: str('model'), fromNodeId: str('from_node_id'),
        durationS: num('duration_s'), aspectRatio: str('aspect_ratio'), resolution: str('resolution'),
        audio: input.audio == null ? undefined : !!input.audio,
      });
      return genResult(r, 'video');
    }
    case 'generate_music': {
      const r = await canvas.generate('musicgen', { prompt: str('prompt')!, model: str('model'), durationS: num('duration_s'), lyrics: str('lyrics'), instrumental: input.instrumental == null ? undefined : !!input.instrumental });
      return genResult(r, 'music');
    }
    case 'edit_image': {
      const r = await canvas.editImage({ nodeId: str('node_id')!, prompt: str('prompt')!, model: str('model') });
      return genResult(r, 'image');
    }
    case 'upscale_image': {
      const r = await canvas.upscaleImage(str('node_id')!);
      return genResult(r, 'image');
    }
    case 'stitch_videos': {
      const ids = (input.node_ids as string[]) || [];
      const mode = (str('mode') as 'grid' | 'sequence') || 'grid';
      const orientation = (str('orientation') as 'landscape' | 'portrait') || 'landscape';
      const r = await canvas.stitchVideos(ids, mode, orientation);
      if (!r.ok) return `Stitch failed: ${r.error}`;
      return `Stitched ${ids.length} videos into node ${r.nodeId} (${mode}/${orientation}). result_url=${r.resultUrl}`;
    }
    case 'assemble_film': {
      const ids = (input.node_ids as string[]) || [];
      const r = await canvas.assembleFilm(ids, str('title'));
      if (!r.ok) return `Assemble failed: ${r.error}`;
      return `Assembled ${ids.length} clips into one film (node ${r.nodeId}) and laid them on a Timeline. result_url=${r.resultUrl}`;
    }
    case 'describe_media': {
      const r = await canvas.describe(str('node_id')!, str('question'));
      return r.ok ? (r.text || '(no description)') : `Describe failed: ${r.error}`;
    }
    case 'list_canvas': {
      const nodes = canvas.listCanvas();
      if (!nodes.length) return 'Canvas graph — 0 nodes. The canvas is empty.';
      const typeOf = new Map(nodes.map((n) => [n.nodeId, n.type]));
      const ann = (ids?: string[]) => (ids || []).map((i) => `${i}[${typeOf.get(i) || '?'}]`).join(', ');
      const edgeCount = nodes.reduce((s, n) => s + (n.to?.length || 0), 0);
      const lines = nodes.map((n) => {
        const from = n.from?.length ? ` ← from ${ann(n.from)}` : '';
        const out = n.to?.length ? ` → to ${ann(n.to)}` : '';
        return `- ${n.nodeId} [${n.type}] status=${n.status || 'idle'}${n.hasResult ? ` (has ${n.resultKind} result)` : ''}${from}${out} "${n.title}" — ${n.prompt.slice(0, 50)}`;
      });
      return `Canvas graph — ${nodes.length} nodes, ${edgeCount} edges:\n${lines.join('\n')}`;
    }
    case 'delete_node': {
      const ids = (input.node_ids as string[]) || [];
      const r = await canvas.deleteNodes(ids);
      return r.ok ? (r.text || `Deleted ${ids.length} node(s).`) : `Delete failed: ${r.error}`;
    }
    case 'disconnect_nodes': {
      const r = await canvas.disconnectNodes(str('node_a')!, str('node_b')!);
      return r.ok ? (r.text || 'Disconnected.') : `Disconnect failed: ${r.error}`;
    }
    case 'regenerate_node': {
      const r = await canvas.regenerateNode(str('node_id')!);
      return r.ok ? `Regenerated node ${str('node_id')}. result_url=${r.resultUrl}` : `Regenerate failed: ${r.error}`;
    }
    case 'ask_user': {
      const answer = await askUser(str('question')!, input.options as string[] | undefined);
      return `User answered: ${answer}`;
    }
    default:
      return `Unknown canvas tool: ${name}`;
  }
}

function genResult(r: CanvasToolResult, kind: string): string {
  if (!r.ok) return `Generation failed: ${r.error}`;
  return `Created ${kind} node ${r.nodeId}. result_url=${r.resultUrl}. You can chain from this by passing node_id "${r.nodeId}".`;
}
