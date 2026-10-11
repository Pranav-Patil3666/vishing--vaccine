export function PressureScale({ level, max = 5, label = "Pressure" }: { level: number; max?: number; label?: string }) {
  const safeMax = Math.max(0, Math.min(5, Math.floor(max)));
  const bounded = Math.max(0, Math.min(Math.floor(level), safeMax));
  return <div className="pressure-scale" aria-label={`${label}: level ${bounded} of ${safeMax}`}>
    <div className="pressure-dots" aria-hidden="true">{Array.from({ length: safeMax }, (_, index) => <i key={index} className={index < bounded ? "pressure-active" : ""} />)}</div>
    <span className="pressure-value">LEVEL {bounded}<em> / {safeMax}</em></span>
  </div>;
}
