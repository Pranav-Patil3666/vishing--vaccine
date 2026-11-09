import { ArrowRight, BookOpenCheck } from "lucide-react";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { trainingLanguage, trainingObjective, trainingTitle } from "../scenarioCatalog.js";

export function ScenarioCard({ scenario, eligible, onStart }: {
  scenario: ScenarioDocument;
  eligible: boolean;
  onStart?: () => void;
}) {
  const turns = scenario.adaptive_policy?.max_turns;
  return <article className="scenario-card">
    <div className="scenario-card-top">
      <span className="scenario-id">{scenario.scenario_id} <i>·</i> v{scenario.version}</span>
      <span className={`status-badge ${eligible ? "status-approved" : "status-draft"}`}>{eligible ? "RUNTIME ELIGIBLE" : "DRAFT · NOT PLAYABLE"}</span>
    </div>
    <div className="scenario-art" aria-hidden="true"><div className="scenario-ring" /><div className="scenario-ring ring-two" /><span className="scenario-symbol"><BookOpenCheck size={23} /></span></div>
    <h2>{trainingTitle(scenario)}</h2>
    <p>{scenario.fictional_organization.name} · fictional organization</p>
    <p>{trainingObjective(scenario)}</p>
    <div className="scenario-meta"><span>{trainingLanguage(scenario)}</span>{turns && <span>Up to {turns} learner turns</span>}</div>
    {eligible && onStart && <div className="scenario-card-actions"><button className="button button-primary" type="button" onClick={onStart}>Choose scenario <ArrowRight size={16} /></button></div>}
  </article>;
}
