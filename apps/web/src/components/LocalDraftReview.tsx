import { AlertTriangle, ArrowLeft, CircleCheck, CircleX, FileText, LockKeyhole, ShieldAlert } from "lucide-react";
import type { LocalScenarioDraft, SafetyCheck } from "../authoringDraft.js";
import { redFlagLabels, renderDebriefPreview } from "../authoringDraft.js";
import { scenarioFocus, scenarioTitle } from "../scenarioCatalog.js";
import { PressureScale } from "./PressureScale.js";

const behaviorLabels: Record<string, string> = {
  REFUSED: "refused",
  STALLED: "stalled",
  VERIFIED_INDEPENDENTLY: "verified independently",
  COMPLIED: "complied",
  DISCLOSED_DUMMY_SECRET: "disclosed dummy secret",
};

function statusIcon(status: SafetyCheck["status"]) {
  if (status === "PASS") return <CircleCheck size={16} />;
  if (status === "FAIL") return <CircleX size={16} />;
  return <AlertTriangle size={16} />;
}

export function LocalDraftReview({ draft, onBack }: { draft: LocalScenarioDraft; onBack: () => void }) {
  const { scenario } = draft;
  const previewVariant = draft.debriefVariants.find((variant) => variant.id === "stalled")!;
  return <div className="page-stack local-draft-review">
    <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Scenario library</button>
    <div className="page-heading scenario-detail-heading local-draft-heading">
      <div className="local-draft-title"><div className="eyebrow">SCENARIO ID · {scenario.scenario_id} <i>·</i> VERSION {scenario.version}</div><h1>{scenarioTitle(scenario)}</h1><p>{scenarioFocus(scenario)}</p></div>
      <div className="local-status-stack"><span className="status-badge status-draft">DRAFT</span><span className="status-badge status-not-submitted">NOT SUBMITTED</span></div>
    </div>
    <div className="local-draft-banner"><FileText size={17} /><div><strong>Draft (local)</strong><span>Held in this page session’s memory. Content is not persisted and is not eligible for runtime use.</span></div></div>

    <section className="panel local-section">
      <div className="panel-heading"><div><span className="eyebrow">SCENARIO METADATA</span><h2>Draft record</h2></div><span className="status-badge status-draft">CONTENT · DRAFT</span></div>
      <dl className="local-metadata-grid">
        <div><dt>Scenario ID</dt><dd>{scenario.scenario_id}</dd></div>
        <div><dt>Version</dt><dd>{scenario.version}</dd></div>
        <div><dt>Organization</dt><dd>{scenario.fictional_organization.name}</dd></div>
        <div><dt>Language</dt><dd>{scenario.language ?? "Not set"}</dd></div>
        <div><dt>Maximum pressure</dt><dd>{scenario.adaptive_policy?.max_pressure_level ?? "Not configured"}</dd></div>
        <div><dt>Maximum turns</dt><dd>{scenario.adaptive_policy?.max_turns ?? "Not configured"}</dd></div>
        <div><dt>Review</dt><dd>Not submitted</dd></div>
        <div><dt>Runtime eligibility</dt><dd>Not eligible</dd></div>
      </dl>
    </section>

    <section className="panel local-section">
      <div className="panel-heading"><div><span className="eyebrow">CALLER CONTENT</span><h2>Pressure curve</h2></div><span className="panel-count">{draft.tactics.length} tactics · {draft.tactics.reduce((sum, tactic) => sum + tactic.lines.length, 0)} lines</span></div>
      <p className="local-section-note">Intensity values use the mock policy’s configured maximum: {scenario.adaptive_policy?.max_pressure_level}. Each tactic and its response share one canonical ID.</p>
      <div className="local-tactic-list">{draft.tactics.map((tactic) => <article className="local-tactic" key={tactic.id}>
        <div className="local-tactic-heading"><div><span className="eyebrow">{tactic.category.replaceAll("_", " ")}</span><h3>{tactic.label}</h3></div><code>{tactic.id} = response {tactic.response.id}</code></div>
        <ol className="local-caller-lines">{tactic.lines.map((line) => <li key={line.intensity}>
          <div className="local-intensity"><strong>{line.intensity}</strong><PressureScale level={line.pressureLevel} max={scenario.adaptive_policy?.max_pressure_level ?? 0} label={`${tactic.label} ${line.intensity}`} /></div>
          <p>{line.text}</p>
        </li>)}</ol>
      </article>)}</div>
    </section>

    <section className="panel local-section">
      <div className="panel-heading"><div><span className="eyebrow">SELECTED RED FLAGS</span><h2>Scenario mapping</h2></div><span className="panel-count">{scenario.red_flag_ids.length} selected</span></div>
      <div className="local-red-flags">{scenario.red_flag_ids.map((flag) => <div key={flag}><span>{flag}</span><strong>{redFlagLabels[flag] ?? "Unmapped red flag"}</strong></div>)}</div>
    </section>

    <section className="panel local-section">
      <div className="panel-heading"><div><span className="eyebrow">SYNTHETIC TRAINING SET</span><h2>Behavior examples</h2></div><span className="panel-count">{draft.trainingExamples.length} examples</span></div>
      <div className="local-example-list">{draft.trainingExamples.map((example) => <article className="local-example" key={example.exampleId}><span className="status-badge status-draft">{behaviorLabels[example.label] ?? example.label.toLowerCase()}</span><p>{example.utterance}</p><small>{example.language} · {example.split.replaceAll("_", " ")} · synthetic</small></article>)}</div>
    </section>

    <section className="panel local-section">
      <div className="panel-heading"><div><span className="eyebrow">DEBRIEF TEMPLATES</span><h2>Observable outcome variants</h2></div><span className="panel-count">{draft.debriefVariants.length} variants</span></div>
      <div className="local-debrief-list">{draft.debriefVariants.map((variant) => <article className="local-debrief" key={variant.id}><span>{behaviorLabels[variant.id.toUpperCase()] ?? variant.id.replaceAll("_", " ")}</span><p>{variant.text}</p></article>)}</div>
      <div className="local-preview"><div className="eyebrow"><FileText size={13} /> RESOLVED MOCK PREVIEW</div><p>{renderDebriefPreview(previewVariant)}</p><small>Fixture: latency 612 ms · timestamp around 00:18 · behavior stalled</small></div>
    </section>

    <section className="panel local-section local-preflight">
      <div className="panel-heading"><div><span className="eyebrow">FRONTEND SAFETY PREFLIGHT · LOCAL ONLY</span><h2>Computed checks</h2></div>
        <span className={`status-badge ${draft.safetyPreflight.status === "FAIL" ? "status-failed" : draft.safetyPreflight.status === "WARNING" ? "status-warning" : "status-safe"}`}>{draft.safetyPreflight.status}</span>
      </div>
      <ul className="local-safety-checks">{draft.safetyPreflight.checks.map((check) => <li className={`local-safety-${check.status.toLowerCase()}`} key={check.id}>{statusIcon(check.status)}<div><strong>{check.label}</strong><span>{check.detail}</span></div></li>)}</ul>
      <div className="local-preflight-note"><ShieldAlert size={15} /> This frontend preflight is informational and does not replace backend validation or human review.</div>
    </section>

    <section className="local-workflow-panel" aria-label="Review workflow actions">
      <div><LockKeyhole size={17} /><div><strong>Review workflow unavailable</strong><span>Available after backend workflow integration.</span></div></div>
      <div className="local-workflow-actions"><button type="button" disabled>Edit</button><button type="button" disabled>Submit for review</button></div>
    </section>
  </div>;
}
