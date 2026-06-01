// Image-generation settings popover: aspect ratio + quality. The gateway maps
// the ratio to an output size and supports a standard/hd quality flag. Reuses
// the same frosted-card / segmented styles as the video settings panel.

export type ImageRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageQuality = 'standard' | 'hd';

export interface ImageSettings {
  ratio: ImageRatio;
  quality: ImageQuality;
}

interface Props {
  value: ImageSettings;
  onChange: (next: ImageSettings) => void;
}

const RATIOS: ImageRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

function RatioIcon({ ratio }: { ratio: ImageRatio }) {
  const [rw, rh] = ratio.split(':').map(Number);
  const max = 14;
  const w = rw >= rh ? max : (max * rw) / rh;
  const h = rh >= rw ? max : (max * rh) / rw;
  return (
    <div className="ratio">
      <div className="ratio-box" style={{ width: w, height: h }} />
      <span className="ratio-label">{ratio}</span>
    </div>
  );
}

function Segmented<T extends string>({ options, value, onChange, render }: {
  options: T[]; value: T; onChange: (v: T) => void; render?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="seg">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`seg-btn ${opt === value ? 'is-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(opt); }}
        >
          {render ? render(opt) : opt}
        </button>
      ))}
    </div>
  );
}

export default function ImageSettingsPanel({ value, onChange }: Props) {
  return (
    <div className="video-settings-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <section className="panel-row">
        <div className="panel-row-title">Aspect ratio</div>
        <Segmented<ImageRatio>
          options={RATIOS}
          value={value.ratio}
          onChange={(v) => onChange({ ...value, ratio: v })}
          render={(v) => <RatioIcon ratio={v} />}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title">Quality</div>
        <Segmented<ImageQuality>
          options={['standard', 'hd']}
          value={value.quality}
          onChange={(v) => onChange({ ...value, quality: v })}
          render={(v) => (v === 'standard' ? 'Standard' : 'HD')}
        />
      </section>
    </div>
  );
}
