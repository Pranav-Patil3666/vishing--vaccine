import { useState, type ReactNode } from "react";
import {
  AuthoringCandidateSchema, AuthoringReviewError, ReviewOperationSchema, canSubmitForSafetyReview,
  checklistAllowsApproval, currentPublicationCompatibility, parseDraftJson, parseReviewJson, reviewChecklist,
  reviewJsonLimit, validateAuthoringDraft, verifyReviewExport, warningAllowsApproval,
  type ReviewAction, type ReviewExport, type ReviewOperation, type SavedDraft, type AuthoringValidationResult, type publicationReasons,
} from "@vaccine/scenario-schema";
import safety from "../../../../content/safety/review-reference-lists.json";

const compatibilityLabels: Record<(typeof publicationReasons)[number], string> = {
  RUNTIME_SCENARIO_UNREGISTERED: "This scenario is not registered for the live conversation runtime.",
  LANGUAGE_UNSUPPORTED: "The language is not supported by this target.",
  VOICE_NOT_VERIFIED: "The required voice has not been verified for this target.",
  TURN_POLICY_UNSUPPORTED: "The turn policy is incompatible with this target.",
  PRESSURE_PROFILE_UNSUPPORTED: "The pressure profile is incompatible with this target.",
  REVIEWED_RUNTIME_PACKAGE_MISSING: "A reviewed runtime package is missing.",
  AUTHORING_GRAPH_NOT_RUNTIME_POLICY: "The authored decision graph does not match the runtime policy.",
  TERMINAL_MAPPING_NOT_INTEGRATED: "Ending responses are not mapped to the runtime.",
  PUBLICATION_HELD: "A publication hold is in effect.",
  VALIDATION_STALE: "Validation must be refreshed.",
  OFFLINE_PROFILE_REQUIRED: "The required typed-practice profile is missing.",
  GRAPH_POLICY_MISMATCH: "The authored routes do not match the executable policy.",
  RELEASE_VALIDATION_FAILED: "The compiled release did not pass validation.",
};

export function reviewUiCapabilities(view: ReviewExport, fresh: AuthoringValidationResult, snapshotCurrent: boolean) {
  const { item } = view;
  const pending = item.lifecycle === "SAFETY_REVIEW" && item.review?.decision === "pending";
  return {
    submit: item.lifecycle === "DRAFT" && item.review === null && fresh.reviewEligible,
    start: pending && !item.review?.startedBy,
    review: pending && Boolean(item.review?.startedBy),
    approve: pending && Boolean(item.review?.startedBy) && snapshotCurrent && Boolean(item.review
      && checklistAllowsApproval(item.review.checklist) && warningAllowsApproval(item.review)),
    publishRequest: item.lifecycle === "APPROVED" && item.approval !== null,
    publish: false,
  };
}

export async function readReviewPreview(file: Pick<File, "arrayBuffer" | "size">) {
  if (file.size > reviewJsonLimit) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
  const view = await verifyReviewExport(parseReviewJson(new Uint8Array(await file.arrayBuffer())), safety);
  const options = { safety, lineage: view.lineage };
  const fresh = await validateAuthoringDraft(view.item.record, options);
  const snapshotCurrent = view.item.review
    ? (await canSubmitForSafetyReview(view.item.record, view.item.review.snapshot.validation, options)).eligible : false;
  return { view, fresh, snapshotCurrent };
}

export function createReviewProposal(view: ReviewExport, action: ReviewAction, evidence: unknown): ReviewOperation {
  return ReviewOperationSchema.parse({
    operationId: crypto.randomUUID(), expectedSequence: view.sequence,
    candidateId: view.item.record.candidateId, expectedContentHash: view.item.record.contentHash,
    expectedState: view.item.lifecycle, action, evidence,
  });
}

export function revisionProposalCandidate(input: string, version: string) {
  if (!/^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/u.test(version)) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
  const candidate = AuthoringCandidateSchema.parse(parseDraftJson(new TextEncoder().encode(input)));
  const draft = candidate.draft;
  // Explicit revision preparation synchronizes redundant package copies. Validation still checks all authored content.
  draft.scenario.version = version;
  draft.scenario.responses[candidate.details.openingResponseId]!.text = draft.scenario.opening_line;
  draft.packageId = `${draft.scenario.scenario_id}-${version}-draft`;
  draft.scenarioBrief.learningObjective = draft.scenario.learning_objectives[0]!;
  draft.scenarioBrief.redFlags = [...draft.scenario.red_flag_ids];
  draft.candidateApprovedResponses = Object.entries(draft.scenario.responses).map(([responseId, response]) => ({
    responseId, text: response.text, language: draft.scenario.language!, status: "DRAFT",
  }));
  draft.importableArtifacts = [{
    artifactId: `${draft.scenario.scenario_id}-${version}-scenario`, format: "scenario-json",
    scenario: structuredClone(draft.scenario),
  }];
  draft.candidateUtterances = structuredClone(draft.behaviorTrainingExamples);
  return candidate;
}

function downloadOperation(operation: ReviewOperation) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(operation, null, 2)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `review-${operation.action}.json`; anchor.click();
  URL.revokeObjectURL(url);
}

export function ReviewWorkflowDetails({
  view, fresh, snapshotCurrent, renderCandidate,
}: { view: ReviewExport; fresh: AuthoringValidationResult; snapshotCurrent: boolean; renderCandidate: (saved: SavedDraft) => ReactNode }) {
  const { item } = view, review = item.review;
  const capabilities = reviewUiCapabilities(view, fresh, snapshotCurrent);
  const [items, setItems] = useState<Record<string, { decision: string; reason: string }>>({});
  const [warningForms, setWarningForms] = useState<Record<string, { decision: string; rationale: string }>>({});
  const [notes, setNotes] = useState(""), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [edit, setEdit] = useState(JSON.stringify(item.record.candidate, null, 2));
  const [version, setVersion] = useState(""), [revisionReason, setRevisionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const exportOperation = (action: ReviewAction, evidence: unknown) => {
    try {
      const proposal = createReviewProposal(view, action, evidence);
      downloadOperation(proposal);
      setMessage("Proposal downloaded. Apply it with the configured CLI actor, then reload a fresh workflow export.");
    } catch {
      setMessage("Complete the required decisions, rationale and explicit confirmation before preparing this proposal.");
    }
  };
  const warnings = review?.snapshot.validation.findings.filter((finding) => finding.severity === "WARNING") ?? [];
  const compatibility = item.approval ? currentPublicationCompatibility(item.approval, item.publicationHold !== null) : null;
  const failedItems = Object.entries(review?.checklist ?? {}).filter(([, entry]) => entry && ["FAIL", "NEEDS_REVISION"].includes(entry.decision)).map(([key]) => key);
  const mandatory = Object.entries(reviewChecklist).filter(([, definition]) => definition.critical);
  const passed = mandatory.filter(([key]) => review?.checklist[key as keyof typeof reviewChecklist]?.decision === "PASS").length;
  const approvedRelease = item.publications.find((entry) => entry.status === "PUBLISHED");
  const lastPublication = item.publications.at(-1);
  const reviewStatus = review?.decision === "rejected"
    ? review.decisionDetails?.action === "request-changes" ? "CHANGES REQUESTED" : "REJECTED" : item.lifecycle;
  const scenario = item.record.candidate.draft.scenario;
  return <section className="panel authoring-result-panel">
    <div className="panel-heading"><h2>Review and publication</h2><span className={`status-badge ${item.approval ? "status-ai" : "status-draft"}`}>{reviewStatus}</span></div>
    <div className="workflow-status-grid">
      <div><span>HUMAN REVIEW</span><strong>{item.approval ? "Approved" : reviewStatus.replaceAll("_", " ")}</strong>
        <small>{review ? `${passed}/${mandatory.length} mandatory checks passed` : "No review has been submitted"}</small></div>
      <div><span>PUBLICATION</span><strong className={lastPublication?.status === "PUBLICATION_BLOCKED" ? "workflow-blocked" : undefined}>{item.publicationHold ? "Held" : lastPublication?.status ?? "No attempt recorded"}</strong>
        <small>{lastPublication?.status === "PUBLICATION_BLOCKED" ? "The target's compatibility checks blocked this attempt." : "Publication is a separate decision."}</small></div>
      <div><span>RUNTIME AVAILABILITY IN THIS EXPORT</span><strong>{item.publicationHold ? "Unavailable · hold" : approvedRelease ? "Published for typed practice" : "Not playable"}</strong>
        <small>Check Training for the current playable catalog.</small></div>
    </div>
    <div className="workflow-validation">
      <strong>Revalidated {fresh.status}</strong><span>Errors {fresh.summary.errors} · Warnings {fresh.summary.warnings} · Info {fresh.summary.info}</span>
      <span>Submitted validation {snapshotCurrent ? "current" : "unavailable or stale"}</span>
    </div>
    <div className="inspector-field">
      <strong>{scenario.scenario_id} · v{scenario.version} · {item.record.candidate.details.title}</strong>
      <p>Source {item.record.provenance.source} · Author {item.author.actorId}</p>
      <p>Workflow export from {view.exportedAt} · Registry sequence {view.sequence}</p>
      <p>Local CLI controls persistent changes. This file is a read-only snapshot. Refresh it after each committed action.</p>
      <p>Review eligibility {fresh.reviewEligible ? "Yes" : "No"} · Validator {fresh.validationVersion}{fresh.graph ? ` · ${fresh.graph.terminalLeaves} terminal paths · maximum depth ${fresh.graph.maximumDepth}` : ""}</p>
      <p className="release-fingerprint">{review ? "Reviewed content" : "Candidate content"} {item.record.contentHash}</p>
      <p>Reviewer {review?.startedBy?.actorId ?? "not assigned"} · Decision {review?.decision ?? "not submitted"}</p>
      {review && <p className="release-fingerprint">Review {review.reviewId} · {review.reviewCompletedAt ?? "Decision pending"} · {review.warnings.length} warning dispositions</p>}
      {item.approval && <p className="release-fingerprint">Approval {item.approval.approvalId} · {item.approval.approvedAt}</p>}
      {review?.decision === "rejected" && <p>Create a new revision before another review.</p>}
      {capabilities.submit && <button className="button button-outline button-small"
        onClick={() => exportOperation("submit", { validation: fresh })}>Download submit proposal</button>}
      {capabilities.start && <button className="button button-outline button-small"
        onClick={() => exportOperation("start", { reviewId: review?.reviewId })}>Download start-review proposal</button>}
    </div>
    <details><summary>Current automated validation findings</summary>
      {fresh.findings.map((finding) => <div className="inspector-field" key={finding.ruleId + finding.path}>
        <strong>{finding.severity} · {finding.ruleId}</strong><p>{finding.path}</p>
        <p>{finding.message}</p><p>{finding.remediation}</p>
      </div>)}
    </details>
    <details><summary>Full immutable candidate snapshot</summary>{renderCandidate(item.record)}</details>
    <details open={capabilities.review}><summary>Human review checklist and warnings</summary>
      <div className="authoring-form">
        <p>Checklist proposals are unsaved until the CLI commits them. Critical items require PASS. NOT_APPLICABLE requires an explanation.</p>
        {(Object.entries(reviewChecklist)).map(([key, definition]) => {
          const saved = review?.checklist[key as keyof typeof reviewChecklist];
          const field = items[key] ?? { decision: "", reason: "" };
          return <fieldset key={key}>
            <legend>{definition.group} · {definition.critical ? "Required" : "Conditional"}</legend>
            <label>{definition.label}<select disabled={!capabilities.review} value={field.decision}
              onChange={(event) => setItems((prior) => ({ ...prior, [key]: { ...field, decision: event.target.value } }))}>
              <option value="">Choose decision</option>{["PASS", "FAIL", "NEEDS_REVISION", "NOT_APPLICABLE"].map((choice) => <option key={choice}>{choice}</option>)}
            </select></label>
            <label>Checklist reason<input disabled={!capabilities.review} maxLength={1000} value={field.reason}
              onChange={(event) => setItems((prior) => ({ ...prior, [key]: { ...field, reason: event.target.value } }))} /></label>
            <p>Persisted {saved?.decision ?? "not reviewed"} {saved ? "· " + saved.actor.actorId : ""}</p>
          </fieldset>;
        })}
        <button className="button button-outline" disabled={!capabilities.review}
          onClick={() => exportOperation("checklist", {
            reviewId: review?.reviewId, items: Object.fromEntries(Object.entries(items).filter(([, value]) => value.decision)),
          })}>Download checklist proposal</button>
        {warnings.map((finding) => {
          const key = finding.ruleId + finding.path;
          const field = warningForms[key] ?? { decision: "", rationale: "" };
          const saved = review?.warnings.find((warning) => warning.ruleId === finding.ruleId && warning.path === finding.path);
          return <fieldset key={key}><legend>{finding.ruleId}</legend>
            <p>{finding.message}</p><p>{finding.path}</p><p>{finding.remediation}</p>
            <label>Warning decision<select disabled={!capabilities.review} value={field.decision}
              onChange={(event) => setWarningForms((prior) => ({ ...prior, [key]: { ...field, decision: event.target.value } }))}>
              <option value="">Choose individual disposition</option>
              <option>ACCEPTED_WITH_JUSTIFICATION</option><option>REQUIRES_CHANGES</option><option>RESOLVED_IN_NEW_REVISION</option>
            </select></label>
            <label>Educational rationale<textarea disabled={!capabilities.review} maxLength={1500} value={field.rationale}
              onChange={(event) => setWarningForms((prior) => ({ ...prior, [key]: { ...field, rationale: event.target.value } }))} /></label>
            <p>Persisted {saved?.decision ?? "not addressed"} · {saved?.rationale ?? "Individual reviewer rationale required"}</p>
            <button className="button button-outline" disabled={!capabilities.review}
              onClick={() => exportOperation("warning", {
                reviewId: review?.reviewId,
                warning: { ruleId: finding.ruleId, path: finding.path, ...field },
              })}>Download this warning proposal</button>
          </fieldset>;
        })}
        <label>Review notes<textarea disabled={!capabilities.review} maxLength={1500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>Decision reason<textarea disabled={!capabilities.review} maxLength={1500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label><input type="checkbox" disabled={!capabilities.review} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I intend this decision for the exact submitted snapshot.</label>
        <button className="button button-primary" disabled={!capabilities.approve || !confirmed}
          onClick={() => exportOperation("approve", { reviewId: review?.reviewId, confirmed, notes, decisionReason: reason })}>Download approval proposal</button>
        {!capabilities.approve && <p>Approval requires persisted complete checks, individual warning acceptance and current validation. Reload after CLI saves.</p>}
        {(["reject", "request-changes"] as const).map((action) => <button className="button button-outline" key={action}
          disabled={!capabilities.review || !confirmed || failedItems.length === 0}
          onClick={() => exportOperation(action, { reviewId: review?.reviewId, confirmed, reason, failedItems, findingPaths: [] })}>
          Download {action} proposal</button>)}
      </div>
    </details>
    <details><summary>Create a new draft revision</summary>
      <div className="authoring-form">
        <p>Edit opening_line, canonical responses, behaviorTrainingExamples and the educational details below. Revision preparation synchronizes their package copies. The CLI validates the result as a new DRAFT.</p>
        <label>New numeric version<input value={version} maxLength={20} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.1" /></label>
        <label>Revision reason<textarea value={revisionReason} maxLength={1500} onChange={(event) => setRevisionReason(event.target.value)} /></label>
        <label>Candidate JSON<textarea rows={14} value={edit} onChange={(event) => setEdit(event.target.value)} /></label>
        <button className="button button-outline" onClick={() => {
          try { exportOperation("revise", { candidate: revisionProposalCandidate(edit, version), revisionReason }); }
          catch { setMessage("Use structurally valid candidate JSON and a new numeric version."); }
        }}>Download new-revision proposal</button>
      </div>
    </details>
    <details><summary>Approval and publication record</summary>
      <div className="inspector-field">
        <p>Approval {item.approval?.approvalId ?? "absent"} · Approved by {item.approval?.reviewer.actorId ?? "none"}</p>
        {item.approval && <p>Historical approval at {item.approval.approvedAt} · {item.publicationHold ? "Publication held" : item.publications.some((entry) => entry.status === "PUBLISHED") ? "Published for offline practice" : "Runtime eligible false"}</p>}
        <p>{review?.notes}</p><p>{review?.decisionReason}</p>
        <p>Publication target current-real-conversation</p>
        <p>{compatibility ? `Compatibility for the current live target: ${compatibility.reasons.map((reason) => compatibilityLabels[reason]).join(" ")}` : "Human approval is required before a publication request."}</p>
        {capabilities.publishRequest && <button className="button button-outline"
          onClick={() => exportOperation("publish", { approvalId: item.approval?.approvalId, confirmed: true, target: "current-real-conversation" })}>
          Download publication-request proposal</button>}
        {item.record.candidate.details.runtimeProfile === "offline-adaptive-v1" && <button className="button button-outline" disabled={!capabilities.publishRequest || Boolean(item.publicationHold)}
          onClick={() => exportOperation("publish", { approvalId: item.approval?.approvalId, confirmed: true, target: "offline-adaptive" })}>
          Download offline publication proposal</button>}
        {item.publications.length === 0 && <p>No publication attempt is present in this export.</p>}
        {item.publications.map((publication) => <div key={publication.publicationId} className="publication-attempt">
          <strong>{publication.status}</strong><p className="release-fingerprint">{publication.publicationId} · {publication.requestedAt} · {publication.actor.actorId}</p>
          {publication.reasons.length > 0 && <ul>{publication.reasons.map((reason) => <li key={reason}>{compatibilityLabels[reason]} <small>{reason}</small></li>)}</ul>}
        </div>)}
      </div>
    </details>
    <details><summary>Version and audit history</summary>
      {view.history.map((entry) => <div className="inspector-field" key={entry.candidateId}>
        <strong>{entry.scenarioVersion} · {entry.lifecycle} · {entry.reviewDecision ?? "not reviewed"}</strong>
        <p>{entry.authorId} · {entry.revisionReason}</p><p style={{ overflowWrap: "anywhere" }}>{entry.candidateId}</p>
        <p>Changed fields {entry.changedPaths.join(", ") || "initial managed revision"}</p>
      </div>)}
      {view.audit.map((event) => <div className="inspector-field" key={event.eventId}>
        <strong>{event.sequence} · {event.type} · {event.actor.actorId}/{event.actor.role}</strong>
        <p>{event.before ?? "new"} → {event.after} · {event.at}</p>
        <p>{event.scenarioId} v{event.scenarioVersion} · {event.reasonCode}</p>
      </div>)}
    </details>
    {message && <div className="inspector-field" role="status">{message}</div>}
  </section>;
}
