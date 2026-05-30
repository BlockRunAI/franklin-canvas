// Custom edge with three selectable styles (Settings → Canvas):
//   • animated — a light pulse slides along the path every 2s (lively)
//   • solid    — the same gradient, but static (calm, still on-brand)
//   • subtle   — a thin neutral line (minimal, no gradient)
// Colors track the active theme: lime for dark, gold for gold, petrol for light.

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { usePrefsStore } from './prefsStore';
import { useThemeStore } from './themeStore';

interface Palette { a: string; b: string; c: string; subtle: string; }

const PALETTES: Record<'dark' | 'gold' | 'light', Palette> = {
  dark:  { a: '#fde047', b: '#a3e635', c: '#4ade80', subtle: 'rgba(255,255,255,0.22)' },
  gold:  { a: '#d8be58', b: '#c9a227', c: '#8c6f17', subtle: 'rgba(10,10,10,0.18)' },
  light: { a: '#294450', b: '#1b2d36', c: '#0a141a', subtle: 'rgba(10,10,10,0.22)' },
};

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style } = props;
  const edgeStyle = usePrefsStore((s) => s.edgeStyle);
  const theme = useThemeStore((s) => s.theme);
  const p = PALETTES[theme];

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  if (edgeStyle === 'subtle') {
    return (
      <BaseEdge id={id} path={path} style={{ stroke: p.subtle, strokeWidth: 1.5, ...style }} />
    );
  }

  const gradId = `franklin-edge-gradient-${id}`;
  const animated = edgeStyle === 'animated';

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}
        >
          {animated ? (
            <>
              <stop offset="0%" stopColor={p.c} stopOpacity="0">
                <animate attributeName="offset" values="-0.5;1" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="0%" stopColor={p.a} stopOpacity="1">
                <animate attributeName="offset" values="-0.3;1.2" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="0%" stopColor={p.b} stopOpacity="0">
                <animate attributeName="offset" values="-0.1;1.4" dur="2s" repeatCount="indefinite" />
              </stop>
            </>
          ) : (
            <>
              <stop offset="0%"   stopColor={p.a} />
              <stop offset="50%"  stopColor={p.b} />
              <stop offset="100%" stopColor={p.c} />
            </>
          )}
        </linearGradient>
      </defs>
      <BaseEdge id={id} path={path} style={{ stroke: `url(#${gradId})`, strokeWidth: 2.5, strokeOpacity: 0.75, ...style }} />
    </>
  );
}

export const EDGE_TYPES = { flow: FlowEdge };
