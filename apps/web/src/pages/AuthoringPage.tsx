import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, FolderOpen, WandSparkles } from "lucide-react";
import {
  AuthoringReviewError, canonicalDraftJson, draftBehaviors, draftJsonLimit, DraftAuthoringError, parseDraftJson, parseSavedDraft,
  validateAuthoringDraft, type AuthoringValidationResult, type SavedDraft,
} from "@vaccine/scenario-schema";
import safetyReferences from "../../../../content/safety/review-reference-lists.json";
import { readReviewPreview, ReviewWorkflowDetails } from "../components/AuthoringReviewPanel.js";

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

export function AuthoringValidationFindings({ result }: { result: AuthoringValidationResult }) {
  return <Section title="Automated safety and schema validation">
    <div className="inspector-field" role="status">
      <strong>Safety validation {result.status}</strong>
      <p>Review eligible {result.reviewEligible ? "Yes" : "No"} · DRAFT</p>
      <p>Errors {result.summary.errors} · Warnings {result.summary.warnings} · Info {result.summary.info}</p>
      <p>{result.summary.errors ? "Resolve blocking errors before submission."
        : result.summary.warnings ? "A reviewer must address each warning before approval." : "There are no blocking errors or review warnings."}</p>
      <p>Validator {result.validationVersion} · Checked {result.checkedAt}</p>
      <p style={{ overflowWrap: "anywhere" }}>Candidate {result.candidateId ?? "Unsaved or invalid identity"}</p>
      <p style={{ overflowWrap: "anywhere" }}>Validated content {result.sourceHash ?? "Unavailable"}</p>
      <p>Human review is required before any later approval.</p>
    </div>
    {result.findings.map((finding) => <div className="inspector-field" key={finding.ruleId + finding.path}>
      <strong>{finding.severity} · {finding.category} · {finding.ruleId}</strong>
      <p>Path {finding.path}</p>
      <p>{finding.message}</p><p>{finding.remediation}</p>
    </div>)}
    {result.graph && <div className="inspector-field">
      <strong>Bounded draft graph</strong>
      <p>Prefixes {result.graph.reachablePrefixes} · Terminal leaves {result.graph.terminalLeaves} · Maximum depth {result.graph.maximumDepth}</p>
      <p>Reachable draft pressures {result.graph.reachablePressures.join(", ")} · Unreached authored variants {result.graph.unreachableAuthoredVariants.length}</p>
    </div>}
  </Section>;
}

export function AuthoringDraftPreview({ saved, sourceSnapshot = false }: { saved: SavedDraft; sourceSnapshot?: boolean }) {
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
        <p>Structural validation {saved.structuralValidation} · {sourceSnapshot ? "Immutable source snapshot" : "Human approval absent from this file"}</p>
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
  const [validation, setValidation] = useState<AuthoringValidationResult | null>(null);
  const [workflow, setWorkflow] = useState<Awaited<ReturnType<typeof readReviewPreview>> | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  async function openFiles(event: ChangeEvent<HTMLInputElement>, kind: "draft" | "ancestors" | "workflow") {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const file = files[0];
    if (!file || loading.current || (kind === "ancestors" && !saved)) return;
    loading.current = true;
    setReading(true);
    setError(null);
    setValidation(null);
    setWorkflow(null);
    if (kind !== "ancestors") setSaved(null);
    try {
      if (kind === "workflow") {
        setWorkflow(await readReviewPreview(file));
        return;
      }
      if (kind === "ancestors" && saved) {
        if (files.length > 32) {
          setError("Select at most 32 saved ancestor records.");
          setValidation(await validateAuthoringDraft(saved, { safety: safetyReferences }));
          return;
        }
        const lineage = await Promise.all(files.map(readDraftPreview));
        setValidation(await validateAuthoringDraft(saved, { safety: safetyReferences, lineage }));
        return;
      }
      if (file.size > draftJsonLimit) {
        setValidation(await validateAuthoringDraft(new Uint8Array(draftJsonLimit + 1), { safety: safetyReferences }));
        return;
      }
      const contents = await file.arrayBuffer();
      const bytes = new Uint8Array(contents);
      setValidation(await validateAuthoringDraft(bytes, { safety: safetyReferences }));
      setSaved(await readDraftPreview({ size: contents.byteLength, arrayBuffer: async () => contents }));
    } catch (cause) {
      if (kind === "ancestors" && saved) setValidation(await validateAuthoringDraft(saved, { safety: safetyReferences }));
      if (kind === "workflow") {
        setError(cause instanceof AuthoringReviewError && cause.code === "INVALID_REVIEW_REQUEST"
          ? "Choose a workflow export JSON generated by the local review CLI."
          : "The workflow export could not be verified. Open a fresh export from the local review CLI.");
      } else if (kind === "ancestors") {
        setError("An ancestor file could not be verified. Select the original saved ancestor records.");
      } else {
        setError(cause instanceof DraftAuthoringError
          ? `${cause.code} · See the validation findings for corrections.` : "Could not read the saved draft.");
      }
    } finally {
      loading.current = false;
      setReading(false);
    }
  }

  return <div className="page-stack">
    <div className="page-heading">
      <div><div className="eyebrow"><WandSparkles size={14} /> OFFLINE CONTENT WORKFLOW</div>
        <h1>Scenario authoring</h1><p>Build a fictional call, inspect its safety findings, and review the evidence required before it can be used in training.</p></div>
      <span className="status-badge status-draft">{workflow ? "WORKFLOW PREVIEW" : "DRAFT PREVIEW"}</span>
    </div>
    <ol className="authoring-steps" aria-label="Trainer workflow"><li>1. Create or import</li><li>2. Check safety</li><li>3. Human review</li><li>4. Controlled publication</li></ol>
    <div className="authoring-entry-grid" aria-busy={reading}>
    <section className="panel authoring-brief-panel">
      <div className="panel-heading"><h2>Create or inspect a draft</h2></div>
      <div className="authoring-form">
        <p>Open a saved draft to run safety and schema validation and inspect its dialogue and learner examples.</p>
        <details><summary>Local commands to create or import</summary>
          <p>Deterministic mock generation from a fictional brief:</p>
          <code>npm run authoring:draft -- generate content/authoring/examples/benefits-brief.json</code>
          <p>Manual import with the same validation checks:</p>
          <code>npm run authoring:draft -- import content/authoring/examples/benefits-import.json</code>
          <p>Choose the saved JSON at the path printed by the command. Files are read locally in this browser.</p>
        </details>
        <label><span><FolderOpen size={14} /> Saved draft JSON</span>
          <input type="file" accept=".json,application/json" disabled={reading} onChange={(event) => void openFiles(event, "draft")} />
        </label>
        {saved?.previousCandidateId && <>
          <p>For a revision, select every saved ancestor in its chain. A workflow export includes the available ancestors and review history.</p>
          <label>Saved ancestor JSON files
            <input type="file" multiple accept=".json,application/json" disabled={reading} onChange={(event) => void openFiles(event, "ancestors")} />
          </label>
        </>}
      </div>
    </section>
    <section className="panel authoring-brief-panel">
      <div className="panel-heading"><h2>Inspect review and publication</h2></div>
      <div className="authoring-form">
        <p>Open a workflow export to check its exact snapshot, human decisions and publication history. Approval is separate from runtime availability.</p>
        <p>The local CLI applies privileged decisions. For the S-92 example, choose <code>S-92-v0.1.1-approved.workflow.json</code> from the local authoring cache.</p>
        <details><summary>Local review commands</summary><code>npm run --silent authoring:review -- help</code><p>If the registry is unavailable, check it in the local CLI and open a fresh export once it is available.</p></details>
        <label>Workflow export JSON<input type="file" accept=".json,application/json" disabled={reading} onChange={(event) => void openFiles(event, "workflow")} /></label>
      </div>
    </section>
    </div>
    {reading && <p role="status">Checking structure, content hashes and lineage…</p>}
    {!reading && !error && !validation && !workflow && <p className="empty-inline">Choose a saved draft or workflow export to begin. Findings and decisions will appear here.</p>}
    {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
    {validation && <AuthoringValidationFindings result={validation} />}
    {saved && <AuthoringDraftPreview saved={saved} />}
    {workflow && <ReviewWorkflowDetails key={workflow.view.exportHash} {...workflow}
      renderCandidate={(candidate) => <AuthoringDraftPreview saved={candidate} sourceSnapshot />} />}
  </div>;
}
