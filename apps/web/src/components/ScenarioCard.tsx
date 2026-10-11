import { ArrowUpRight, AudioLines, BookOpenCheck, ChevronRight, LockKeyhole } from "lucide-react";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { scenarioFocus, scenarioTitle, scenarioTacticCount } from "../scenarioCatalog.js";

const workflowHelperId = (scenarioId: string) => `workflow-helper-${scenarioId}`;

export function ScenarioCard({ scenario, featured = false, isLocalDraft = false, onOpen, onStart }: {
  scenario: ScenarioDocument;
  featured?: boolean;
  isLocalDraft?: boolean;
  onOpen: () => void;
  onStart: () => void;
}) {
  const runtimeEligible = scenario.lifecycle_status === "RUNTIME_ELIGIBLE" && scenario.review_status === "approved";
  return <article className={`scenario-card ${featured ? "scenario-card-featured" : ""} ${isLocalDraft ? "scenario-card-local" : ""}`}>
    <div className="scenario-card-top"><span className="scenario-id">{scenario.scenario_id} <i>·</i> v{scenario.version}</span>
      {isLocalDraft ? <div className="scenario-card-statuses"><span className="status-badge status-draft">Draft (local)</span><span className="status-badge status-not-submitted">NOT SUBMITTED</span></div> : <span className={`status-badge ${runtimeEligible ? "status-approved" : "status-draft"}`}>{runtimeEligible ? "RUNTIME ELIGIBLE" : scenario.review_status === "in_review" ? "IN REVIEW" : "DRAFT"}</span>}
    </div>
    <div className="scenario-art" aria-hidden="true"><div className="scenario-ring" /><div className="scenario-ring ring-two" /><span className="scenario-symbol"><BookOpenCheck size={23} /></span><span className="scenario-wave"><AudioLines size={17} /></span></div>
    {featured && <span className="featured-label">FEATURED TRAINING</span>}
    <h3>{scenarioTitle(scenario)}</h3>
    <p>{scenarioFocus(scenario)}</p>
    <div className="scenario-meta"><span><i>ORG</i>{scenario.fictional_organization.training_only ? "Fictional" : "Unverified"}</span><span><i>LANGUAGE</i>{scenario.language ?? "Pending review"}</span></div>
    <div className="scenario-tags">{scenario.red_flag_ids.map((flag) => <span key={flag}>{flag}</span>)}</div>
    <div className="scenario-card-footer"><span><AudioLines size={14} /> {scenarioTacticCount(scenario) ? `${scenarioTacticCount(scenario)} tactics` : "No approved tactics"}</span>
      <span><LockKeyhole size={13} /> {runtimeEligible ? "Approved" : isLocalDraft ? "Local draft" : "Fallback only"}</span>
    </div>
    <div className="scenario-card-actions"><button className="button button-ghost button-small" type="button" onClick={onOpen}>Inspect scenario <ChevronRight size={15} /></button>
      <button className="button button-outline button-small" type="button" onClick={onStart} disabled={isLocalDraft} title={isLocalDraft ? "Available after backend workflow integration." : undefined} aria-describedby={isLocalDraft ? workflowHelperId(scenario.scenario_id) : undefined}>Preview demo <ArrowUpRight size={14} /></button></div>
    <div className="scenario-workflow">
      <div className="scenario-local-workflow-actions">
        <button type="button" aria-disabled="true" aria-describedby={workflowHelperId(scenario.scenario_id)} title="Available after backend workflow integration.">Edit</button>
        <button type="button" aria-disabled="true" aria-describedby={workflowHelperId(scenario.scenario_id)} title="Available after backend workflow integration.">Submit for review</button>
        <button type="button" aria-disabled="true" aria-describedby={workflowHelperId(scenario.scenario_id)} title="Available after backend workflow integration.">Open in authoring</button>
      </div>
      <p id={workflowHelperId(scenario.scenario_id)}>Available after backend workflow integration.</p>
    </div>
  </article>;
}
