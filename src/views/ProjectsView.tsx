// Projects board — replaces the old chat "History" view. Lists every saved
// canvas project (from src/projects.ts), each a named {nodes, edges} snapshot.
// New / Open / Rename / Delete. Opening sets the current project and jumps to
// the canvas (which loads it on mount).

import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Image as ImageIcon, Film, Music, LayoutGrid, ArrowLeft } from 'lucide-react';
import {
  listProjects, createProject, deleteProject, renameProject, setCurrentId,
  type Project,
} from '../projects';

interface Props {
  onOpenCanvas: () => void;
}

// Pick a cover image for a project card: the first image/video result on the
// canvas, else null (we render a placeholder).
function coverFor(p: Project): { url?: string; counts: { image: number; video: number; music: number } } {
  let url: string | undefined;
  const counts = { image: 0, video: 0, music: 0 };
  for (const n of p.nodes) {
    const d = n.data as { resultUrl?: string; imageUrl?: string };
    if (n.type === 'imagegen' || n.type === 'upload') {
      counts.image++;
      if (!url) url = d.resultUrl || d.imageUrl;
    } else if (n.type === 'videogen') {
      counts.video++;
      if (!url) url = d.resultUrl;
    } else if (n.type === 'musicgen') {
      counts.music++;
    }
  }
  return { url, counts };
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export default function ProjectsView({ onOpenCanvas }: Props) {
  const [projects, setProjects] = useState<Project[]>(() => listProjects());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const refresh = () => setProjects(listProjects());

  const open = (id: string) => { setCurrentId(id); onOpenCanvas(); };

  const newProject = () => {
    createProject(`Project ${projects.length + 1}`);
    onOpenCanvas();
  };

  const startRename = (p: Project) => { setEditingId(p.id); setDraftName(p.name); };
  const commitRename = () => {
    if (editingId && draftName.trim()) renameProject(editingId, draftName.trim());
    setEditingId(null);
    refresh();
  };

  const remove = (p: Project) => {
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    deleteProject(p.id);
    refresh();
  };

  // ESC anywhere on this view bounces back to the canvas — the toolbar's
  // Projects button is the only entry point, so a clear exit is essential.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      onOpenCanvas();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenCanvas]);

  return (
    <div className="projects-host">
      <header className="projects-head">
        <button
          type="button"
          className="projects-back"
          onClick={onOpenCanvas}
          aria-label="Back to canvas"
          title="Back to canvas (Esc)"
        >
          <ArrowLeft size={16} aria-hidden /> Back to canvas
        </button>
        <div className="projects-head-text">
          <h1>Projects</h1>
          <p>Each project is its own canvas. Open one to keep working, or start fresh.</p>
        </div>
        <button className="btn-primary projects-new" onClick={newProject}>
          <Plus size={16} aria-hidden /> New project
        </button>
      </header>

      {projects.length === 0 ? (
        <div className="projects-empty">
          <LayoutGrid size={28} strokeWidth={1.4} aria-hidden />
          <p>No projects yet.</p>
          <button className="btn-primary" onClick={newProject}><Plus size={16} aria-hidden /> Create your first project</button>
        </div>
      ) : (
        <ul className="projects-grid">
          {projects.map((p) => {
            const { url, counts } = coverFor(p);
            return (
              <li key={p.id} className="project-card">
                <button className="project-cover" onClick={() => open(p.id)} aria-label={`Open ${p.name}`}>
                  {url ? <img src={url} alt="" /> : <div className="project-cover-empty"><LayoutGrid size={24} strokeWidth={1.3} aria-hidden /></div>}
                </button>
                <div className="project-meta">
                  {editingId === p.id ? (
                    <input
                      className="project-rename"
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                    />
                  ) : (
                    <button className="project-name" onClick={() => open(p.id)} title={p.name}>{p.name}</button>
                  )}
                  <div className="project-sub">
                    <span>{relTime(p.updatedAt)}</span>
                    <span className="project-counts">
                      {counts.image > 0 && <span><ImageIcon size={11} aria-hidden /> {counts.image}</span>}
                      {counts.video > 0 && <span><Film size={11} aria-hidden /> {counts.video}</span>}
                      {counts.music > 0 && <span><Music size={11} aria-hidden /> {counts.music}</span>}
                    </span>
                  </div>
                </div>
                <div className="project-actions">
                  <button onClick={() => startRename(p)} aria-label="Rename" title="Rename"><Pencil size={13} aria-hidden /></button>
                  <button onClick={() => remove(p)} aria-label="Delete" title="Delete"><Trash2 size={13} aria-hidden /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
