// Lyrics popover for the music node: choose Adaptive (model writes lyrics to
// fit the prompt) or Custom (you provide the lyrics in a textarea).

export type LyricsMode = 'adaptive' | 'custom';

interface Props {
  mode: LyricsMode;
  lyrics: string;
  onChange: (next: { mode: LyricsMode; lyrics: string }) => void;
}

export default function LyricsPanel({ mode, lyrics, onChange }: Props) {
  return (
    <div className="lyrics-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <section className="panel-row">
        <div className="panel-row-title">Lyrics</div>
        <div className="seg">
          {(['adaptive', 'custom'] as LyricsMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`seg-btn ${mode === m ? 'is-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onChange({ mode: m, lyrics }); }}
            >
              {m === 'adaptive' ? 'Adaptive' : 'Custom'}
            </button>
          ))}
        </div>
      </section>
      {mode === 'custom' && (
        <textarea
          className="lyrics-area"
          value={lyrics}
          onChange={(e) => onChange({ mode, lyrics: e.target.value })}
          placeholder="Type your lyrics…"
          rows={4}
          aria-label="Custom lyrics"
        />
      )}
    </div>
  );
}
