import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, FolderOpen, WandSparkles } from "lucide-react";
import {
  canonicalDraftJson, draftBehaviors, draftJsonLimit, DraftAuthoringError, parseDraftJson, parseSavedDraft,
  type SavedDraft,
} from "@vaccine/scenario-schema";
import safetyReferences from "../../../../content/safety/review-reference-lists.json";

export async function readDraftPreview(file: Pick<File, "arrayBuffer" | "size">): Promise<SavedDraft> {
  if (file.size > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const saved = parseSavedDraft(parseDraftJson(bytes), safetyReferences);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDraftJson(saved.candidate)));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (fingerprint !== saved.contentHash) throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", "contentHash");
  return saved;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel authoring-result-panel">
    <div className="panel-heading"><h2>{title}</h2></div>
    {children}
  </section>;
}

export function AuthoringDraftPreview({ saved }: { saved: SavedDraft }) {
  const { candidate: { draft, details, schemaVersion }, provenance } = saved;
  const { scenario } = draft;
  const mock = provenance.source === "DETERMINISTIC_MOCK";
  return <div className="page-stack">
    <Section title={details.title}>
      <div className="inspector-field">
        <span className="status-badge status-draft">{mock ? "MOCK GENERATED — DRAFT" : "MANUALLY IMPORTED — DRAFT"}</span>
        <strong>{scenario.scenario_id} · v{scenario.version} · schema {schemaVersion}</strong>
        <p>{scenario.fictional_organization.name} · {details.department} · {details.industry}</p>
        <p>{details.audience} · {details.difficulty} · {scenario.language} · {details.scriptPreference} · {details.register}</p>
        <p>{details.premise}</p>
        {scenario.learning_objectives.map((objective, index) => <p key={index}>{objective}</p>)}
        <p>Structural validation {saved.structuralValidation} · Safety review pending · Human approval absent</p>
        <p style={{ overflowWrap: "anywhere" }}>Candidate {saved.candidateId}</p>
        {saved.previousCandidateId && <p style={{ overflowWrap: "anywhere" }}>Previous draft {saved.previousCandidateId}</p>}
        <p>Source {provenance.source} · Saved {saved.createdAt}</p>
        {mock ? <p>Template {provenance.templateFamily} v{provenance.templateVersion} · Generator v{provenance.generatorVersion}</p>
          : <p>Imported file {provenance.originalFilename} · Declared origin {provenance.declaredOrigin ?? "unspecified"} · {provenance.verification}</p>}
      </div>
    </Section>
    <Section title="Opening and tactic variants">
      <div className="inspector-field"><strong>{details.openingResponseId}</strong><p>{scenario.opening_line}</p></div>
      {details.variants.map((variant) => <div className="inspector-field" key={variant.responseId}>
        <strong>{variant.responseId} · {variant.intensity} · authored pressure {variant.pressureLevel} / 5</strong>
        <p>{scenario.responses[variant.responseId]?.text}</p>
        <p>{variant.script} · {variant.redFlags.join(", ")} · {variant.educationalPurpose}</p>
      </div>)}
    </Section>
    <Section title="Learner examples">
      {draftBehaviors.map((behavior) => <div className="inspector-field" key={behavior}>
        <strong>{behavior}</strong>
        {draft.behaviorTrainingExamples.filter((example) => example.label === behavior).map((example) => {
          const meta = details.examples.find((item) => item.exampleId === example.exampleId);
          return <p key={example.exampleId}>{example.utterance} · {example.language}/{meta?.script} · {meta?.interpretation} · {meta?.decision}</p>;
        })}
      </div>)}
    </Section>
    <Section title="Red flags and safe actions">
      {details.redFlags.map((flag) => <div className="inspector-field" key={flag.id}>
        <strong>{flag.id} · {flag.title} · {flag.tactics.join(", ")}</strong><p>{flag.description} {flag.safeAction}</p>
      </div>)}
      <div className="inspector-field">{details.safeActions.map((action) => <p key={action}>{action}</p>)}</div>
    </Section>
    <Section title="Decision points and endings">
      {details.decisionPoints.map((point) => <div className="inspector-field" key={point.nodeId}>
        <strong>Turn {point.turn} · {scenario.nodes.find((node) => node.id === point.nodeId)?.response_id}</strong>
        <p>{point.context}</p>
        {point.routes.map((route) => <p key={route.behavior}>{route.behavior} → {route.action === "terminal"
          ? `${route.outcome} · ${details.terminalResponses[route.outcome]}`
          : scenario.nodes.find((node) => node.id === route.nextNodeId)?.response_id}</p>)}
      </div>)}
      {Object.entries(details.terminalResponses).map(([outcome, responseId]) => <div className="inspector-field" key={outcome}>
        <strong>{outcome} · {responseId}</strong><p>{scenario.responses[responseId]?.text}</p>
      </div>)}
      <div className="inspector-field"><strong>Safe word and learner end</strong><p>{scenario.adaptive_policy?.safe_word} · {details.stopGuidance}</p></div>
    </Section>
    <Section title="Debrief and observable scoring">
      {details.debriefs.map((entry) => <div className="inspector-field" key={entry.templateId}>
        <strong>{entry.outcome ?? entry.behavior} · {entry.redFlags.join(", ")}</strong>
        <p>{draft.debriefTemplateVariants.find((item) => item.templateId === entry.templateId)?.text}</p>
        <p>{entry.scoring}</p><p>{entry.nextAction}</p><p>{entry.limitations}</p><p>{entry.takeaway}</p>
      </div>)}
    </Section>
  </div>;
}

export function AuthoringPage() {
  const [saved, setSaved] = useState<SavedDraft | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  async function openDraft(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || loading.current) return;
    loading.current = true;
    setReading(true);
    setError(null);
    setSaved(null);
    try {
      setSaved(await readDraftPreview(file));
    } catch (cause) {
      setError(cause instanceof DraftAuthoringError ? `${cause.code} · ${cause.message}` : "Could not read the saved draft.");
    } finally {
      loading.current = false;
      setReading(false);
    }
  }

  return <div className="page-stack">
    <div className="page-heading">
      <div><div className="eyebrow"><WandSparkles size={14} /> OFFLINE CONTENT WORKFLOW</div>
        <h1>Scenario authoring</h1><p>Deterministic mock-assisted authoring and manual JSON draft import.</p></div>
      <span className="status-badge status-draft">DRAFT PREVIEW</span>
    </div>
    <section className="panel authoring-brief-panel">
      <div className="panel-heading"><h2>Open a saved draft</h2></div>
      <div className="authoring-form">
        <p>Generate from a structured brief or import candidate JSON in a local terminal. Then choose the saved record from the path printed by the command.</p>
        <code>npm run authoring:draft -- generate content/authoring/examples/benefits-brief.json</code>
        <code>npm run authoring:draft -- import content/authoring/examples/benefits-import.json</code>
        <label><span><FolderOpen size={14} /> Saved draft JSON</span>
          <input type="file" accept=".json,application/json" disabled={reading} onChange={(event) => void openDraft(event)} />
        </label>
        {reading && <p role="status">Checking draft structure and content hash…</p>}
        {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
      </div>
    </section>
    {saved && <AuthoringDraftPreview saved={saved} />}
  </div>;
}
