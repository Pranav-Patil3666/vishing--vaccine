import type { PressureTimelinePoint } from "@vaccine/contracts";

/** Canonical array order, one pressure point per learner event. Null latency never becomes zero. */
export function PressureLatencyCurve({ points }: { points: readonly PressureTimelinePoint[] }) {
  if (!points.length) return null;
  const x = (index: number) => points.length === 1 ? 300 : 55 + index * 490 / (points.length - 1);
  const y = (pressure: number) => 185 - pressure * 30;
  const firstCompliance = points.findIndex((point) => point.complianceMoment !== null);
  return <figure className="pressure-curve"><svg viewBox="0 0 600 265" role="img" aria-label="Caller pressure by learner turn, with associated response latency" style={{ width: "100%", color: "var(--text-primary, #eef2f6)" }}>
    {[0, 1, 2, 3, 4, 5].map((level) => <g key={level}><line x1="45" x2="560" y1={y(level)} y2={y(level)} stroke="currentColor" opacity="0.16" /><text x="22" y={y(level) + 4} fill="currentColor" fontSize="11">{level}</text></g>)}
    <text x="45" y="18" fill="currentColor" fontSize="12">Caller pressure (0–5)</text>
    <polyline points={points.map((point, index) => `${x(index)},${y(point.callerPressureLevel)}`).join(" ")} fill="none" stroke="#ff9c62" strokeWidth="3" />
    {points.map((point, index) => <g key={point.turnId} data-turn-id={point.turnId} data-latency-ms={point.responseLatency?.valueMs ?? "unavailable"}>
      <circle data-pressure-point="true" cx={x(index)} cy={y(point.callerPressureLevel)} r="5" fill="#ff9c62"><title>{`Turn ${index + 1}: pressure ${point.callerPressureLevel}; latency ${point.responseLatency ? `${Math.round(point.responseLatency.valueMs)} ms` : "unavailable"}`}</title></circle>
      {index === firstCompliance && <text data-compliance-marker="true" x={x(index)} y={y(point.callerPressureLevel) - 13} textAnchor="middle" fill="#ff9c62" fontSize="11">First dummy disclosure*</text>}
      <text x={x(index)} y="209" textAnchor="middle" fill="currentColor" fontSize="12">Turn {index + 1}</text>
      <text x={x(index)} y="230" textAnchor="middle" fill="currentColor" fontSize="11">{point.responseLatency ? `${Math.round(point.responseLatency.valueMs)} ms` : "Latency unavailable"}</text>
    </g>)}
    <text x="300" y="255" textAnchor="middle" fill="currentColor" fontSize="11">Learner turn · latency measured from preceding caller end</text>
  </svg><figcaption>Session-local measurements. *Disclosure position is segment-level and approximate.</figcaption></figure>;
}
