import { z } from "zod";
import { ScenarioReviewSchema, type ScenarioReviewChecklist } from "./authoring.js";
import {
  AuthoringCandidateSchema, SavedDraftSchema, canonicalDraftJson, parseBoundedAuthoringJson, parseSavedDraft,
} from "./phase6Draft.js";
import {
  AuthoringValidationResultSchema, hashAuthoringData,
} from "./authoringValidation.js";
import type { ScenarioSafetyOptions } from "./safety.js";
import { RuntimeReleaseSchema } from "./runtimeRelease.js";

export const reviewJsonLimit = 2 * 1024 * 1024;
export const reviewChecklist = {
  fictionalOrganization: { group: "Fictional framing", critical: true, label: "Organization is fictional and clearly marked training-only." },
  staffAndContacts: { group: "Fictional framing", critical: true, label: "No real staff impersonation or real contact information." },
  simulationLabelVisible: { group: "Fictional framing", critical: true, label: "The caller opening clearly discloses simulation." },
  educationalPurpose: { group: "Education", critical: true, label: "Recognizable red flags and appropriate awareness-training tactics." },
  noSecurityBypassInstructions: { group: "Education", critical: true, label: "No operational malicious, payment or security-bypass instructions." },
  syntheticDataOnly: { group: "Credential safety", critical: true, label: "Only approved dummy values, with no real secrets or account data." },
  syntheticDisclosureContext: { group: "Credential safety", critical: true, label: "Synthetic disclosure or unsolicited disclosure has a defined educational meaning." },
  callerCoherence: { group: "Caller content", critical: true, label: "Opening and tactic lines are coherent, understandable and voice-suitable." },
  pressureIntent: { group: "Caller content", critical: true, label: "Authored pressure metadata fits the educational purpose and declared ceiling." },
  behaviorExamples: { group: "Learner behavior", critical: true, label: "All six example labels describe the intended actions." },
  complianceDistinct: { group: "Learner behavior", critical: true, label: "Agreement without a dummy value is distinct from synthetic disclosure." },
  boundedBranches: { group: "Branching", critical: true, label: "All referenced paths terminate within the turn bound." },
  terminalPrecedence: { group: "Branching", critical: true, label: "Verification, disclosure, fallback and turn-cap precedence are coherent." },
  safeEndingAvailable: { group: "Safe outcomes", critical: true, label: "All endings, fallback, manual end and safe-word boundaries are safe." },
  languageQuality: { group: "Language", critical: true, label: "Hindi/Hinglish and both scripts are clear and natural for this exercise." },
  translationChecked: { group: "Language", critical: false, label: "Any claimed translation equivalence has been checked." },
  observableDebrief: { group: "Debrief", critical: true, label: "Debriefs and scores use observed behavior, with no emotion inference or fabricated follow-through." },
  provenanceAccuracy: { group: "Provenance", critical: true, label: "Mock/manual origin is accurate and imported model claims remain unverified." },
  aiVoiceDisclosureRequired: { group: "Runtime safeguards", critical: true, label: "Any future synthesized voice requires AI-voice disclosure." },
  consentBeforeRecording: { group: "Runtime safeguards", critical: true, label: "Future microphone use requires prior consent." },
  noAudioRetentionByDefault: { group: "Runtime safeguards", critical: true, label: "Learner raw audio is not retained by default." },
} as const;
export type ReviewChecklistKey = keyof typeof reviewChecklist;
const checklistKeys = Object.keys(reviewChecklist) as [ReviewChecklistKey, ...ReviewChecklistKey[]];
export const ReviewChecklistKeySchema = z.enum(checklistKeys);
const Hash = z.string().regex(/^[0-9a-f]{64}$/u);
const CandidateId = z.string().regex(/^(?:mock|import)-[0-9a-f]{64}$/u);
const ActorId = z.string().regex(/^[a-z][a-z0-9-]{2,39}$/u);
export const ActorRoleSchema = z.enum(["AUTHOR", "REVIEWER", "PUBLISHER"]);
export const ActorStampSchema = z.object({ actorId: ActorId, role: ActorRoleSchema }).strict();
export type ActorStamp = z.infer<typeof ActorStampSchema>;
export const ReviewActorPolicySchema = z.object({
  mode: z.literal("LOCAL_OS_DEMO"),
  acknowledgedLocalTrust: z.literal(true),
  actors: z.array(z.object({ actorId: ActorId, roles: z.array(ActorRoleSchema).min(1).max(3) }).strict()).min(3).max(12),
}).strict().superRefine((policy, context) => {
  if (new Set(policy.actors.map((actor) => actor.actorId)).size !== policy.actors.length
    || policy.actors.some((actor) => new Set(actor.roles).size !== actor.roles.length)
    || ActorRoleSchema.options.some((role) => !policy.actors.some((actor) => actor.roles.includes(role)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unique explicit local actors must cover all three roles." });
  }
});
export type ReviewActorPolicy = z.infer<typeof ReviewActorPolicySchema>;

const lifecycle = z.enum(["DRAFT", "SAFETY_REVIEW", "APPROVED", "RUNTIME_ELIGIBLE"]);
export type ReviewLifecycle = z.infer<typeof lifecycle>;
const Text = z.string().trim().min(10).max(1500);
export const ChecklistDecisionSchema = z.object({
  decision: z.enum(["PASS", "FAIL", "NEEDS_REVISION", "NOT_APPLICABLE"]),
  reason: z.string().trim().max(1000),
}).strict();
export const WarningProposalSchema = z.object({
  ruleId: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/u),
  path: z.string().min(1).max(500),
  decision: z.enum(["ACCEPTED_WITH_JUSTIFICATION", "REQUIRES_CHANGES", "RESOLVED_IN_NEW_REVISION"]),
  rationale: Text,
}).strict();
const identity = {
  operationId: z.string().uuid(),
  expectedSequence: z.number().int().nonnegative(),
  candidateId: CandidateId,
  expectedContentHash: Hash,
  expectedState: lifecycle,
};
const reviewId = { reviewId: z.string().uuid() };
export const ReviewOperationSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("adopt"), evidence: z.object({ confirmed: z.literal(true) }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("submit"), evidence: z.object({ validation: AuthoringValidationResultSchema }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("start"), evidence: z.object(reviewId).strict() }).strict(),
  z.object({ ...identity, action: z.literal("checklist"), evidence: z.object({
    ...reviewId, items: z.record(ReviewChecklistKeySchema, ChecklistDecisionSchema),
  }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("warning"), evidence: z.object({ ...reviewId, warning: WarningProposalSchema }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("approve"), evidence: z.object({
    ...reviewId, confirmed: z.literal(true), notes: Text, decisionReason: Text,
  }).strict() }).strict(),
  z.object({ ...identity, action: z.enum(["reject", "request-changes"]), evidence: z.object({
    ...reviewId, confirmed: z.literal(true), reason: Text,
    failedItems: z.array(ReviewChecklistKeySchema).max(21),
    findingPaths: z.array(z.string().min(1).max(500)).max(80),
  }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("revise"), evidence: z.object({
    candidate: AuthoringCandidateSchema, revisionReason: Text,
  }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("publish"), evidence: z.object({
    approvalId: z.string().uuid(), confirmed: z.literal(true), target: z.enum(["current-real-conversation", "offline-adaptive"]),
  }).strict() }).strict(),
  z.object({ ...identity, action: z.literal("hold"), evidence: z.object({
    approvalId: z.string().uuid(), confirmed: z.literal(true), reason: Text,
  }).strict() }).strict(),
]);
export type ReviewOperation = z.infer<typeof ReviewOperationSchema>;
export type ReviewAction = ReviewOperation["action"];

const StampedChecklistSchema = ChecklistDecisionSchema.extend({
  actor: ActorStampSchema, at: z.string().datetime(), contentHash: Hash, reviewId: z.string().uuid(),
}).strict();
const StampedWarningSchema = WarningProposalSchema.extend({
  actor: ActorStampSchema, at: z.string().datetime(), contentHash: Hash, reviewId: z.string().uuid(),
}).strict();
export const ReviewRequestSchema = z.object({
  reviewId: z.string().uuid(),
  snapshotHash: Hash,
  snapshot: z.object({
    recordHash: Hash, contentHash: Hash, validation: AuthoringValidationResultSchema,
    submittedBy: ActorStampSchema, submittedAt: z.string().datetime(),
  }).strict(),
  startedBy: ActorStampSchema.nullable(),
  reviewStartedAt: z.string().datetime().nullable(),
  reviewCompletedAt: z.string().datetime().nullable(),
  checklist: z.record(ReviewChecklistKeySchema, StampedChecklistSchema),
  warnings: z.array(StampedWarningSchema).max(80),
  decision: z.enum(["pending", "approved", "rejected"]),
  notes: z.string().max(1500),
  decisionReason: z.string().max(1500),
  // Optional for the existing immutable journal; all new rejection/change decisions persist these references.
  decisionDetails: z.object({
    action: z.enum(["reject", "request-changes"]),
    failedItems: z.array(ReviewChecklistKeySchema).max(21),
    findingPaths: z.array(z.string().min(1).max(500)).max(80),
  }).strict().optional(),
}).strict();
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export const AuthoringApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  status: z.literal("APPROVED"), runtimeEligible: z.literal(false),
  candidateId: CandidateId, contentHash: Hash, snapshotHash: Hash,
  validationVersion: z.string().min(1), policyHash: Hash,
  reviewId: z.string().uuid(), reviewer: ActorStampSchema, approvedAt: z.string().datetime(),
  humanReview: ScenarioReviewSchema,
  record: SavedDraftSchema,
  artifactHash: Hash,
}).strict();
export type AuthoringApproval = z.infer<typeof AuthoringApprovalSchema>;

export const publicationReasons = [
  "RUNTIME_SCENARIO_UNREGISTERED", "LANGUAGE_UNSUPPORTED", "VOICE_NOT_VERIFIED",
  "TURN_POLICY_UNSUPPORTED", "PRESSURE_PROFILE_UNSUPPORTED", "REVIEWED_RUNTIME_PACKAGE_MISSING",
  "AUTHORING_GRAPH_NOT_RUNTIME_POLICY", "TERMINAL_MAPPING_NOT_INTEGRATED", "PUBLICATION_HELD", "VALIDATION_STALE",
  "OFFLINE_PROFILE_REQUIRED", "GRAPH_POLICY_MISMATCH", "RELEASE_VALIDATION_FAILED",
] as const;
const publicationIdentity = {
  publicationId: z.string().uuid(), approvalId: z.string().uuid(),
  actor: ActorStampSchema, requestedAt: z.string().datetime(),
};
export const PublicationAttemptSchema = z.discriminatedUnion("status", [z.object({
  ...publicationIdentity, status: z.literal("PUBLICATION_BLOCKED"),
  target: z.enum(["current-real-conversation", "offline-adaptive"]),
  compatibilityVersion: z.enum(["s01-real-conversation-v1", "offline-adaptive-v1"]),
  reasons: z.array(z.enum(publicationReasons)).min(1).max(10),
}).strict(), z.object({
  ...publicationIdentity, status: z.literal("PUBLISHED"), target: z.literal("offline-adaptive"),
  compatibilityVersion: z.literal("offline-adaptive-v1"), reasons: z.array(z.enum(publicationReasons)).length(0), release: RuntimeReleaseSchema,
}).strict()]);
export const ReviewItemSchema = z.object({
  record: SavedDraftSchema,
  author: ActorStampSchema,
  createdAt: z.string().datetime(),
  lifecycle: lifecycle,
  revisionReason: z.string().max(1500).nullable(),
  validation: AuthoringValidationResultSchema,
  review: ReviewRequestSchema.nullable(),
  approval: AuthoringApprovalSchema.nullable(),
  publications: z.array(PublicationAttemptSchema).max(32),
  publicationHold: z.object({ actor: ActorStampSchema, at: z.string().datetime(), reason: Text }).strict().nullable(),
}).strict();
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export const auditTypes = [
  "DRAFT_CREATED", "DRAFT_REVISED", "VALIDATION_COMPLETED", "REVIEW_SUBMITTED", "REVIEW_STARTED",
  "CHECKLIST_UPDATED", "WARNING_ACKNOWLEDGED", "CHANGES_REQUESTED", "REVIEW_REJECTED", "REVIEW_APPROVED",
  "PUBLICATION_REQUESTED", "PUBLICATION_BLOCKED", "SCENARIO_PUBLISHED", "PUBLICATION_HELD",
] as const;
export const ReviewAuditEventSchema = z.object({
  eventId: z.string().uuid(), sequence: z.number().int().positive(),
  type: z.enum(auditTypes), actor: ActorStampSchema, actorPolicyHash: Hash,
  candidateId: CandidateId, scenarioId: z.string().regex(/^S-\d{2}$/u), scenarioVersion: z.string().min(1).max(40),
  contentHash: Hash, before: lifecycle.nullable(), after: lifecycle,
  at: z.string().datetime(), reviewId: z.string().uuid().nullable(),
  approvalId: z.string().uuid().nullable(), publicationId: z.string().uuid().nullable(),
  reasonCode: z.enum(auditTypes), validationVersion: z.string(), policyHash: Hash.nullable(),
  previousEventHash: Hash.nullable(), eventHash: Hash,
}).strict();
export type ReviewAuditEvent = z.infer<typeof ReviewAuditEventSchema>;
export const ReviewCommitSchema = z.object({
  schemaVersion: z.literal(1), sequence: z.number().int().positive(),
  operationId: z.string().uuid(), requestHash: Hash, action: z.enum([
    "adopt", "submit", "start", "checklist", "warning", "approve", "reject", "request-changes", "revise", "publish", "hold",
  ]),
  expectedSequence: z.number().int().nonnegative(), sourceCandidateId: CandidateId,
  previousCommitHash: Hash.nullable(), actorPolicy: ReviewActorPolicySchema, item: ReviewItemSchema,
  audit: z.array(ReviewAuditEventSchema).min(1).max(3), commitHash: Hash,
}).strict();
export type ReviewCommit = z.infer<typeof ReviewCommitSchema>;
export const ReviewExportSchema = z.object({
  kind: z.literal("LOCAL_REVIEW_EXPORT"), schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(), sequence: z.number().int().nonnegative(),
  headHash: Hash.nullable(), item: ReviewItemSchema,
  lineage: z.array(SavedDraftSchema).max(32),
  history: z.array(z.object({
    candidateId: CandidateId, parentCandidateId: CandidateId.nullable(), scenarioVersion: z.string(),
    contentHash: Hash, authorId: ActorId, revisionReason: z.string().max(1500).nullable(),
    lifecycle: lifecycle, reviewDecision: z.enum(["pending", "approved", "rejected"]).nullable(),
    approvalId: z.string().uuid().nullable(), changedPaths: z.array(z.string()).max(256),
  }).strict()).max(128),
  audit: z.array(ReviewAuditEventSchema).max(768),
  exportHash: Hash,
}).strict();
export type ReviewExport = z.infer<typeof ReviewExportSchema>;

export const reviewErrors = {
  INVALID_REVIEW_REQUEST: "Use the documented review operation contract.",
  UNAUTHORIZED_ACTOR: "The configured local actor does not have the required role.",
  SELF_APPROVAL_BLOCKED: "Use a reviewer distinct from the draft author and a separate publisher.",
  INVALID_REVIEW_STATE: "The requested action is not valid in the current persisted lifecycle.",
  REVIEW_CONFLICT: "Reload the registry and prepare a request with the current sequence, state and hash.",
  IDEMPOTENCY_CONFLICT: "This operation ID already belongs to a different request or actor.",
  CANDIDATE_NOT_MANAGED: "Adopt this saved candidate through the local author workflow first.",
  VALIDATION_BLOCKED: "Fresh Phase 6B validation and storage integrity must pass before this action.",
  STALE_VALIDATION: "The submitted validation version or safety policy is stale. Create a fresh revision and review.",
  REVIEW_REQUIRED: "Select the exact submitted review and start it with an authorized reviewer.",
  CHECKLIST_INCOMPLETE: "Complete every checklist item and pass all critical checks before approval.",
  WARNING_DECISION_REQUIRED: "Address every current warning individually with a sufficient rationale.",
  REVISION_REQUIRED: "Create a new draft revision after rejection or a requires-changes decision.",
  UNSAFE_REVIEW_TEXT: "Remove sensitive values or contact data from review notes and rationale.",
  VERSION_CONFLICT: "This scenario version already exists. Choose a new version.",
  REGISTRY_CORRUPT: "Registry history or an immutable artifact failed integrity checks.",
  REVIEW_STORAGE_FAILED: "The atomic review operation was not committed.",
  LOCAL_POLICY_REQUIRED: "Configure explicit local demo actors before using privileged review commands.",
  PROTECTED_SCENARIO: "The review workflow cannot replace S-01, S-02 or S-03.",
  ALREADY_PUBLISHED: "This approved version already has a successful publication.",
} as const;
export class AuthoringReviewError extends Error {
  constructor(readonly code: keyof typeof reviewErrors) { super(reviewErrors[code]); this.name = "AuthoringReviewError"; }
}

export function parseReviewJson(bytes: Uint8Array) {
  try { return parseBoundedAuthoringJson(bytes, { maxBytes: reviewJsonLimit, maxDepth: 32, maxArray: 768, maxValues: 120_000 }); }
  catch { throw new AuthoringReviewError("INVALID_REVIEW_REQUEST"); }
}
export const warningIdentity = (warning: { ruleId: string; path: string }) => warning.ruleId + "@" + warning.path;

export function checklistAllowsApproval(checklist: ReviewRequest["checklist"]) {
  return checklistKeys.every((key) => {
    const entry = checklist[key];
    return entry?.decision === "PASS" || (!reviewChecklist[key].critical
      && entry?.decision === "NOT_APPLICABLE" && entry.reason.trim().length >= 10);
  });
}
export function warningAllowsApproval(review: ReviewRequest) {
  const warnings = review.snapshot.validation.findings.filter((finding) => finding.severity === "WARNING");
  return warnings.every((finding) => {
    const decision = review.warnings.find((entry) => warningIdentity(entry) === warningIdentity(finding));
    return decision?.decision === "ACCEPTED_WITH_JUSTIFICATION" && decision.rationale.trim().length >= 10
      && decision.contentHash === review.snapshot.contentHash && decision.reviewId === review.reviewId
      && decision.actor.actorId === review.startedBy?.actorId;
  });
}
export function legacyApprovalChecklist(checklist: ReviewRequest["checklist"]): ScenarioReviewChecklist {
  return {
    fictionalOrganization: checklist.fictionalOrganization?.decision === "PASS",
    syntheticDataOnly: checklist.syntheticDataOnly?.decision === "PASS",
    noSecurityBypassInstructions: checklist.noSecurityBypassInstructions?.decision === "PASS",
    safeEndingAvailable: checklist.safeEndingAvailable?.decision === "PASS",
    simulationLabelVisible: checklist.simulationLabelVisible?.decision === "PASS",
    aiVoiceDisclosureRequired: checklist.aiVoiceDisclosureRequired?.decision === "PASS",
    consentBeforeRecording: checklist.consentBeforeRecording?.decision === "PASS",
    noAudioRetentionByDefault: checklist.noAudioRetentionByDefault?.decision === "PASS",
  };
}

export function currentPublicationCompatibility(artifact: AuthoringApproval, held: boolean) {
  // These restrictions mirror current catalog/session entry points. No registry loader is installed in Phase 6C.
  const scenario = artifact.record.candidate.draft.scenario;
  const reasons: (typeof publicationReasons[number])[] = ["RUNTIME_SCENARIO_UNREGISTERED", "REVIEWED_RUNTIME_PACKAGE_MISSING", "AUTHORING_GRAPH_NOT_RUNTIME_POLICY", "TERMINAL_MAPPING_NOT_INTEGRATED"];
  if (scenario.language !== "hi-IN") reasons.push("LANGUAGE_UNSUPPORTED");
  if (scenario.voice_id === null) reasons.push("VOICE_NOT_VERIFIED");
  if (scenario.adaptive_policy?.max_turns !== 3) reasons.push("TURN_POLICY_UNSUPPORTED");
  if ((scenario.adaptive_policy?.max_pressure_level ?? 6) > 2) reasons.push("PRESSURE_PROFILE_UNSUPPORTED");
  if (held) reasons.push("PUBLICATION_HELD");
  return { compatibilityVersion: "s01-real-conversation-v1" as const, compatible: false as const, reasons };
}

export function reviewChangedPaths(before: unknown, after: unknown): string[] {
  const paths: string[] = [];
  function visit(a: unknown, b: unknown, path: string) {
    if (paths.length >= 256 || canonicalDraftJson(a) === canonicalDraftJson(b)) return;
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        visit(left[key], right[key], path + "/" + (/^[a-zA-Z0-9_.-]{1,80}$/u.test(key) ? key : "*"));
      }
    } else paths.push(path || "/");
  }
  visit(before, after, "");
  return paths;
}

export async function verifyReviewItem(item: ReviewItem, safety: ScenarioSafetyOptions) {
  try {
    const saved = parseSavedDraft(item.record, safety);
    const recordHash = await hashAuthoringData(saved);
    if (saved.contentHash !== await hashAuthoringData(saved.candidate)
      || item.author.role !== "AUTHOR" || ["S-01", "S-02", "S-03"].includes(saved.candidate.draft.scenario.scenario_id)) {
      throw new Error("identity");
    }
    const request = item.review;
    if (request) {
      if (request.snapshot.recordHash !== recordHash || request.snapshot.contentHash !== saved.contentHash
        || request.snapshotHash !== await hashAuthoringData(request.snapshot)
        || request.snapshot.submittedBy.role !== "AUTHOR" || request.snapshot.submittedBy.actorId !== item.author.actorId
        || request.snapshot.validation.sourceHash !== saved.contentHash || !request.snapshot.validation.reviewEligible
        || request.snapshot.validation.summary.errors !== 0) throw new Error("snapshot");
      if (request.startedBy && (request.startedBy.role !== "REVIEWER" || request.startedBy.actorId === item.author.actorId)) throw new Error("reviewer");
      if (Object.values(request.checklist).some((entry) => entry && (entry.actor.role !== "REVIEWER"
        || entry.actor.actorId !== request.startedBy?.actorId || entry.contentHash !== saved.contentHash || entry.reviewId !== request.reviewId))
        || request.warnings.some((entry) => entry.actor.role !== "REVIEWER" || entry.actor.actorId !== request.startedBy?.actorId
          || entry.contentHash !== saved.contentHash || entry.reviewId !== request.reviewId)) throw new Error("review attribution");
    }
    if (item.lifecycle === "SAFETY_REVIEW" && (!request || request.decision !== "pending" || item.approval)) throw new Error("review state");
    if (item.lifecycle === "DRAFT" && (item.approval || request?.decision === "approved")) throw new Error("draft state");
    if (item.lifecycle === "RUNTIME_ELIGIBLE") throw new Error("No compatible registry runtime target exists");
    if (item.lifecycle === "APPROVED") {
      const approval = item.approval;
      if (!approval || !request || request.decision !== "approved" || !checklistAllowsApproval(request.checklist)
        || !warningAllowsApproval(request) || approval.reviewId !== request.reviewId || approval.candidateId !== saved.candidateId
        || approval.contentHash !== saved.contentHash || approval.snapshotHash !== request.snapshotHash
        || !request.startedBy || approval.reviewer.role !== "REVIEWER" || approval.reviewer.actorId !== request.startedBy.actorId
        || approval.humanReview.decision !== "approved" || approval.humanReview.reviewerId !== approval.reviewer.actorId
        || approval.validationVersion !== request.snapshot.validation.validationVersion
        || approval.policyHash !== request.snapshot.validation.policyHash
        || canonicalDraftJson(approval.humanReview.checklist) !== canonicalDraftJson(legacyApprovalChecklist(request.checklist))
        || canonicalDraftJson(approval.record) !== canonicalDraftJson(saved)) throw new Error("approval");
      const { artifactHash, ...body } = approval;
      if (artifactHash !== await hashAuthoringData(body)) throw new Error("artifact");
    }
    if (item.publications.length && !item.approval) throw new Error("publication");
    if (item.publications.filter((publication) => publication.status === "PUBLISHED").length > 1) throw new Error("duplicate publication");
    for (const publication of item.publications) {
      if (!item.approval || publication.approvalId !== item.approval.approvalId || publication.actor.role !== "PUBLISHER"
        || [item.author.actorId, item.approval.reviewer.actorId].includes(publication.actor.actorId)) throw new Error("publication attribution");
      if (publication.status !== "PUBLISHED") continue;
      const { packageHash, ...release } = publication.release;
      if (packageHash !== await hashAuthoringData(release) || release.publicationId !== publication.publicationId
        || release.sourceCandidateId !== saved.candidateId || release.sourceContentHash !== saved.contentHash
        || release.approvalId !== item.approval.approvalId || release.reviewId !== item.approval.reviewId
        || release.approvalArtifactHash !== item.approval.artifactHash || release.policyHash !== item.approval.policyHash
        || release.validationVersion !== item.approval.validationVersion || release.scenario.scenario_id !== saved.candidate.draft.scenario.scenario_id
        || release.scenario.version !== saved.candidate.draft.scenario.version) throw new Error("publication linkage");
    }
  } catch { throw new AuthoringReviewError("REGISTRY_CORRUPT"); }
}

export async function verifyReviewExport(input: unknown, safety: ScenarioSafetyOptions): Promise<ReviewExport> {
  const parsed = ReviewExportSchema.safeParse(input);
  if (!parsed.success) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
  const view = parsed.data;
  const { exportHash, ...body } = view;
  if (exportHash !== await hashAuthoringData(body)) throw new AuthoringReviewError("REGISTRY_CORRUPT");
  await verifyReviewItem(view.item, safety);
  if (view.sequence < 1 || view.headHash === null || !view.history.some((entry) =>
    entry.candidateId === view.item.record.candidateId && entry.lifecycle === view.item.lifecycle
    && entry.contentHash === view.item.record.contentHash && entry.approvalId === (view.item.approval?.approvalId ?? null))) {
    throw new AuthoringReviewError("REGISTRY_CORRUPT");
  }
  if (view.item.approval && !view.audit.some((event) => event.type === "REVIEW_APPROVED"
    && event.candidateId === view.item.record.candidateId && event.approvalId === view.item.approval?.approvalId
    && event.actor.actorId === view.item.approval.reviewer.actorId)) throw new AuthoringReviewError("REGISTRY_CORRUPT");
  let previous: string | null = null, lastSequence = 0;
  for (const event of view.audit) {
    const { eventHash, ...content } = event;
    if (event.sequence <= lastSequence || event.previousEventHash !== previous || eventHash !== await hashAuthoringData(content)) {
      throw new AuthoringReviewError("REGISTRY_CORRUPT");
    }
    previous = eventHash; lastSequence = event.sequence;
  }
  return view;
}
