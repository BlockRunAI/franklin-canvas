// Image-generation settings popover:
//   Size (aspect/output resolution) · Quality (standard/hd) · N (how many)
// Mirrors VideoSettingsPanel's segmented-card pattern so the two feel like
// siblings. Backend forwards these to the BlockRun gateway ImageClient.

export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | '1024x1792' | '1792x1024';
export type ImageQuality = 'standard' | 'hd';

export interface ImageSettings {
  size: ImageSize;
  quality: ImageQuality;
}

interface Props {
  value: ImageSettings;
  onChange: (next: ImageSettings) => void;
  /** When the active model doesn't support quality (e.g. nano-banana), hide
   *  the row instead of pretending it does anything. */
  showQuality?: boolean;
}

function Segmented<T extends string | number>({
  options, value, onChange, render,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          className={`seg-btn ${opt === value ? 'is-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(opt); }}
        >
          {render ? render(opt) : String(opt)}
        </button>
      ))}
    </div>
  );
}

// Tiny preview box that mirrors the chosen aspect — same visual idea as
// VideoSettingsPanel.RatioIcon, but driven by the parsed WxH string.
function SizeIcon({ size }: { size: ImageSize }) {
  const [w, h] = size.split('x').map(Number);
  const longest = Math.max(w, h);
  const SCALE = 16 / longest;
  const bw = Math.round(w * SCALE);
  const bh = Math.round(h * SCALE);
  const labelMap: Record<ImageSize, string> = {
    '1024x1024': '1:1',
    '1024x1536': '2:3',
    '1536x1024': '3:2',
    '1024x1792': '9:16',
    '1792x1024': '16:9',
  };
  return (
    <div className="ratio">
      <div className="ratio-box" style={{ width: bw, height: bh }} />
      <span className="ratio-label">{labelMap[size] ?? size}</span>
    </div>
  );
}

export default function ImageSettingsPanel({ value, onChange, showQuality = true }: Props) {
  return (
    <div className="video-settings-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <section className="panel-row">
        <div className="panel-row-title">Size</div>
        <Segmented<ImageSize>
          options={['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792']}
          value={value.size}
          onChange={(v) => onChange({ ...value, size: v })}
          render={(v) => <SizeIcon size={v} />}
        />
      </section>

      {showQuality && (
        <section className="panel-row">
          <div className="panel-row-title">Quality</div>
          <Segmented<ImageQuality>
            options={['standard', 'hd']}
            value={value.quality}
            onChange={(v) => onChange({ ...value, quality: v })}
            render={(v) => v === 'hd' ? 'HD' : 'Standard'}
          />
        </section>
      )}
    </div>
  );
}
