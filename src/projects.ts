// Project store — each "project" is a named canvas (its nodes + edges),
// persisted to localStorage. Replaces the previous single-canvas persistence
// (the old `franklin-canvas:nodes`/`:edges` keys), which is migrated into a
// first project on load so nobody loses their existing work.
//
// Kept dependency-free and synchronous: the canvas reads the current project
// on mount and writes it back (debounced) on change; the Projects view lists,
// creates, renames and deletes. Cross-view coordination is just localStorage
// plus a `current project id` pointer.

import type { Node, Edge } from '@xyflow/react';

export interface Project {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}

const LIST_KEY = 'franklin-canvas:projects';
const CURRENT_KEY = 'franklin-canvas:current-project';
// Legacy single-canvas keys, migrated on first load.
const LEGACY_NODES = 'franklin-canvas:nodes';
const LEGACY_EDGES = 'franklin-canvas:edges';

function uid(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function readList(): Project[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeList(list: Project[]): void {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* ignore quota */ }
}

// ── On-disk mirror ──
// localStorage stays the fast synchronous source for the running app; every
// change is ALSO mirrored to a JSON file via the backend so projects survive a
// cache clear, are portable, and can be inspected/edited outside the browser.
// Fire-and-forget — the app never blocks on it and works offline (localStorage).
function mirrorSave(p: Project): void {
  try {
    fetch('/api/projects/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: p }),
    }).catch(() => {});
  } catch { /* ignore */ }
}
function mirrorDelete(id: string): void {
  try {
    fetch('/api/projects/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

// Hydrate localStorage from the on-disk files at startup. Files win when newer
// (so an external edit or a post-cache-clear recovery shows up); local-only
// projects are kept and pushed to disk (first run seeds the files). Call once
// before the canvas mounts; safe to fail (offline → localStorage only).
export async function hydrateFromFiles(): Promise<void> {
  try {
    const r = await fetch('/api/projects');
    if (!r.ok) return;
    const data = await r.json().catch(() => ({}));
    const fileProjects: Project[] = Array.isArray(data.projects) ? data.projects : [];
    const local = readList();
    if (fileProjects.length === 0) { local.forEach(mirrorSave); return; } // seed disk from localStorage
    const byId = new Map<string, Project>(local.map((p) => [p.id, p]));
    for (const fp of fileProjects) {
      if (!fp || !fp.id) continue;
      const lp = byId.get(fp.id);
      if (!lp || (fp.updatedAt || 0) >= (lp.updatedAt || 0)) byId.set(fp.id, fp);
    }
    // Push any local-only projects (not yet on disk) to disk.
    const fileIds = new Set(fileProjects.map((p) => p && p.id));
    local.forEach((p) => { if (!fileIds.has(p.id)) mirrorSave(p); });
    writeList([...byId.values()]);
  } catch { /* offline / backend down → localStorage only */ }
}

// One-time migration: if the old single-canvas keys exist and no projects do,
// fold them into a starter project so a returning user keeps their canvas.
function migrateLegacy(): Project[] {
  const list = readList();
  if (list.length > 0) return list;
  let nodes: Node[] = [];
  let edges: Edge[] = [];
  try {
    const n = localStorage.getItem(LEGACY_NODES);
    const e = localStorage.getItem(LEGACY_EDGES);
    if (n) nodes = JSON.parse(n);
    if (e) edges = JSON.parse(e);
  } catch { /* ignore */ }
  if (nodes.length === 0 && edges.length === 0) return [];
  const now = Date.now();
  const p: Project = { id: uid(), name: 'My first project', nodes, edges, createdAt: now, updatedAt: now };
  writeList([p]);
  localStorage.setItem(CURRENT_KEY, p.id);
  try { localStorage.removeItem(LEGACY_NODES); localStorage.removeItem(LEGACY_EDGES); } catch { /* ignore */ }
  return [p];
}

export function listProjects(): Project[] {
  const list = migrateLegacy();
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCurrentId(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentId(id: string): void {
  try { localStorage.setItem(CURRENT_KEY, id); } catch { /* ignore */ }
}

export function getProject(id: string): Project | null {
  return readList().find((p) => p.id === id) ?? null;
}

/** Resolve the current project, creating an empty one if none exists yet. */
export function getOrCreateCurrent(seed?: { nodes: Node[]; edges: Edge[] }): Project {
  migrateLegacy();
  const id = getCurrentId();
  if (id) {
    const p = getProject(id);
    if (p) return p;
  }
  const list = readList();
  if (list.length > 0) {
    const newest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    setCurrentId(newest.id);
    return newest;
  }
  return createProject('Untitled project', seed);
}

export function createProject(name = 'Untitled project', seed?: { nodes: Node[]; edges: Edge[] }): Project {
  const now = Date.now();
  const p: Project = {
    id: uid(),
    name,
    nodes: seed?.nodes ?? [],
    edges: seed?.edges ?? [],
    createdAt: now,
    updatedAt: now,
  };
  writeList([p, ...readList()]);
  setCurrentId(p.id);
  mirrorSave(p);
  return p;
}

export function renameProject(id: string, name: string): void {
  let updated: Project | undefined;
  writeList(readList().map((p) => (p.id === id ? (updated = { ...p, name, updatedAt: Date.now() }) : p)));
  if (updated) mirrorSave(updated);
}

export function deleteProject(id: string): void {
  const next = readList().filter((p) => p.id !== id);
  writeList(next);
  mirrorDelete(id);
  if (getCurrentId() === id) {
    if (next.length > 0) setCurrentId([...next].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    else localStorage.removeItem(CURRENT_KEY);
  }
}

/** Persist canvas content into a project. Called debounced by the canvas. */
export function saveProjectCanvas(id: string, nodes: Node[], edges: Edge[]): void {
  let updated: Project | undefined;
  writeList(readList().map((p) => (p.id === id ? (updated = { ...p, nodes, edges, updatedAt: Date.now() }) : p)));
  if (updated) mirrorSave(updated);
}
