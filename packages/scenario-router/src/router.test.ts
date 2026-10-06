import assert from "node:assert/strict";
import test from "node:test";
import { routeTranscript } from "./router.js";
import type { ScenarioDocument } from "@vaccine/scenario-schema";

const scenario: ScenarioDocument = {
  scenario_id: "S-99",
  version: "0.1.0",
  language: "en",
  voice_id: "test-only",
  fictional_organization: { name: "Example Fictional Cooperative", training_only: true },
  simulation: true,
  opening_line: "This is a training simulation.",
  learning_objectives: ["Pause and verify."],
  red_flag_ids: ["RF-01"],
  responses: {
    opening: { text: "This is a training simulation.", safety_status: "reviewed_safe" },
    safe: { text: "Thank you for choosing to verify independently.", safety_status: "reviewed_safe" },
    "system.safe-fallback": { text: "End this simulation and independently verify any claim.", safety_status: "system_safe_template" },
  },
  nodes: [
    {
      id: "start",
      parent_node_id: null,
      trigger_rules: [],
      response_id: "opening",
      learner_expected_behavior: ["Pause."],
      next_node_id: null,
      safe_fallback_response_id: "system.safe-fallback",
      debrief_tags: ["RF-01"],
      safety_constraints: ["Training only."],
      branch_status: "approved",
    },
    {
      id: "independent-verification",
      parent_node_id: "start",
      trigger_rules: [{ type: "exact_phrase", phrases: ["I will call back"] }],
      response_id: "safe",
      learner_expected_behavior: ["Verify independently."],
      next_node_id: null,
      safe_fallback_response_id: "system.safe-fallback",
      debrief_tags: ["RF-01"],
      safety_constraints: ["Training only."],
      branch_status: "approved",
    },
    {
      id: "refusal",
      parent_node_id: "start",
      trigger_rules: [{ type: "keyword", keywords: ["no", "share"], mode: "all" }],
      response_id: "safe",
      learner_expected_behavior: ["Decline to share secrets."],
      next_node_id: null,
      safe_fallback_response_id: "system.safe-fallback",
      debrief_tags: ["RF-05"],
      safety_constraints: ["Training only."],
      branch_status: "approved",
    },
  ],
  safety_constraints: ["Training only."],
  review_status: "approved",
  reviewed_by: "human-reviewer",
  reviewed_at: "2026-10-06T00:00:00.000Z",
};

test("router deterministically selects the first matching approved branch", () => {
  const one = routeTranscript(scenario, "start", "I will call back!");
  const two = routeTranscript(scenario, "start", "I will call back!");
  assert.deepEqual(one, two);
  assert.equal(one.branchId, "independent-verification");
  assert.equal(one.responseId, "safe");
});

test("keyword routing is normalized and case insensitive", () => {
  const result = routeTranscript(scenario, "start", "NO,   I will not share");
  assert.equal(result.branchId, "refusal");
});

test("unknown transcript and unmatched input resolve to configured safe fallback", () => {
  assert.equal(routeTranscript(scenario, "start", null).responseId, "system.safe-fallback");
  assert.equal(routeTranscript(scenario, "start", "Tell me about the weather").responseId, "system.safe-fallback");
});

test("draft scenarios cannot activate draft branches", () => {
  const draft = { ...scenario, review_status: "draft" as const };
  assert.equal(routeTranscript(draft, "start", "I will call back").reason, "scenario-not-approved");
});

test("unknown state does not invent a response", () => {
  assert.deepEqual(routeTranscript(scenario, "missing", "hello"), {
    branchId: null,
    responseId: "system.safe-fallback",
    nextNodeId: null,
    matched: false,
    reason: "unknown-node",
  });
});
