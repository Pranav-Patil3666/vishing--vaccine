import { BehaviorLabelSchema, ScenarioBriefSchema, TacticCategorySchema } from "@vaccine/contracts";
import { z } from "zod";
import { ScenarioDocumentSchema } from "./scenario.js";

export const ScenarioReviewChecklistSchema = z.object({
  fictionalOrganization: z.boolean(),
  syntheticDataOnly: z.boolean(),
  noSecurityBypassInstructions: z.boolean(),
  safeEndingAvailable: z.boolean(),
  simulationLabelVisible: z.boolean(),
  aiVoiceDisclosureRequired: z.boolean(),
  consentBeforeRecording: z.boolean(),
  noAudioRetentionByDefault: z.boolean(),
}).strict();
export type ScenarioReviewChecklist = z.infer<typeof ScenarioReviewChecklistSchema>;

export const ScenarioReviewSchema = z.object({
  decision: z.enum(["pending", "approved", "rejected"]),
  reviewerId: z.string().min(1).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  checklist: ScenarioReviewChecklistSchema,
  notes: z.array(z.string().max(500)),
}).strict().superRefine((review, context) => {
  if (review.decision !== "pending" && (review.reviewerId === null || review.reviewedAt === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewerId"], message: "Approval requires a named reviewer and review timestamp." });
  }
  if (review.decision === "pending" && (review.reviewerId !== null || review.reviewedAt !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewerId"], message: "Pending review cannot claim reviewer identity or timestamp." });
  }
  if (review.decision === "approved" && Object.values(review.checklist).some((passed) => !passed)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["checklist"], message: "Approval requires every safety checklist item to pass." });
  }
});

export const BehaviorTrainingExampleSchema = z.object({
  exampleId: z.string().min(1),
  utterance: z.string().min(1).max(1_000),
  language: z.enum(["en", "hi", "hi-en"]).default("en"),
  label: BehaviorLabelSchema,
  split: z.enum(["train", "validation", "held_out_test"]),
  source: z.enum(["synthetic", "consented_redacted"]),
  redactionReviewed: z.literal(true),
}).strict().superRefine((example, context) => {
  const hasCredentialValue = /\b(?:otp|pin|cvv|password)\s*(?:is|[:=])\s*\S+|\b\d{6,19}\b/i.test(example.utterance);
  if (hasCredentialValue) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["utterance"], message: "Training utterances must not contain credential values or long numeric identifiers." });
  }
});
export type BehaviorTrainingExample = z.infer<typeof BehaviorTrainingExampleSchema>;

export const CandidateTacticSchema = z.object({
  tacticId: z.string().min(1),
  category: TacticCategorySchema,
  pressureLevel: z.number().int().min(0).max(5),
  responseIds: z.array(z.string().min(1)).min(1),
  status: z.literal("DRAFT"),
}).strict();
export const ApprovedTacticSchema = z.object({ ...CandidateTacticSchema.shape, status: z.literal("APPROVED") }).strict();

export const CandidateApprovedResponseSchema = z.object({
  responseId: z.string().min(1),
  text: z.string().min(1),
  language: z.string().min(1),
  status: z.literal("DRAFT"),
}).strict();

export const DebriefTemplateVariantSchema = z.object({
  templateId: z.string().min(1),
  language: z.enum(["en", "hi", "hi-en"]),
  kind: z.enum(["safe", "risky", "unknown"]),
  text: z.string().min(1),
  status: z.literal("DRAFT"),
}).strict();

export const ImportableScenarioArtifactSchema = z.object({
  artifactId: z.string().min(1),
  format: z.literal("scenario-json"),
  scenario: ScenarioDocumentSchema,
}).strict();

export const EvonAuthoringTargetSchema = z.enum([
  "offline_pre_generated",
  "authorized_hosted_or_contest_route",
  "rented_gpu",
  "local_gpu_experimental",
]);

const authoringDraftFields = {
  packageId: z.string().min(1),
  source: z.literal("offline_authoring"),
  target: EvonAuthoringTargetSchema,
  scenarioBrief: ScenarioBriefSchema,
  scenario: ScenarioDocumentSchema,
  tacticPool: z.array(CandidateTacticSchema),
  candidateApprovedResponses: z.array(CandidateApprovedResponseSchema),
  behaviorTrainingExamples: z.array(BehaviorTrainingExampleSchema),
  debriefTemplateVariants: z.array(DebriefTemplateVariantSchema),
  candidateUtterances: z.array(BehaviorTrainingExampleSchema),
  importableArtifacts: z.array(ImportableScenarioArtifactSchema),
  review: ScenarioReviewSchema,
  runtimeEligible: z.literal(false),
};

export const DraftScenarioPackageSchema = z.object({
  ...authoringDraftFields,
  status: z.literal("DRAFT"),
}).strict().superRefine((draft, context) => {
  if (draft.scenarioBrief.scenarioId !== draft.scenario.scenario_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioBrief", "scenarioId"], message: "Scenario brief and draft content must share an identity." });
  }
  const scenarioResponseIds = new Set(Object.keys(draft.scenario.responses));
  for (const [index, tactic] of draft.tacticPool.entries()) {
    for (const responseId of tactic.responseIds) {
      if (!scenarioResponseIds.has(responseId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tacticPool", index, "responseIds"], message: `Candidate tactic references missing response ${responseId}.` });
    }
  }
  if (draft.scenario.lifecycle_status !== "DRAFT" || draft.scenario.review_status === "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenario", "review_status"], message: "A draft authoring package cannot claim runtime approval." });
  }
  if (draft.review.decision === "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review", "decision"], message: "Use ApprovedScenarioPackage after human approval." });
  }
});
export type DraftScenarioPackage = z.infer<typeof DraftScenarioPackageSchema>;

export const SafetyReviewScenarioPackageSchema = z.object({
  ...authoringDraftFields,
  status: z.literal("SAFETY_REVIEW"),
}).strict().superRefine((packageValue, context) => {
  if (packageValue.scenario.lifecycle_status !== "SAFETY_REVIEW" || packageValue.scenario.review_status !== "in_review") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenario", "lifecycle_status"], message: "Safety review requires the matching scenario lifecycle state." });
  }
  if (packageValue.review.decision !== "pending" || packageValue.runtimeEligible) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "Safety review remains pending and cannot enable runtime behavior." });
  }
});
export type SafetyReviewScenarioPackage = z.infer<typeof SafetyReviewScenarioPackageSchema>;

export const ApprovedScenarioPackageSchema = z.object({
  packageId: z.string().min(1),
  status: z.literal("RUNTIME_ELIGIBLE"),
  source: z.literal("offline_authoring"),
  target: EvonAuthoringTargetSchema,
  scenarioBrief: ScenarioBriefSchema,
  scenario: ScenarioDocumentSchema,
  tacticPool: z.array(ApprovedTacticSchema),
  candidateApprovedResponses: z.array(z.object({ ...CandidateApprovedResponseSchema.shape, status: z.literal("APPROVED") }).strict()),
  behaviorTrainingExamples: z.array(BehaviorTrainingExampleSchema),
  debriefTemplateVariants: z.array(z.object({ ...DebriefTemplateVariantSchema.shape, status: z.literal("APPROVED") }).strict()),
  candidateUtterances: z.array(BehaviorTrainingExampleSchema),
  importableArtifacts: z.array(ImportableScenarioArtifactSchema),
  review: ScenarioReviewSchema,
  runtimeEligible: z.literal(true),
}).strict().superRefine((approved, context) => {
  if (approved.scenario.review_status !== "approved" || approved.scenario.lifecycle_status !== "RUNTIME_ELIGIBLE" || approved.review.decision !== "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["runtimeEligible"], message: "Runtime eligibility requires an approved scenario and completed human approval." });
  }
  for (const [index, artifact] of approved.importableArtifacts.entries()) {
    if (artifact.scenario.scenario_id !== approved.scenario.scenario_id || artifact.scenario.version !== approved.scenario.version) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["importableArtifacts", index], message: "Importable artifact must match the reviewed scenario identity and version." });
    }
    if (artifact.scenario.review_status !== "approved") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["importableArtifacts", index, "scenario", "review_status"], message: "Importable runtime artifacts must be human-approved." });
    }
  }
});
export type ApprovedScenarioPackage = z.infer<typeof ApprovedScenarioPackageSchema>;

export const HumanApprovedScenarioPackageSchema = z.object({
  packageId: z.string().min(1),
  status: z.literal("APPROVED"),
  source: z.literal("offline_authoring"),
  target: EvonAuthoringTargetSchema,
  scenarioBrief: ScenarioBriefSchema,
  scenario: ScenarioDocumentSchema,
  tacticPool: z.array(ApprovedTacticSchema),
  candidateApprovedResponses: z.array(z.object({ ...CandidateApprovedResponseSchema.shape, status: z.literal("APPROVED") }).strict()),
  behaviorTrainingExamples: z.array(BehaviorTrainingExampleSchema),
  debriefTemplateVariants: z.array(z.object({ ...DebriefTemplateVariantSchema.shape, status: z.literal("APPROVED") }).strict()),
  candidateUtterances: z.array(BehaviorTrainingExampleSchema),
  importableArtifacts: z.array(ImportableScenarioArtifactSchema),
  review: ScenarioReviewSchema,
  runtimeEligible: z.literal(false),
}).strict().superRefine((packageValue, context) => {
  if (packageValue.scenario.review_status !== "approved" || packageValue.scenario.lifecycle_status !== "APPROVED" || packageValue.review.decision !== "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenario", "lifecycle_status"], message: "Human approval must be recorded before runtime eligibility can be considered." });
  }
});
export type HumanApprovedScenarioPackage = z.infer<typeof HumanApprovedScenarioPackageSchema>;

export function submitScenarioForSafetyReview(input: DraftScenarioPackage): SafetyReviewScenarioPackage {
  const draft = DraftScenarioPackageSchema.parse(input);
  const scenario = ScenarioDocumentSchema.parse({ ...draft.scenario, lifecycle_status: "SAFETY_REVIEW", review_status: "in_review" });
  return SafetyReviewScenarioPackageSchema.parse({
    ...draft,
    status: "SAFETY_REVIEW",
    scenario,
    importableArtifacts: draft.importableArtifacts.map((artifact) => ({ ...artifact, scenario })),
  });
}

/** Human approval is an explicit transition and does not itself enable runtime execution. */
export function approveDraftScenarioPackage(
  input: SafetyReviewScenarioPackage,
  approval: { reviewerId: string; reviewedAt: string; checklist: ScenarioReviewChecklist; notes?: string[] },
): HumanApprovedScenarioPackage {
  const draft = SafetyReviewScenarioPackageSchema.parse(input);
  const { reviewerId, reviewedAt } = approval;
  const approvedScenario = ScenarioDocumentSchema.parse({
    ...draft.scenario,
    lifecycle_status: "APPROVED",
    review_status: "approved",
    reviewed_by: reviewerId,
    reviewed_at: reviewedAt,
    nodes: draft.scenario.nodes.map((node) => ({ ...node, branch_status: "approved" })),
    responses: Object.fromEntries(Object.entries(draft.scenario.responses).map(([id, response]) => [
      id,
      response.safety_status === "system_safe_template" ? response : { ...response, safety_status: "reviewed_safe" },
    ])),
  });
  const review = ScenarioReviewSchema.parse({
    decision: "approved", reviewerId, reviewedAt,
    checklist: approval.checklist,
    notes: approval.notes ?? [],
  });
  const approvedCandidates = draft.candidateApprovedResponses.map((candidate) => ({ ...candidate, status: "APPROVED" as const }));
  const approvedTactics = draft.tacticPool.map((tactic) => ({ ...tactic, status: "APPROVED" as const }));
  const approvedTemplates = draft.debriefTemplateVariants.map((template) => ({ ...template, status: "APPROVED" as const }));
  return HumanApprovedScenarioPackageSchema.parse({
    ...draft, status: "APPROVED", scenario: approvedScenario,
    tacticPool: approvedTactics,
    candidateApprovedResponses: approvedCandidates,
    debriefTemplateVariants: approvedTemplates,
    importableArtifacts: draft.importableArtifacts.map((artifact) => ({ ...artifact, scenario: approvedScenario })),
    review, runtimeEligible: false,
  });
}

/** A separate explicit lifecycle transition marks a human-approved package eligible for normal runtime behavior. */
export function makeScenarioRuntimeEligible(input: HumanApprovedScenarioPackage): ApprovedScenarioPackage {
  const approved = HumanApprovedScenarioPackageSchema.parse(input);
  const runtimeScenario = ScenarioDocumentSchema.parse({ ...approved.scenario, lifecycle_status: "RUNTIME_ELIGIBLE" });
  return ApprovedScenarioPackageSchema.parse({
    ...approved,
    status: "RUNTIME_ELIGIBLE",
    scenario: runtimeScenario,
    importableArtifacts: approved.importableArtifacts.map((artifact) => ({ ...artifact, scenario: runtimeScenario })),
    runtimeEligible: true,
  });
}

export function isRuntimeEligible(packageValue: DraftScenarioPackage | SafetyReviewScenarioPackage | HumanApprovedScenarioPackage | ApprovedScenarioPackage): boolean {
  return ApprovedScenarioPackageSchema.safeParse(packageValue).success;
}

export function generateSyntheticBehaviorTrainingExamples(): BehaviorTrainingExample[] {
  const examples: Array<Omit<BehaviorTrainingExample, "exampleId">> = [
    { language: "en", utterance: "I will not share a code; I will verify through a known official channel.", label: "REFUSED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi", utterance: "मैं अभी जानकारी साझा नहीं करूंगा; पहले आधिकारिक माध्यम से सत्यापन करूंगा।", label: "REFUSED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi-en", utterance: "Main abhi details share nahi karunga; pehle official channel se verify karunga.", label: "REFUSED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "en", utterance: "I need more time before I decide.", label: "STALLED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi", utterance: "मुझे निर्णय लेने से पहले थोड़ा समय चाहिए।", label: "STALLED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi-en", utterance: "Mujhe decide karne se pehle thoda time chahiye.", label: "STALLED", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "en", utterance: "I agree to follow the instructions in this simulation.", label: "COMPLIED", split: "validation", source: "synthetic", redactionReviewed: true },
    { language: "hi", utterance: "मैं इस अभ्यास के निर्देश मानने के लिए सहमत हूं।", label: "COMPLIED", split: "validation", source: "synthetic", redactionReviewed: true },
    { language: "hi-en", utterance: "Main is practice ke instructions follow karne ke liye agree karta hoon.", label: "COMPLIED", split: "validation", source: "synthetic", redactionReviewed: true },
    { language: "en", utterance: "I will call back using a number I already know.", label: "VERIFIED_INDEPENDENTLY", split: "held_out_test", source: "synthetic", redactionReviewed: true },
    { language: "hi", utterance: "मैं पहले से ज्ञात आधिकारिक नंबर पर वापस कॉल करूंगा।", label: "VERIFIED_INDEPENDENTLY", split: "held_out_test", source: "synthetic", redactionReviewed: true },
    { language: "hi-en", utterance: "Main apne known official number par khud call back karke verify karunga.", label: "VERIFIED_INDEPENDENTLY", split: "held_out_test", source: "synthetic", redactionReviewed: true },
    { language: "en", utterance: "The practice token is SYNTHETIC-SECRET-EXAMPLE.", label: "DISCLOSED_DUMMY_SECRET", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi", utterance: "अभ्यास का नकली टोकन SYNTHETIC-SECRET-EXAMPLE है।", label: "DISCLOSED_DUMMY_SECRET", split: "train", source: "synthetic", redactionReviewed: true },
    { language: "hi-en", utterance: "Practice ka synthetic token SYNTHETIC-SECRET-EXAMPLE hai.", label: "DISCLOSED_DUMMY_SECRET", split: "train", source: "synthetic", redactionReviewed: true },
  ];
  return examples.map((example, index) => BehaviorTrainingExampleSchema.parse({ exampleId: `synthetic-behavior-${index + 1}`, ...example }));
}
