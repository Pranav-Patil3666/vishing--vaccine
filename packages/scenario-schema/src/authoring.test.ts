import assert from "node:assert/strict";
import test from "node:test";
import {
  ApprovedScenarioPackageSchema,
  BehaviorTrainingExampleSchema,
  DraftScenarioPackageSchema,
  isRuntimeEligible,
} from "./authoring.js";
import { ScenarioDocumentSchema } from "./scenario.js";

const scenarioBase = {
  scenario_id: "S-98",
  version: "0.2.0",
  language: "en",
  voice_id: "reviewed-voice",
  fictional_organization: { name: "Fictional Learning Circle", training_only: true },
  simulation: true,
  opening_line: "This is a training simulation.",
  learning_objectives: ["Pause and independently verify."],
  red_flag_ids: ["RF-01"],
  responses: {
    opening: { text: "This is a training simulation.", safety_status: "reviewed_safe" },
    "system.safe-fallback": { text: "End this simulation and independently verify.", safety_status: "system_safe_template" },
  },
  nodes: [{
    id: "start", parent_node_id: null, trigger_rules: [], response_id: "opening",
    learner_expected_behavior: ["Verify independently."], next_node_id: null,
    safe_fallback_response_id: "system.safe-fallback", debrief_tags: ["RF-01"],
    safety_constraints: ["No personal data."], branch_status: "draft" as string,
  }],
  safety_constraints: ["Simulation only."],
  review_status: "draft" as string,
  reviewed_by: null as string | null,
  reviewed_at: null as string | null,
};

const safetyChecklist = {
  fictionalOrganization: true,
  syntheticDataOnly: true,
  noSecurityBypassInstructions: true,
  safeEndingAvailable: true,
  simulationLabelVisible: true,
  aiVoiceDisclosureRequired: true,
  consentBeforeRecording: true,
  noAudioRetentionByDefault: true,
};

function draftScenario() {
  return ScenarioDocumentSchema.parse(structuredClone(scenarioBase));
}

function approvedScenario() {
  const scenario = structuredClone(scenarioBase);
  scenario.review_status = "approved";
  scenario.reviewed_by = "human-reviewer";
  scenario.reviewed_at = "2026-10-06T00:00:00.000Z";
  scenario.nodes[0]!.branch_status = "approved";
  return ScenarioDocumentSchema.parse(scenario);
}

const trainingExample = {
  exampleId: "example-1",
  utterance: "I will pause and verify through a known channel.",
  label: "VERIFIED_INDEPENDENTLY",
  split: "train",
  source: "synthetic",
  redactionReviewed: true,
} as const;

test("offline draft packages and generated JSON artifacts stay ineligible for runtime", () => {
  const scenario = draftScenario();
  const result = DraftScenarioPackageSchema.parse({
    packageId: "draft-1", source: "offline_authoring", target: "offline_pre_generated", scenario,
    candidateUtterances: [trainingExample],
    importableArtifacts: [{ artifactId: "artifact-1", format: "scenario-json", scenario }],
    review: { decision: "pending", reviewerId: null, reviewedAt: null, checklist: { ...safetyChecklist, safeEndingAvailable: false }, notes: [] },
    runtimeEligible: false,
  });
  assert.equal(result.runtimeEligible, false);
  assert.equal(isRuntimeEligible(result), false);
});

test("human review and matching approved artifact are both required for runtime eligibility", () => {
  const scenario = approvedScenario();
  const result = ApprovedScenarioPackageSchema.parse({
    packageId: "approved-1", source: "offline_authoring", target: "offline_pre_generated", scenario,
    candidateUtterances: [trainingExample],
    importableArtifacts: [{ artifactId: "artifact-1", format: "scenario-json", scenario }],
    review: { decision: "approved", reviewerId: "reviewer-1", reviewedAt: "2026-10-06T00:00:00.000Z", checklist: safetyChecklist, notes: [] },
    runtimeEligible: true,
  });
  assert.equal(result.runtimeEligible, true);
  assert.equal(isRuntimeEligible(result), true);

  const invalidReview = structuredClone(result);
  invalidReview.review.checklist.noAudioRetentionByDefault = false;
  assert.equal(ApprovedScenarioPackageSchema.safeParse(invalidReview).success, false);
  const mismatchedArtifact = structuredClone(result);
  mismatchedArtifact.importableArtifacts[0]!.scenario.version = "other";
  assert.equal(ApprovedScenarioPackageSchema.safeParse(mismatchedArtifact).success, false);
});

test("behavior training examples require a data split and reject unredacted credential values", () => {
  assert.equal(BehaviorTrainingExampleSchema.safeParse(trainingExample).success, true);
  assert.equal(BehaviorTrainingExampleSchema.safeParse({ ...trainingExample, split: "held_out_test" }).success, true);
  assert.equal(BehaviorTrainingExampleSchema.safeParse({ ...trainingExample, utterance: "The password is private-value." }).success, false);
});
