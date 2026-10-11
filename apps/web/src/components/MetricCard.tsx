import type { LucideIcon } from "lucide-react";

export function MetricCard({ label, value, detail, icon: Icon, tone = "orange", unknown = false }: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "orange" | "gold" | "green" | "blue";
  unknown?: boolean;
}) {
  return <article className={`metric-card metric-${tone}`}>
    <div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} strokeWidth={1.7} /></span></div>
    <strong className={unknown ? "metric-unknown" : ""}>{value}</strong>
    <small>{detail}</small>
  </article>;
}
