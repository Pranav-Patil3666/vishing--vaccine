import { AlertTriangle, ArrowDownRight, CheckCircle2, Clock3, Radio, ShieldCheck } from "lucide-react";
import type { PressureTimelinePoint } from "@vaccine/contracts";
import { PressureScale } from "./PressureScale.js";

export function PressureTimeline({ points, compact = false }: { points: readonly PressureTimelinePoint[]; compact?: boolean }) {
  if (!points.length) return <div className="empty-timeline"><Radio size={19} /><span>No call events yet.</span><small>Session measurements appear here after a learner response.</small></div>;
  return <ol className={`pressure-timeline ${compact ? "timeline-compact" : ""}`}>
    {points.map((point, index) => {
      const behavior = point.learnerBehavior.label;
      const verified = behavior === "VERIFIED_INDEPENDENTLY";
      const disclosed = behavior === "DISCLOSED_DUMMY_SECRET";
      return <li className="timeline-row" key={point.turnId} style={{ "--row-index": index } as React.CSSProperties}>
        <div className={`timeline-node ${verified ? "node-safe" : disclosed ? "node-risk" : ""}`} aria-hidden="true">{verified ? <ShieldCheck size={15} /> : disclosed ? <AlertTriangle size={15} /> : <span>{String(index + 1).padStart(2, "0")}</span>}</div>
        <article className="timeline-card">
          <div className="timeline-head"><div><span className="mono-eyebrow">TURN {String(index + 1).padStart(2, "0")}</span><span className="timeline-event-label">{point.callerTacticId ? point.callerTacticId.replaceAll("_", " ") : "SAFE FALLBACK"}</span></div><PressureScale level={point.callerPressureLevel} /></div>
          <div className="timeline-facts">
            <div><span>LEARNER BEHAVIOR</span><strong className={`behavior-text ${verified ? "text-safe" : disclosed ? "text-risk" : ""}`}>{behavior.replaceAll("_", " ")}</strong></div>
            <div><span>RESPONSE LATENCY</span><strong>{point.responseLatency ? <>{point.responseLatency.valueMs.toFixed(0)} <small>ms</small></> : <em>Not captured</em>}</strong></div>
            <div><span>INTERRUPTION</span><strong>{point.interruptedCaller === "detected" ? "Detected" : point.interruptedCaller === "not_detected" ? "None" : "Unknown"}</strong></div>
          </div>
          <div className="timeline-foot">
            <span>{point.policyDecisionCode.replaceAll("_", " ")}</span>
            {point.complianceMoment && <span className="compliance-flag"><AlertTriangle size={13} /> Dummy-secret moment · segment {point.complianceMoment.segmentIndex} · approximate</span>}
            {point.interruptedCaller === "detected" && point.interruptionOffsetMs !== null && <span><Clock3 size={13} /> +{point.interruptionOffsetMs.toFixed(0)} ms from playback start</span>}
            {!compact && point.selectedNextTacticId && <span className="next-tactic"><ArrowDownRight size={13} /> Next: {point.selectedNextTacticId}</span>}
            {verified && <span className="safe-flag"><CheckCircle2 size={13} /> Safe verification</span>}
          </div>
        </article>
      </li>;
    })}
  </ol>;
}
