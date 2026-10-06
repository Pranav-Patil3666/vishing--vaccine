import { BehaviorLabelSchema } from "@vaccine/contracts";
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

export const DraftScenarioPackageSchema = z.object({
  packageId: z.string().min(1),
  source: z.literal("offline_authoring"),
  target: EvonAuthoringTargetSchema,
  scenario: ScenarioDocumentSchema,
  candidateUtterances: z.array(BehaviorTrainingExampleSchema),
  importableArtifacts: z.array(ImportableScenarioArtifactSchema),
  review: ScenarioReviewSchema,
  runtimeEligible: z.literal(false),
}).strict().superRefine((draft, context) => {
  if (draft.scenario.review_status === "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenario", "review_status"], message: "A draft authoring package cannot claim runtime approval." });
  }
  if (draft.review.decision === "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review", "decision"], message: "Use ApprovedScenarioPackage after human approval." });
  }
});
export type DraftScenarioPackage = z.infer<typeof DraftScenarioPackageSchema>;

export const ApprovedScenarioPackageSchema = z.object({
  packageId: z.string().min(1),
  source: z.literal("offline_authoring"),
  target: EvonAuthoringTargetSchema,
  scenario: ScenarioDocumentSchema,
  candidateUtterances: z.array(BehaviorTrainingExampleSchema),
  importableArtifacts: z.array(ImportableScenarioArtifactSchema),
  review: ScenarioReviewSchema,
  runtimeEligible: z.literal(true),
}).strict().superRefine((approved, context) => {
  if (approved.scenario.review_status !== "approved" || approved.review.decision !== "approved") {
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

export function isRuntimeEligible(packageValue: DraftScenarioPackage | ApprovedScenarioPackage): boolean {
  return ApprovedScenarioPackageSchema.safeParse(packageValue).success;
}
