// Comparison — give one prompt, run it through several video models at once,
// then watch them side-by-side in a synchronized grid and stitch the results
// into a single labeled comparison MP4 (server-side ffmpeg).
//
// Each model call is a real x402 USDC video generation, so the composer shows
// the total cost and asks for confirmation before spending.

import { useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Loader2, Film, Download, Wand2, X, Check, AlertTriangle, Sparkles, LayoutGrid, RectangleHorizontal, RectangleVertical, RefreshCw, Save, FolderOpen, Trash2 } from 'lucide-react';
import { VIDEO_MODELS } from '../canvas/nodes';
import { generate, stitchComparison, type StitchItem, type StitchMode, type StitchOrientation } from '../api/franklin';
import { useComparisonsStore } from '../comparisonsStore';
import PromptLibrary from '../canvas/PromptLibrary';

type JobStatus = 'idle' | 'running' | 'done' | 'error';
interface Job { model: string; label: string; status: JobStatus; resultUrl?: string; error?: string; elapsedS: number }

const DURATIONS = [3, 5, 8, 10];
const DEFAULT_MODELS = VIDEO_MODELS.slice(0, 4).map((m) => m.id);

// Draw a model label to a small transparent PNG (proper fonts via the browser),
// passed to the backend so ffmpeg can burn it onto each grid cell.
function renderLabelPng(text: string): string {
  // A light, subtle watermark badge — faint pill + slightly translucent text.
  const fontSize = 19, padX = 11, padY = 7;
  const font = `600 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + padX * 2;
  const h = fontSize + padY * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.font = font;
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(10,10,12,0.30)';
  if (c.roundRect) { c.beginPath(); c.roundRect(0, 0, w, h, 8); c.fill(); }
  else c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,0.82)';
  c.fillText(text, padX, h / 2 + 1);
  return canvas.toDataURL('image/png');
}

export default function ComparisonView() {
  const [prompt, setPrompt] = useState('');
  const [libOpen, setLibOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(DEFAULT_MODELS);
  const [durationS, setDurationS] = useState(5);
  const [confirming, setConfirming] = useState(false);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [running, setRunning] = useState(false);

  const [combinedUrl, setCombinedUrl] = useState<string | null>(null);
  const [stitching, setStitching] = useState(false);
  const [orientation, setOrientation] = useState<StitchOrientation>('landscape');
  const [stitchErr, setStitchErr] = useState<string | null>(null);

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const abortRefs = useRef<(AbortController | null)[]>([]);
  const [playing, setPlaying] = useState(false);

  // Give up waiting on a too-slow tile (aborts the client request; the model
  // may still finish upstream, but you stop waiting and can regenerate).
  const cancel = (i: number) => abortRefs.current[i]?.abort();

  const toggleModel = (id: string) => {
    setSelected((s) => {
      if (s.includes(id)) return s.length > 2 ? s.filter((x) => x !== id) : s; // keep ≥2
      return s.length < 5 ? [...s, id] : s; // cap at 5
    });
  };

  const totalCost = useMemo(
    () => selected.reduce((sum, id) => {
      const m = VIDEO_MODELS.find((v) => v.id === id);
      return sum + (m ? m.pricePerS * durationS : 0);
    }, 0),
    [selected, durationS],
  );

  const canGenerate = prompt.trim().length > 0 && selected.length >= 2 && !running;

  const start = async () => {
    setConfirming(false);
    setCombinedUrl(null);
    setStitchErr(null);
    const init: Job[] = selected.map((id) => ({
      model: id,
      label: VIDEO_MODELS.find((m) => m.id === id)?.label ?? id,
      status: 'running',
      elapsedS: 0,
    }));
    setJobs(init);
    setRunning(true);

    // tick elapsed timers for running jobs
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setJobs((js) => js && js.map((j) => (j.status === 'running' ? { ...j, elapsedS: Math.floor((Date.now() - startedAt) / 1000) } : j)));
    }, 1000);

    abortRefs.current = selected.map(() => new AbortController());
    await Promise.all(
      selected.map(async (id, i) => {
        const res = await generate({
          kind: 'video',
          prompt: prompt.trim(),
          model: id,
          durationS,
          aspectRatio: '16:9',
          resolution: '720p',
          generateAudio: true,
        }, abortRefs.current[i]?.signal);
        setJobs((js) => {
          if (!js) return js;
          const next = [...js];
          next[i] = res.ok
            ? { ...next[i], status: 'done', resultUrl: res.resultUrl }
            : { ...next[i], status: 'error', error: res.error };
          return next;
        });
      }),
    );
    clearInterval(timer);
    setRunning(false);
  };

  // Re-run a single model's video (e.g. to redo one that came out silent or bad).
  const regenerate = async (i: number) => {
    const job = jobs?.[i];
    if (!job || !prompt.trim()) return;
    setCombinedUrl(null);
    setJobs((js) => js && js.map((j, idx) => (idx === i ? { ...j, status: 'running', elapsedS: 0, resultUrl: undefined, error: undefined } : j)));
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setJobs((js) => js && js.map((j, idx) => (idx === i && j.status === 'running' ? { ...j, elapsedS: Math.floor((Date.now() - startedAt) / 1000) } : j)));
    }, 1000);
    abortRefs.current[i] = new AbortController();
    const res = await generate({
      kind: 'video', prompt: prompt.trim(), model: job.model, durationS,
      aspectRatio: '16:9', resolution: '720p', generateAudio: true,
    }, abortRefs.current[i]?.signal);
    clearInterval(timer);
    setJobs((js) => js && js.map((j, idx) => (idx === i
      ? (res.ok ? { ...j, status: 'done', resultUrl: res.resultUrl } : { ...j, status: 'error', error: res.error })
      : j)));
  };

  // Save / reload the whole comparison (prompt + result videos + stitched clip)
  // so you can reopen it later exactly as it was, in this view.
  const savedItems = useComparisonsStore((s) => s.items);
  const saveComparison = useComparisonsStore((s) => s.save);
  const removeComparison = useComparisonsStore((s) => s.remove);
  const [savedOpen, setSavedOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const onSave = () => {
    const done = jobs?.filter((j) => j.status === 'done' && j.resultUrl) ?? [];
    if (done.length === 0) return;
    saveComparison({
      name: prompt.trim().slice(0, 48) || 'Untitled comparison',
      prompt: prompt.trim(),
      durationS,
      orientation,
      jobs: done.map((j) => ({ model: j.model, label: j.label, resultUrl: j.resultUrl! })),
      combinedUrl: combinedUrl ?? undefined,
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  };

  const loadComparison = (id: string) => {
    const c = savedItems.find((x) => x.id === id);
    if (!c) return;
    setPrompt(c.prompt);
    setSelected(c.jobs.map((j) => j.model));
    setDurationS(c.durationS);
    setOrientation(c.orientation);
    setJobs(c.jobs.map((j) => ({ model: j.model, label: j.label, status: 'done' as JobStatus, resultUrl: j.resultUrl, elapsedS: 0 })));
    setCombinedUrl(c.combinedUrl ?? null);
    setSavedOpen(false);
  };

  // ── synced grid playback ──
  const doneJobs = jobs?.filter((j) => j.status === 'done' && j.resultUrl) ?? [];
  const playAll = () => { videoRefs.current.forEach((v) => v && v.play().catch(() => {})); setPlaying(true); };
  const pauseAll = () => { videoRefs.current.forEach((v) => v?.pause()); setPlaying(false); };
  const restartAll = () => { videoRefs.current.forEach((v) => { if (v) v.currentTime = 0; }); playAll(); };

  const stitch = async (mode: StitchMode) => {
    setStitching(true);
    setStitchErr(null);
    setCombinedUrl(null);
    const items: StitchItem[] = doneJobs.map((j) => ({
      url: j.resultUrl!,
      label: j.label,
      labelPng: renderLabelPng(j.label),
    }));
    const res = await stitchComparison(items, mode, orientation);
    if (res.ok) setCombinedUrl(res.resultUrl);
    else setStitchErr(res.error);
    setStitching(false);
  };

  // Columns follow the TOTAL number of tiles (not how many have finished), so
  // the grid is compact from the start instead of one giant full-width tile
  // while everything is still generating.
  const tileCount = jobs?.length ?? 0;
  const gridCols = tileCount <= 1 ? 1 : tileCount === 3 ? 3 : 2;

  return (
    <div className="cmp-view">
      <div className="cmp-inner">
        <header className="cmp-head">
          <div className="cmp-head-text">
            <h1>Model Comparison</h1>
            <p>Run one prompt through several video models at once, watch them side-by-side, then stitch them into a single comparison clip.</p>
          </div>
          <div className="cmp-head-actions">
            {savedItems.length > 0 && (
              <div className="cmp-saved-wrap">
                <button type="button" className="cmp-lib-btn" onClick={() => setSavedOpen((v) => !v)} title="Open a saved comparison" aria-expanded={savedOpen}>
                  <FolderOpen size={15} strokeWidth={1.75} aria-hidden />
                  <span>Saved · {savedItems.length}</span>
                </button>
                {savedOpen && (
                  <>
                    <div className="cmp-saved-backdrop" onClick={() => setSavedOpen(false)} />
                    <div className="cmp-saved-menu" role="menu">
                      {savedItems.map((c) => (
                        <div key={c.id} className="cmp-saved-item">
                          <button type="button" className="cmp-saved-load" onClick={() => loadComparison(c.id)}>
                            <span className="cmp-saved-name">{c.name}</span>
                            <span className="cmp-saved-meta">{c.jobs.length} models{c.combinedUrl ? ' · stitched' : ''}</span>
                          </button>
                          <button type="button" className="cmp-saved-del" onClick={() => removeComparison(c.id)} aria-label="Delete saved comparison"><Trash2 size={13} aria-hidden /></button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <button type="button" className="cmp-lib-btn" onClick={() => setLibOpen(true)} title="Browse the prompt library">
              <Sparkles size={15} strokeWidth={1.75} aria-hidden />
              <span>Prompt library</span>
            </button>
          </div>
        </header>

        {/* ── Composer ── */}
        <section className="cmp-composer">
          <textarea
            className="cmp-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the video to generate across every model…"
            rows={3}
            aria-label="Comparison prompt"
          />

          <div className="cmp-models">
            <div className="cmp-models-label">Models <span className="cmp-models-count">{selected.length} selected · 2–5</span></div>
            <div className="cmp-model-chips">
              {VIDEO_MODELS.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`cmp-chip ${on ? 'is-on' : ''}`}
                    onClick={() => toggleModel(m.id)}
                  >
                    {on && <Check size={13} aria-hidden />}
                    <span>{m.label}</span>
                    <span className="cmp-chip-price">${(m.pricePerS * durationS).toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="cmp-controls-row">
            <div className="cmp-duration">
              <span className="cmp-duration-label">Duration</span>
              <div className="cmp-duration-seg">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" className={`cmp-seg-btn ${d === durationS ? 'is-active' : ''}`} onClick={() => setDurationS(d)}>{d}s</button>
                ))}
              </div>
            </div>
            <div className="cmp-generate">
              <div className="cmp-cost">
                <span className="cmp-cost-num">${totalCost.toFixed(2)}</span>
                <span className="cmp-cost-unit">total · {selected.length} model{selected.length === 1 ? '' : 's'}</span>
              </div>
              <button type="button" className="cmp-generate-btn" disabled={!canGenerate} onClick={() => setConfirming(true)}>
                {running ? <><Loader2 size={15} className="cmp-spin" aria-hidden /> Generating…</> : <><Wand2 size={15} aria-hidden /> Generate comparison</>}
              </button>
            </div>
          </div>
        </section>

        {/* ── Results grid ── */}
        {jobs && (
          <section className="cmp-results">
            <div className="cmp-results-head">
              <div className="cmp-results-title">
                <Film size={15} aria-hidden /> Results
                <span className="cmp-results-sub">{doneJobs.length}/{jobs.length} ready</span>
              </div>
              <div className="cmp-results-actions">
                {doneJobs.length >= 2 && (
                  <div className="cmp-sync-controls">
                    <button type="button" className="cmp-sync-btn" onClick={playing ? pauseAll : playAll} title={playing ? 'Pause all' : 'Play all'}>
                      {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
                    </button>
                    <button type="button" className="cmp-sync-btn" onClick={restartAll} title="Restart all">
                      <RotateCcw size={15} aria-hidden />
                    </button>
                  </div>
                )}
                {doneJobs.length >= 1 && (
                  <button type="button" className="cmp-save-btn" onClick={onSave} title="Save this comparison to reopen later">
                    {justSaved ? <><Check size={15} aria-hidden /> Saved</> : <><Save size={15} aria-hidden /> Save comparison</>}
                  </button>
                )}
              </div>
            </div>

            <ul className={`cmp-grid cmp-grid-cols-${gridCols}`}>
              {jobs.map((j, i) => (
                <li key={j.model} className="cmp-tile">
                  <div className="cmp-tile-media">
                    {j.status === 'done' && j.resultUrl ? (
                      <video
                        ref={(el) => { videoRefs.current[i] = el; }}
                        src={j.resultUrl}
                        muted
                        playsInline
                        controls
                        preload="metadata"
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                      />
                    ) : j.status === 'error' ? (
                      <div className="cmp-tile-state cmp-tile-error">
                        <AlertTriangle size={20} aria-hidden />
                        <span>{j.error || 'Failed'}</span>
                      </div>
                    ) : (
                      <div className="cmp-tile-state">
                        <Loader2 size={22} className="cmp-spin" aria-hidden />
                        <span>Generating… {j.elapsedS >= 60 ? `${Math.floor(j.elapsedS / 60)}m ${j.elapsedS % 60}s` : `${j.elapsedS}s`}</span>
                        <span className="cmp-tile-hint">usually 1–6 min · Seedance can run longer</span>
                        <button type="button" className="cmp-tile-stop" onClick={() => cancel(i)}>
                          <X size={13} aria-hidden /> Stop
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="cmp-tile-label">
                    <span className="cmp-tile-name">{j.label}</span>
                    {j.status !== 'running' && (
                      <button
                        type="button"
                        className="cmp-tile-regen"
                        onClick={() => regenerate(i)}
                        disabled={!prompt.trim()}
                        title="Regenerate this model"
                        aria-label={`Regenerate ${j.label}`}
                      >
                        <RefreshCw size={13} aria-hidden /> Regenerate
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* ── Stitch ── */}
            {doneJobs.length >= 2 && (
              <div className="cmp-stitch">
                <div className="cmp-orient">
                  <span className="cmp-orient-label">Layout</span>
                  <div className="cmp-orient-seg">
                    <button type="button" className={`cmp-seg-btn ${orientation === 'landscape' ? 'is-active' : ''}`} onClick={() => setOrientation('landscape')}>
                      <RectangleHorizontal size={14} aria-hidden /> Landscape
                    </button>
                    <button type="button" className={`cmp-seg-btn ${orientation === 'portrait' ? 'is-active' : ''}`} onClick={() => setOrientation('portrait')}>
                      <RectangleVertical size={14} aria-hidden /> Portrait · TikTok
                    </button>
                  </div>
                </div>
                <div className="cmp-stitch-buttons">
                  <button type="button" className="cmp-stitch-btn" onClick={() => stitch('grid')} disabled={stitching}>
                    {stitching ? <Loader2 size={15} className="cmp-spin" aria-hidden /> : <LayoutGrid size={15} aria-hidden />}
                    <span>{orientation === 'portrait' ? 'Stack · all play together' : 'Grid · all play together'}</span>
                  </button>
                  <button type="button" className="cmp-stitch-btn" onClick={() => stitch('sequence')} disabled={stitching}>
                    {stitching ? <Loader2 size={15} className="cmp-spin" aria-hidden /> : <Film size={15} aria-hidden />}
                    <span>Sequence · one at a time</span>
                  </button>
                </div>
                {combinedUrl && (
                  <div className="cmp-combined">
                    <div className="cmp-combined-head">
                      <span>Combined comparison</span>
                      <a className="cmp-download" href={combinedUrl} download="comparison.mp4"><Download size={14} aria-hidden /> Download</a>
                    </div>
                    <video src={combinedUrl} controls autoPlay loop muted className="cmp-combined-video" />
                  </div>
                )}
                {stitchErr && <div className="cmp-stitch-err">{stitchErr}</div>}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Cost confirm ── */}
      {confirming && (
        <div className="cmp-confirm-overlay" onClick={() => setConfirming(false)}>
          <div className="cmp-confirm" onClick={(e) => e.stopPropagation()}>
            <header className="cmp-confirm-head">
              <h2>Confirm comparison</h2>
              <button className="cmp-confirm-x" onClick={() => setConfirming(false)} aria-label="Cancel"><X size={18} aria-hidden /></button>
            </header>
            <p className="cmp-confirm-blurb">This runs your prompt through {selected.length} video models at {durationS}s each — real USDC, charged per model.</p>
            <ul className="cmp-confirm-list">
              {selected.map((id) => {
                const m = VIDEO_MODELS.find((v) => v.id === id);
                return (
                  <li key={id}><span>{m?.label ?? id}</span><span>${((m?.pricePerS ?? 0) * durationS).toFixed(2)}</span></li>
                );
              })}
            </ul>
            <div className="cmp-confirm-total"><span>Total</span><span>${totalCost.toFixed(2)}</span></div>
            <div className="cmp-confirm-actions">
              <button className="cmp-confirm-cancel" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="cmp-confirm-go" onClick={start}>Generate · ${totalCost.toFixed(2)}</button>
            </div>
          </div>
        </div>
      )}

      <PromptLibrary
        open={libOpen}
        onClose={() => setLibOpen(false)}
        onUse={(p) => { setPrompt(p); setLibOpen(false); }}
      />
    </div>
  );
}
