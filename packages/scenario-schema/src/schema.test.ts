import assert from "node:assert/strict";
import test from "node:test";
import type { ScenarioDocument } from "./scenario.js";
import { ScenarioDocumentSchema, validateScenarioDocument, validateScenarioForRelease } from "./scenario.js";
import { validateScenarioSafety } from "./safety.js";

const safeScenario: ScenarioDocument = {
  scenario_id: "S-99",
  version: "0.1.0",
  language: "en",
  voice_id: "test-only",
  fictional_organization: { name: "Example Fictional Cooperative", training_only: true },
  simulation: true,
  opening_line: "This is a clearly labeled training simulation.",
  learning_objectives: ["Pause and verify claims through an independently chosen channel."],
  red_flag_ids: ["RF-01"],
  responses: {
    opening: { text: "This is a training simulation.", safety_status: "reviewed_safe" },
    "system.safe-fallback": { text: "End this simulation and independently verify any claim.", safety_status: "system_safe_template" },
  },
  nodes: [
    {
      id: "start",
      parent_node_id: null,
      trigger_rules: [],
      response_id: "opening",
      learner_expected_behavior: ["Pause and verify independently."],
      next_node_id: null,
      safe_fallback_response_id: "system.safe-fallback",
      debrief_tags: ["RF-01"],
      safety_constraints: ["Never request personal or financial data."],
      branch_status: "approved",
    },
  ],
  safety_constraints: ["Training simulation only; never collect credentials."],
  review_status: "approved",
  reviewed_by: "human-reviewer",
  reviewed_at: "2026-10-06T00:00:00.000Z",
};

test("scenario schema accepts a complete structurally valid tree", () => {
  assert.equal(validateScenarioDocument(safeScenario).scenario_id, "S-99");
});

test("scenario schema rejects an unknown next-node reference", () => {
  const invalid = structuredClone(safeScenario);
  const firstNode = invalid.nodes.at(0);
  assert.ok(firstNode);
  firstNode.next_node_id = "missing-node";
  assert.equal(ScenarioDocumentSchema.safeParse(invalid).success, false);
});

test("scenario schema rejects a missing safe fallback", () => {
  const invalid = structuredClone(safeScenario);
  const firstNode = invalid.nodes.at(0);
  assert.ok(firstNode);
  firstNode.safe_fallback_response_id = "missing-response";
  assert.equal(ScenarioDocumentSchema.safeParse(invalid).success, false);
});

test("scenario schema rejects a missing system-safe response", () => {
  const invalid = structuredClone(safeScenario);
  delete invalid.responses["system.safe-fallback"];
  assert.equal(ScenarioDocumentSchema.safeParse(invalid).success, false);
});

test("release validation rejects draft placeholders", () => {
  const draft = structuredClone(safeScenario);
  draft.review_status = "draft";
  draft.reviewed_by = null;
  draft.reviewed_at = null;
  assert.throws(() => validateScenarioForRelease(draft), /not approved/);
});

test("regex rules reject malformed and potentially unsafe patterns", () => {
  const invalid = structuredClone(safeScenario);
  invalid.nodes.push({
    id: "child",
    parent_node_id: "start",
    trigger_rules: [{ type: "regex", pattern: "(a+)+$" }],
    response_id: "opening",
    learner_expected_behavior: ["Pause."],
    next_node_id: null,
    safe_fallback_response_id: "fallback",
    debrief_tags: ["RF-01"],
    safety_constraints: ["Training only."],
    branch_status: "approved",
  });
  assert.equal(ScenarioDocumentSchema.safeParse(invalid).success, false);
});

test("safety scan fails closed for configured real entities and numeric credentials", () => {
  const safe = validateScenarioSafety(safeScenario, {
    knownRealOrganizations: ["Real Example Bank"],
    forbiddenOperationalPhrases: ["disable verification"],
  });
  assert.equal(safe.passed, true);

  const unsafe = structuredClone(safeScenario);
  unsafe.opening_line = "Read your OTP: 123456";
  const result = validateScenarioSafety(unsafe, {
    knownRealOrganizations: ["Real Example Bank"],
    forbiddenOperationalPhrases: ["disable verification"],
  });
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "credential_pattern_detected"));
});

test("safety scan reports incomplete detection coverage as a failure", () => {
  const result = validateScenarioSafety(safeScenario);
  assert.equal(result.passed, false);
  assert.equal(result.coverage, "incomplete");
});
