// Video-generation settings popover:
//   生成模式 (Standard/Pro) · 比例 (16:9 / 9:16 / 1:1) ·
//   清晰度 · 生成时长 (3s … 10s)
// A 320px frosted-glass card composed of titled "segmented" rows.

import { useMemo } from 'react';

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type Mode = 'standard' | 'pro';
export type Resolution = '480p' | '720p' | '1080p';

export interface VideoSettings {
  mode: Mode;
  ratio: AspectRatio;
  durationS: number;
  resolution: Resolution;
  audio: boolean;
}

interface Props {
  value: VideoSettings;
  onChange: (next: VideoSettings) => void;
  durations?: number[];
}

const DEFAULT_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10];

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

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  const dim = useMemo(() => {
    if (ratio === '16:9') return { w: 14, h: 7.875 };
    if (ratio === '9:16') return { w: 7.875, h: 14 };
    return { w: 14, h: 14 };
  }, [ratio]);
  return (
    <div className="ratio">
      <div
        className="ratio-box"
        style={{ width: dim.w, height: dim.h }}
      />
      <span className="ratio-label">{ratio}</span>
    </div>
  );
}

export default function VideoSettingsPanel({ value, onChange, durations = DEFAULT_DURATIONS }: Props) {
  return (
    <div className="video-settings-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <section className="panel-row">
        <div className="panel-row-title">Mode</div>
        <Segmented<Mode>
          options={['standard', 'pro']}
          value={value.mode}
          onChange={(v) => onChange({ ...value, mode: v })}
          render={(v) => v === 'standard' ? 'Standard' : 'Pro'}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title">Aspect ratio</div>
        <Segmented<AspectRatio>
          options={['16:9', '9:16', '1:1']}
          value={value.ratio}
          onChange={(v) => onChange({ ...value, ratio: v })}
          render={(v) => <RatioIcon ratio={v} />}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title">Resolution</div>
        <Segmented<Resolution>
          options={['480p', '720p', '1080p']}
          value={value.resolution}
          onChange={(v) => onChange({ ...value, resolution: v })}
        />
      </section>

      <section className="panel-row">
        <div className="panel-row-title panel-row-title-inline">
          <span>Duration</span>
          <span className="panel-row-value">{value.durationS}s</span>
        </div>
        <input
          type="range"
          className="panel-slider"
          min={durations[0]}
          max={durations[durations.length - 1]}
          step={1}
          value={value.durationS}
          onChange={(e) => onChange({ ...value, durationS: Number(e.target.value) })}
          onClick={(e) => e.stopPropagation()}
          aria-label="Duration in seconds"
        />
        <div className="panel-slider-scale">
          <span>{durations[0]}s</span>
          <span>{durations[durations.length - 1]}s</span>
        </div>
      </section>

      <section className="panel-row panel-row-inline">
        <div className="panel-row-title">Audio</div>
        <button
          type="button"
          role="switch"
          aria-checked={value.audio}
          className={`panel-toggle ${value.audio ? 'is-on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange({ ...value, audio: !value.audio }); }}
        >
          <span className="panel-toggle-knob" />
        </button>
      </section>
    </div>
  );
}
