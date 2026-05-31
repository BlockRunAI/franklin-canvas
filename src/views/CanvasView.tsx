import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type OnConnectStart,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Sparkles } from 'lucide-react';
import { NODE_TYPES, NODE_CATALOG, CATEGORY_TITLES, IMAGE_MODELS, VIDEO_MODELS, type GenNodeData, type NodeStatus, type NodeCatalogEntry } from '../canvas/nodes';
import { EDGE_TYPES } from '../canvas/edges';
import PromptBar from '../canvas/PromptBar';
import PromptLibrary from '../canvas/PromptLibrary';
import AnnotateModal from '../canvas/AnnotateModal';
import CanvasViewBar from '../canvas/CanvasViewBar';
import { usePrefsStore } from '../canvas/prefsStore';
import { CanvasContext, type ImageEditOp } from '../canvas/CanvasContext';
import { generate } from '../api/franklin';
import { getOrCreateCurrent, saveProjectCanvas, renameProject } from '../projects';
import { useUiStore } from '../uiStore';
import { useThemeStore } from '../canvas/themeStore';

// Demo seed for first-time users. Defaults pick the cheapest model in each
// catalog so a curious click on "Send" costs ~cents, not dollars (the prior
// seed used Seedance 2.0 cinematic at $1.60/clip). Prompts are deliberately
// generic so they read for anyone, not just folks already in the Franklin
// world.
const CHEAP_IMAGE = IMAGE_MODELS.find((m) => m.id === 'google/nano-banana') ?? IMAGE_MODELS[0];
const CHEAP_VIDEO = [...VIDEO_MODELS].sort((a, b) => a.pricePerS - b.pricePerS)[0];
const INITIAL_NODES: Node[] = [
  { id: 'n1', type: 'upload', position: { x: 80, y: 160 }, data: { label: 'photo' } },
  {
    id: 'n2',
    type: 'imagegen',
    position: { x: 460, y: 80 },
    data: {
      label: 'image',
      model: CHEAP_IMAGE.id,
      prompt: 'A serene Japanese garden at golden hour, shot on 35mm film',
      priceUsd: CHEAP_IMAGE.price,
    } as GenNodeData,
  },
  {
    id: 'n3',
    type: 'videogen',
    position: { x: 460, y: 360 },
    data: {
      label: 'video',
      model: CHEAP_VIDEO.id,
      prompt: '8s cinematic shot of a paper plane drifting through clouds',
      priceUsd: CHEAP_VIDEO.pricePerS * 8,
      durationS: 8,
    } as GenNodeData,
  },
];

// Explicit source/target handle ids — nodes carry both a left (target, "-in")
// and right (source, "-out") handle, so an edge MUST name which one or React
// Flow can't resolve the handle and falls back to the node corner.
const INITIAL_EDGES: Edge[] = [
  { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'n1-out', targetHandle: 'n2-in', type: 'flow' },
  { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'n1-out', targetHandle: 'n3-in', type: 'flow' },
];

// Categorize the catalog for the connect menu
const GENERATE_TYPES = NODE_CATALOG.filter((n) =>
  ['text', 'imagegen', 'videogen'].includes(n.type),
);
const UTILITY_TYPES = NODE_CATALOG.filter((n) =>
  ['result', 'group', 'timeline'].includes(n.type),
);

interface PendingConnect {
  fromNodeId: string;
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  side?: 'left' | 'right';
}

function CanvasInner() {
  // Load the current project (created with the demo seed for first-time users).
  // CanvasView remounts on route change, so opening a project from the
  // Projects view lands us on that project's canvas. Lazy init runs once.
  const [project] = useState(() => getOrCreateCurrent({ nodes: INITIAL_NODES, edges: INITIAL_EDGES }));
  const projectIdRef = useRef(project.id);
  const [nodes, setNodes, onNodesChange] = useNodesState(project.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(project.edges);

  // Persist canvas back into the current project (debounced).
  useEffect(() => {
    const t = setTimeout(() => saveProjectCanvas(projectIdRef.current, nodes, edges), 400);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  // ── Undo / Redo ──
  type Snapshot = { nodes: Node[]; edges: Edge[] };
  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const prevSnapRef = useRef<Snapshot>({ nodes, edges });
  const isUndoRedoRef = useRef(false);
  useEffect(() => {
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      prevSnapRef.current = { nodes, edges };
      return;
    }
    const t = setTimeout(() => {
      historyRef.current.past.push(prevSnapRef.current);
      if (historyRef.current.past.length > 50) historyRef.current.past.shift();
      historyRef.current.future = [];
      prevSnapRef.current = { nodes, edges };
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const snap = historyRef.current.past.pop();
    if (!snap) return;
    historyRef.current.future.push({ nodes, edges });
    isUndoRedoRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const snap = historyRef.current.future.pop();
    if (!snap) return;
    historyRef.current.past.push({ nodes, edges });
    isUndoRedoRef.current = true;
    setNodes(snap.nodes);
    setEdges(snap.edges);
  }, [nodes, edges, setNodes, setEdges]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const [pending, setPending] = useState<PendingConnect | null>(null);
  const [projectName, setProjectName] = useState(project.name);
  const promptLibOpen = useUiStore((s) => s.promptLibOpen);
  const setPromptLibOpen = useUiStore((s) => s.setPromptLibOpen);
  const theme = useThemeStore((s) => s.theme);
  const showMinimap = usePrefsStore((s) => s.showMinimap);
  const showDots = usePrefsStore((s) => s.showDots);
  // Dot pattern + minimap mask colors that read well against each theme's bg.
  const bgDotColor = theme === 'dark' ? '#222' : theme === 'gold' ? '#d8d2c6' : '#e0e0dd';
  const minimapMask = theme === 'dark' ? 'rgba(7,7,10,0.85)' : 'rgba(255,255,255,0.7)';
  const connectStartFrom = useRef<string | null>(null);
  const idCounter = useRef(100);
  const { screenToFlowPosition, getNode } = useReactFlow();

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'flow' }, eds)),
    [setEdges],
  );

  // ── Group sync drag ──
  // When a Group/Frame node is dragged, the nodes whose center sits inside its
  // bounds at drag-start should follow the drag delta — Figma-frame style.
  // We snapshot the affected children on drag-start (no parent/child rewrite
  // needed) and apply the delta to their positions while the drag is live.
  const dragGroupRef = useRef<{
    groupId: string;
    startGroupX: number; startGroupY: number;
    children: { id: string; startX: number; startY: number }[];
  } | null>(null);

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type !== 'group') return;
    const groupW = node.measured?.width ?? (node.width as number) ?? 0;
    const groupH = node.measured?.height ?? (node.height as number) ?? 0;
    const gx1 = node.position.x, gy1 = node.position.y;
    const gx2 = gx1 + groupW, gy2 = gy1 + groupH;
    const children = nodes
      .filter((n) => n.id !== node.id && n.type !== 'group')
      .filter((n) => {
        const w = n.measured?.width ?? (n.width as number) ?? 0;
        const h = n.measured?.height ?? (n.height as number) ?? 0;
        const cx = n.position.x + w / 2;
        const cy = n.position.y + h / 2;
        return cx >= gx1 && cx <= gx2 && cy >= gy1 && cy <= gy2;
      })
      .map((n) => ({ id: n.id, startX: n.position.x, startY: n.position.y }));
    dragGroupRef.current = { groupId: node.id, startGroupX: gx1, startGroupY: gy1, children };
  }, [nodes]);

  const onNodeDrag = useCallback((_e: React.MouseEvent, node: Node) => {
    const ctx = dragGroupRef.current;
    if (!ctx || ctx.groupId !== node.id || ctx.children.length === 0) return;
    const dx = node.position.x - ctx.startGroupX;
    const dy = node.position.y - ctx.startGroupY;
    if (dx === 0 && dy === 0) return;
    setNodes((nds) => nds.map((n) => {
      const child = ctx.children.find((c) => c.id === n.id);
      if (!child) return n;
      return { ...n, position: { x: child.startX + dx, y: child.startY + dy } };
    }));
  }, [setNodes]);

  const onNodeDragStop = useCallback(() => {
    dragGroupRef.current = null;
  }, []);

  const defaultEdgeOptions = { type: 'flow' };

  const onConnectStart: OnConnectStart = useCallback((_event, { nodeId }) => {
    connectStartFrom.current = nodeId ?? null;
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const target = event.target as HTMLElement | null;
      const hitPane = target?.classList.contains('react-flow__pane');
      if (!hitPane || !connectStartFrom.current) {
        connectStartFrom.current = null;
        return;
      }
      const me = event as MouseEvent;
      const { clientX, clientY } = me;
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      setPending({
        fromNodeId: connectStartFrom.current,
        screenX: clientX,
        screenY: clientY,
        flowX: flow.x,
        flowY: flow.y,
      });
      connectStartFrom.current = null;
    },
    [screenToFlowPosition],
  );

  const dismissPending = () => setPending(null);

  // Cmd+V on the canvas pastes a clipboard image as an upload node.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      for (const item of Array.from(e.clipboardData.items)) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const flow = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          const id = `n${idCounter.current++}`;
          const newNode: Node = {
            id,
            type: 'upload',
            position: { x: flow.x - 120, y: flow.y - 80 },
            data: { label: 'pasted', imageUrl: dataUrl, status: 'done' as NodeStatus },
          };
          setNodes((nds) => [...nds, newNode]);
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [screenToFlowPosition, setNodes]);

  const openConnectMenu = useCallback((fromNodeId: string, screenX: number, screenY: number, side?: 'left' | 'right') => {
    const flow = screenToFlowPosition({ x: screenX, y: screenY });
    setPending({ fromNodeId, screenX, screenY, flowX: flow.x, flowY: flow.y, side });
  }, [screenToFlowPosition]);

  const onPaneContextMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setPending({
      fromNodeId: '',
      screenX: event.clientX,
      screenY: event.clientY,
      flowX: flow.x,
      flowY: flow.y,
    });
  };

  const onPaneDoubleClick = (event: React.MouseEvent | MouseEvent) => {
    onPaneContextMenu(event);
  };

  const createConnectedNode = (type: string, defaultData: Record<string, unknown>) => {
    if (!pending) return;
    const id = `n${idCounter.current++}`;
    const isGroup = type === 'group';

    const GAP = 80;
    const NEW_W = 280;
    const NEW_H = 280;
    const SRC_FALLBACK_H = 280;

    let position: { x: number; y: number };
    if (pending.side && pending.fromNodeId) {
      const src = getNode(pending.fromNodeId);
      if (src) {
        const srcW = (src.measured?.width ?? src.width ?? NEW_W);
        const srcH = (src.measured?.height ?? src.height ?? SRC_FALLBACK_H);
        const yAligned = src.position.y + (srcH - NEW_H) / 2;
        position = pending.side === 'right'
          ? { x: src.position.x + srcW + GAP, y: yAligned }
          : { x: src.position.x - NEW_W - GAP, y: yAligned };
      } else {
        position = { x: pending.flowX - NEW_W / 2, y: pending.flowY - NEW_H / 2 };
      }
    } else {
      position = { x: pending.flowX - NEW_W / 2, y: pending.flowY - NEW_H / 2 };
    }

    const newNode: Node = {
      id,
      type,
      position,
      data: { ...defaultData, label: NODE_CATALOG.find((n) => n.type === type)?.label.toLowerCase() ?? type },
      ...(isGroup ? { width: 360, height: 240, zIndex: -1 } : {}),
    };
    setNodes((nds) => (isGroup ? [newNode, ...nds] : [...nds, newNode]));
    if (pending.fromNodeId && !isGroup) {
      const isLeftSide = pending.side === 'left';
      const src = isLeftSide ? id : pending.fromNodeId;
      const tgt = isLeftSide ? pending.fromNodeId : id;
      const newEdge: Edge = {
        id: `e-${src}-${tgt}`,
        source: src,
        target: tgt,
        sourceHandle: `${src}-out`,
        targetHandle: `${tgt}-in`,
        type: 'flow',
      };
      setEdges((eds) => [...eds, newEdge]);
    }
    setPending(null);
  };

  const addNodeFromDrawer = (entry: NodeCatalogEntry) => {
    const id = `n${idCounter.current++}`;
    const x = 380 + Math.random() * 200;
    const y = 200 + Math.random() * 150;
    const isGroup = entry.type === 'group';
    const newNode: Node = isGroup
      ? { id, type: entry.type, position: { x, y }, data: { ...entry.defaultData }, width: 360, height: 240, zIndex: -1 }
      : { id, type: entry.type, position: { x, y }, data: { ...entry.defaultData } };
    setNodes((nds) => (isGroup ? [newNode, ...nds] : [...nds, newNode]));
  };

  // Drop an image node pre-filled with a library prompt and select it, so the
  // PromptBar binds to it and the user just hits Send (or tweaks first).
  const usePromptFromLibrary = (prompt: string) => {
    const id = `n${idCounter.current++}`;
    const x = 380 + Math.random() * 200;
    const y = 200 + Math.random() * 150;
    const newNode: Node = {
      id,
      type: 'imagegen',
      position: { x, y },
      data: { ...NODE_CATALOG.find((e) => e.type === 'imagegen')?.defaultData, prompt, status: 'idle' as NodeStatus },
      selected: true,
    };
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), newNode]);
  };

  // Normalize a reference image into a downscaled JPEG data: URI for the
  // gateway. References arrive as data: URIs (uploads), relative URLs
  // (/api/generated/… for generated images), or http(s) URLs. The gateway
  // needs a valid absolute URL or data: URI — a relative path fails with
  // "Invalid URL", and a full-size photo can exceed the body limit → 400.
  // So we load EVERY reference into a canvas and re-encode it small. Same-origin
  // (uploads + /api/generated proxied) load cleanly; if a cross-origin image
  // taints the canvas, we fall back to the original URL.
  const shrinkReference = (url?: string, maxDim = 1024, quality = 0.85): Promise<string | undefined> => {
    if (!url) return Promise.resolve(url);
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let { width, height } = img;
        const longest = Math.max(width, height) || maxDim;
        if (longest > maxDim) {
          const s = maxDim / longest;
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(url);
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(c.toDataURL('image/jpeg', quality)); } catch { resolve(url); }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
  };

  const setNodeStatus = (id: string, status: NodeStatus, extra: Record<string, unknown> = {}) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, status, ...extra } } : n)));
  };

  const simulateGen = async (id: string, mode: 'imagegen' | 'videogen' | 'musicgen', prompt: string, referenceUrlOverride?: string) => {
    setNodeStatus(id, 'running', { progress: 0, resultUrl: undefined, errorMessage: undefined });

    const node = nodes.find((n) => n.id === id);
    const d = (node?.data ?? {}) as GenNodeData & {
      mode?: 'standard' | 'pro';
      ratio?: 'adaptive' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | '9:21';
      resolution?: '360p' | '480p' | '540p' | '720p' | '1080p' | '1K' | '2K' | '4K';
      audio?: boolean;
      lyrics?: string;
      lyricsMode?: 'adaptive' | 'custom';
      referenceUrl?: string;
    };

    let cancelled = false;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      if (cancelled) return;
      setNodes((nds) => nds.map((n) => (n.id === id
        ? { ...n, data: { ...n.data, elapsedS: Math.floor((Date.now() - startedAt) / 1000) } }
        : n)));
    }, 1000);
    (async () => {
      for (let p = 0.05; p <= 0.85; p += 0.03) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 350));
        setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, progress: p } } : n)));
      }
    })();

    const rawRef = (mode === 'imagegen' || mode === 'videogen') ? (referenceUrlOverride ?? d.referenceUrl) : undefined;
    // Video seed images especially must be small; shrink before sending.
    const imageUrl = await shrinkReference(rawRef, mode === 'videogen' ? 768 : 1024);

    const kindMap = { imagegen: 'image', videogen: 'video', musicgen: 'music' } as const;
    const result = await generate({
      kind: kindMap[mode],
      prompt,
      model: d.model,
      durationS: mode === 'videogen' || mode === 'musicgen' ? (d.durationS ?? 8) : undefined,
      lyrics: mode === 'musicgen' && d.lyricsMode === 'custom' ? d.lyrics : undefined,
      instrumental: mode === 'musicgen' ? !d.lyrics && d.lyricsMode === 'adaptive' ? false : undefined : undefined,
      imageUrl,
      // Video-only gateway params from the node's settings panel.
      aspectRatio: mode === 'videogen' ? d.ratio : undefined,
      resolution: mode === 'videogen' ? d.resolution : undefined,
      generateAudio: mode === 'videogen' ? d.audio : undefined,
    });
    cancelled = true;
    clearInterval(tick);

    if (result.ok) {
      let finalUrl = result.resultUrl;
      // Cutout post-process: knock near-white background pixels to transparent
      // so the result reads as a real PNG cutout rather than a white-bg image.
      const post = (d as { _postProcess?: string })._postProcess;
      if (post === 'cutout-alpha' && finalUrl) {
        try { finalUrl = await whiteBgToTransparent(finalUrl); } catch { /* keep original */ }
      }
      setNodeStatus(id, 'done', { resultUrl: finalUrl, progress: 1 });
    } else {
      setNodeStatus(id, 'error', {
        progress: 0,
        errorMessage: result.error,
      });
    }
  };

  // Knock near-white pixels of a generated cutout to alpha=0 so the image
  // reads as a transparent PNG. Pure client-side; uses a soft threshold so we
  // don't bite chunks out of bright subjects (eyes, highlights). Same-origin
  // (data: or /api/generated) avoids canvas taint.
  const whiteBgToTransparent = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('no 2d ctx'));
        ctx.drawImage(img, 0, 0);
        let data: ImageData;
        try { data = ctx.getImageData(0, 0, c.width, c.height); }
        catch { return reject(new Error('tainted canvas')); }
        const px = data.data;
        // Threshold band: pure white → fully transparent; lightly off-white →
        // partially transparent (smooths the edge); everything else → kept.
        const HARD = 248, SOFT = 232;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const minC = Math.min(r, g, b);
          if (minC >= HARD) { px[i + 3] = 0; }
          else if (minC >= SOFT) { px[i + 3] = Math.round(((HARD - minC) / (HARD - SOFT)) * 255); }
        }
        ctx.putImageData(data, 0, 0);
        try { resolve(c.toDataURL('image/png')); } catch { reject(new Error('export failed')); }
      };
      img.onerror = () => reject(new Error('load failed'));
      img.src = url;
    });
  };

  const handlePromptSend = (payload: {
    nodeId: string | null;
    mode: 'imagegen' | 'videogen' | 'musicgen';
    prompt: string;
    model: string;
    referenceUrl: string | null;
  }) => {
    const ref = payload.referenceUrl || undefined;
    if (payload.nodeId) {
      const target = nodes.find((n) => n.id === payload.nodeId);
      if (target && target.type === payload.mode) {
        setNodes((nds) => nds.map((n) => (n.id === payload.nodeId
          ? { ...n, data: { ...n.data, prompt: payload.prompt, model: payload.model, referenceUrl: ref, status: 'running', progress: 0 } }
          : n)));
        void simulateGen(payload.nodeId, payload.mode, payload.prompt, ref);
        return;
      }
    }
    const entry = NODE_CATALOG.find((e) => e.type === payload.mode);
    if (!entry) return;
    const id = `n${idCounter.current++}`;
    const x = 380 + Math.random() * 200;
    const y = 200 + Math.random() * 150;
    const newNode: Node = {
      id,
      type: entry.type,
      position: { x, y },
      data: { ...entry.defaultData, prompt: payload.prompt, model: payload.model, referenceUrl: ref, status: 'idle' as NodeStatus },
    };
    setNodes((nds) => [...nds, newNode]);
    void simulateGen(id, payload.mode, payload.prompt, ref);
  };

  // ── Image editor: outpaint / enhance / cutout / upscale ──
  const IMAGE_EDIT_PROMPTS: Record<ImageEditOp, string> = {
    outpaint: 'Outpaint and naturally extend this image beyond its borders on all sides, keeping the existing content, lighting and style seamless.',
    enhance: 'Enhance this image: increase sharpness, detail and clarity, fix artifacts, keep the composition and content unchanged.',
    cutout: 'Cut out the main subject and remove the background entirely. Place the subject on a pure white #FFFFFF background with no shadows. The subject must remain unchanged.',
    pixels: 'Upscale this image to a higher resolution, recovering fine detail and texture without changing the content.',
  };
  const IMAGE_EDIT_SUFFIX: Record<ImageEditOp, string> = {
    outpaint: 'outpaint', enhance: 'enhanced', cutout: 'cutout', pixels: 'upscaled',
  };

  const runImageEdit = useCallback((fromNodeId: string, op: ImageEditOp) => {
    const src = getNode(fromNodeId);
    if (!src) return;
    const sd = src.data as { resultUrl?: string; imageUrl?: string; model?: string; title?: string };
    const sourceImage = sd.resultUrl || sd.imageUrl;
    if (!sourceImage) return;

    const id = `n${idCounter.current++}`;
    const NEW_W = 280, NEW_H = 280, GAP = 80;
    const srcW = (src.measured?.width ?? src.width ?? NEW_W);
    const srcH = (src.measured?.height ?? src.height ?? NEW_H);
    const position = { x: src.position.x + srcW + GAP, y: src.position.y + (srcH - NEW_H) / 2 };

    const newNode: Node = {
      id,
      type: 'imagegen',
      position,
      data: {
        label: 'image',
        title: `${sd.title || 'image'} · ${IMAGE_EDIT_SUFFIX[op]}`,
        model: sd.model || IMAGE_MODELS[0].id,
        prompt: IMAGE_EDIT_PROMPTS[op],
        priceUsd: IMAGE_MODELS.find((m) => m.id === sd.model)?.price ?? IMAGE_MODELS[0].price,
        referenceUrl: sourceImage,
        status: 'idle' as NodeStatus,
        // Cutout post-process: knock the white bg to alpha after generation,
        // so the result lands as a true transparent PNG cutout.
        ...(op === 'cutout' ? { _postProcess: 'cutout-alpha' } : {}),
      } as GenNodeData,
    };
    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => [...eds, {
      id: `e-${fromNodeId}-${id}`,
      source: fromNodeId, target: id,
      sourceHandle: `${fromNodeId}-out`, targetHandle: `${id}-in`,
      type: 'flow',
    }]);
    void simulateGen(id, 'imagegen', IMAGE_EDIT_PROMPTS[op], sourceImage);
  }, [getNode, setNodes, setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Split: crop the source image into a rows×cols grid of upload nodes ──
  const runImageSplit = useCallback((fromNodeId: string, rows: number, cols: number) => {
    const src = getNode(fromNodeId);
    if (!src) return;
    const sd = src.data as { resultUrl?: string; imageUrl?: string; title?: string };
    const sourceImage = sd.resultUrl || sd.imageUrl;
    if (!sourceImage) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tileW = Math.floor(img.naturalWidth / cols);
      const tileH = Math.floor(img.naturalHeight / rows);
      if (tileW === 0 || tileH === 0) return;

      const srcW = (src.measured?.width ?? src.width ?? 280);
      const srcH = (src.measured?.height ?? src.height ?? 280);
      const GAP = 80, CELL = 150, CELL_GAP = 16;
      const baseX = src.position.x + srcW + GAP;
      const baseY = src.position.y + (srcH - (rows * CELL + (rows - 1) * CELL_GAP)) / 2;

      const newNodes: Node[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const canvas = document.createElement('canvas');
          canvas.width = tileW; canvas.height = tileH;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(img, c * tileW, r * tileH, tileW, tileH, 0, 0, tileW, tileH);
          let url: string;
          try { url = canvas.toDataURL('image/png'); }
          catch { return; } // tainted canvas (cross-origin without CORS) — bail
          const id = `n${idCounter.current++}`;
          newNodes.push({
            id,
            type: 'upload',
            position: { x: baseX + c * (CELL + CELL_GAP), y: baseY + r * (CELL + CELL_GAP) },
            data: { label: 'tile', title: `${sd.title || 'image'} ${r * cols + c + 1}`, imageUrl: url, status: 'done' as NodeStatus },
          });
        }
      }
      setNodes((nds) => [...nds, ...newNodes]);
    };
    img.src = sourceImage;
  }, [getNode, setNodes]);

  // ── Annotate: open a modal canvas pre-loaded with the source image; on
  // save, drop a new upload node next to the source carrying the annotated
  // PNG. Pure client-side; no model call.
  const [annotateSrc, setAnnotateSrc] = useState<{ fromNodeId: string; url: string } | null>(null);
  const runAnnotate = useCallback((fromNodeId: string) => {
    const src = getNode(fromNodeId);
    if (!src) return;
    const sd = src.data as { resultUrl?: string; imageUrl?: string };
    const sourceImage = sd.resultUrl || sd.imageUrl;
    if (!sourceImage) return;
    setAnnotateSrc({ fromNodeId, url: sourceImage });
  }, [getNode]);

  const onAnnotateSave = (dataUrl: string) => {
    if (!annotateSrc) return;
    const src = getNode(annotateSrc.fromNodeId);
    if (!src) return;
    const sd = src.data as { title?: string };
    const NEW_W = 280, NEW_H = 280, GAP = 80;
    const srcW = (src.measured?.width ?? src.width ?? NEW_W);
    const srcH = (src.measured?.height ?? src.height ?? NEW_H);
    const id = `n${idCounter.current++}`;
    const newNode: Node = {
      id,
      type: 'upload',
      position: { x: src.position.x + srcW + GAP, y: src.position.y + (srcH - NEW_H) / 2 },
      data: {
        label: 'annotated',
        title: `${sd.title || 'image'} · annotated`,
        imageUrl: dataUrl,
        status: 'done' as NodeStatus,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setEdges((eds) => [...eds, {
      id: `e-${annotateSrc.fromNodeId}-${id}`,
      source: annotateSrc.fromNodeId, target: id,
      sourceHandle: `${annotateSrc.fromNodeId}-out`, targetHandle: `${id}-in`,
      type: 'flow',
    }]);
  };

  return (
    <div className="canvas-host">
      <div className="canvas-toolbar">
        <input
          className="canvas-brand-input"
          value={projectName}
          onChange={(e) => {
            setProjectName(e.target.value);
            renameProject(projectIdRef.current, e.target.value);
          }}
          aria-label="Project name"
          title="Rename project"
          spellCheck={false}
        />
        <div className="canvas-toolbar-divider" aria-hidden />
        {/* Inline node-add bar — grouped by category (Generate / Utility /
           Resource), separated by dividers so the three intents read at a
           glance without bloating width. */}
        <ul className="canvas-add-row" aria-label="Add a node">
          {(['generate', 'utility', 'resource'] as const).flatMap((cat, ci) => {
            const entries = NODE_CATALOG.filter((e) => e.category === cat);
            if (entries.length === 0) return [];
            const sep = ci > 0
              ? [<li key={`sep-${cat}`} className="canvas-add-group-sep" role="separator" aria-hidden />]
              : [];
            return [
              ...sep,
              ...entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <li key={entry.type}>
                    <button
                      type="button"
                      className="canvas-add-btn"
                      onClick={() => addNodeFromDrawer(entry)}
                      title={`${CATEGORY_TITLES[cat]} · ${entry.label} — ${entry.description}`}
                      aria-label={`Add ${entry.label} node`}
                    >
                      <Icon size={15} strokeWidth={1.75} aria-hidden />
                      <span>{entry.label}</span>
                      {entry.beta && <span className="canvas-add-beta">Beta</span>}
                    </button>
                  </li>
                );
              }),
            ];
          })}
        </ul>
        <span className="canvas-toolbar-spacer" />
        <button
          type="button"
          className="canvas-add-btn"
          onClick={() => setPromptLibOpen(true)}
          title="Browse the prompt library"
          aria-label="Open prompt library"
        >
          <Sparkles size={15} strokeWidth={1.75} aria-hidden />
          <span>Prompts</span>
        </button>
      </div>

      <CanvasContext.Provider value={{ openConnectMenu, runImageEdit, runImageSplit, runAnnotate }}>
      <div className="canvas-body">
        <div className={`canvas-flow ${showMinimap ? 'has-minimap' : ''}`} onClick={dismissPending}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onPaneContextMenu={onPaneContextMenu}
          onDoubleClick={onPaneDoubleClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          aria-label="Workflow canvas"
          proOptions={{ hideAttribution: true }}
          panOnScroll
          panOnScrollSpeed={0.8}
          zoomOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode={['Meta', 'Control']}
          panOnDrag
          selectionOnDrag={false}
          selectNodesOnDrag={false}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.2}
          maxZoom={2.5}
        >
          {showDots && <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color={bgDotColor} />}
          {showMinimap && <MiniMap pannable zoomable maskColor={minimapMask} />}
        </ReactFlow>
        <CanvasViewBar />
        <PromptBar onSend={handlePromptSend} />

        {pending && (
          <div
            className="connect-menu"
            style={{ left: pending.screenX, top: pending.screenY }}
            role="menu"
            aria-label="Choose node to create"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="connect-menu-section">Generate content</div>
            {GENERATE_TYPES.map(({ type, label, icon: Icon, defaultData }) => (
              <button
                key={type}
                role="menuitem"
                className="connect-menu-item"
                onClick={() => createConnectedNode(type, defaultData)}
              >
                <span className="connect-menu-icon">
                  <Icon size={14} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="connect-menu-text">
                  <span className="connect-menu-label">{label}</span>
                  <span className="connect-menu-desc">{descriptionFor(type)}</span>
                </span>
              </button>
            ))}
            <div className="connect-menu-section">Utility</div>
            {UTILITY_TYPES.map(({ type, label, icon: Icon, defaultData }) => (
              <button
                key={type}
                role="menuitem"
                className="connect-menu-item"
                onClick={() => createConnectedNode(type, defaultData)}
              >
                <span className="connect-menu-icon">
                  <Icon size={14} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="connect-menu-text">
                  <span className="connect-menu-label">{label}</span>
                  <span className="connect-menu-desc">{descriptionFor(type)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
      </CanvasContext.Provider>
      <PromptLibrary open={promptLibOpen} onClose={() => setPromptLibOpen(false)} onUse={usePromptFromLibrary} />
      <AnnotateModal
        open={!!annotateSrc}
        imageUrl={annotateSrc?.url ?? null}
        onClose={() => setAnnotateSrc(null)}
        onSave={onAnnotateSave}
      />
    </div>
  );
}

function descriptionFor(type: string): string {
  switch (type) {
    case 'text': return 'Generate text from prompts';
    case 'imagegen': return 'Generate image from prompt or reference';
    case 'videogen': return 'Generate video from prompt or reference';
    case 'musicgen': return 'Generate a music track';
    case 'result': return 'Final output preview';
    case 'upload': return 'Upload a reference image';
    case 'timeline': return 'Sequence clips into a cut';
    case 'group': return 'Visually group nodes';
    default: return '';
  }
}

export default function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
