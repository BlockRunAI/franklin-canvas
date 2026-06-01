// A cute little house-designed mascot for the media agent — a rounded "spark
// bot": a squircle face with friendly eyes, a soft smile, a sparkle antenna,
// and a tiny play triangle on the cheek hinting at video. Uses the brand accent
// gradient so it pops next to the prompt bar.

export default function AgentMascot({ size = 22 }: { size?: number }) {
  const gid = 'agent-mascot-grad';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden role="img">
      <defs>
        <linearGradient id={gid} x1="3" y1="4" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fde047" />
          <stop offset="0.5" stopColor="#a3e635" />
          <stop offset="1" stopColor="#4ade80" />
        </linearGradient>
      </defs>
      {/* antenna + sparkle */}
      <path d="M12 4.4V2.6" stroke={`url(#${gid})`} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 1.2l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1L10.9 2.8l1.1-.5z" fill={`url(#${gid})`} />
      {/* face */}
      <rect x="3.4" y="4.6" width="17.2" height="15" rx="6.2" fill={`url(#${gid})`} opacity="0.16" />
      <rect x="3.4" y="4.6" width="17.2" height="15" rx="6.2" stroke={`url(#${gid})`} strokeWidth="1.6" />
      {/* eyes */}
      <circle cx="9" cy="11" r="1.5" fill={`url(#${gid})`} />
      <circle cx="15" cy="11" r="1.5" fill={`url(#${gid})`} />
      {/* smile */}
      <path d="M9 14.6c.9.9 2 1.4 3 1.4s2.1-.5 3-1.4" stroke={`url(#${gid})`} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* tiny play triangle on the cheek */}
      <path d="M17.4 7.4l1.7 1-1.7 1z" fill={`url(#${gid})`} />
    </svg>
  );
}
