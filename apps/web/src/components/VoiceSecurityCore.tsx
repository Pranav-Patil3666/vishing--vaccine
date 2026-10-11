import { AudioLines, Mic2, ShieldCheck } from "lucide-react";

export type VoiceActivity = "idle" | "listening" | "speaking" | "processing" | "safe" | "error";

export function VoiceSecurityCore({ activity = "idle", compact = false }: { activity?: VoiceActivity; compact?: boolean }) {
  return <div className={`voice-core ${compact ? "voice-core-compact" : ""} voice-core-${activity}`} role="img" aria-label={`Voice security visualization: ${activity}`}>
    <div className="core-halo" />
    <div className="core-orbit core-orbit-outer" />
    <div className="core-orbit core-orbit-inner" />
    <div className="core-scanline" />
    <div className="core-center"><div className="core-shield"><ShieldCheck size={31} strokeWidth={1.5} /></div><div className="core-mic"><Mic2 size={28} strokeWidth={1.6} /></div></div>
    <div className="core-bars" aria-hidden="true">{Array.from({ length: 27 }, (_, index) => <i key={index} style={{ "--bar": index } as React.CSSProperties} />)}</div>
    <div className="core-caption"><AudioLines size={13} /> SIGNAL MONITOR · MOCK</div>
  </div>;
}
