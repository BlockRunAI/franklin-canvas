// Custom edge with three selectable styles (set in Settings → Canvas):
//   • animated — a light pulse slides along the path every 2s (lively)
//   • solid    — the same gradient, but static (calm, still on-brand)
//   • subtle   — a thin neutral line (minimal, no gradient)
// The style is read live from the prefs store so toggling re-renders edges.

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { usePrefsStore } from './prefsStore';

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style } = props;
  const edgeStyle = usePrefsStore((s) => s.edgeStyle);

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (edgeStyle === 'subtle') {
    return (
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: 'rgba(255,255,255,0.22)', strokeWidth: 1.5, ...style }}
      />
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
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          {animated ? (
            <>
              <stop offset="0%" stopColor="#65a30d" stopOpacity="0">
                <animate attributeName="offset" values="-0.5;1" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="0%" stopColor="#fde047" stopOpacity="1">
                <animate attributeName="offset" values="-0.3;1.2" dur="2s" repeatCount="indefinite" />
              </stop>
              <stop offset="0%" stopColor="#a3e635" stopOpacity="0">
                <animate attributeName="offset" values="-0.1;1.4" dur="2s" repeatCount="indefinite" />
              </stop>
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#fde047" />
              <stop offset="50%" stopColor="#a3e635" />
              <stop offset="100%" stopColor="#4ade80" />
            </>
          )}
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: `url(#${gradId})`,
          strokeWidth: 2.5,
          strokeOpacity: 0.7,
          ...style,
        }}
      />
    </>
  );
}

export const EDGE_TYPES = {
  flow: FlowEdge,
};
