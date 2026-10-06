import assert from "node:assert/strict";
import test from "node:test";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { selectAdaptiveAction } from "./adaptivePolicy.js";

const scenario = validateScenarioDocument({
  scenario_id: "S-97", version: "1.0.0", language: "en", voice_id: "reviewed-voice",
  fictional_organization: { name: "Fictional Safety Circle", training_only: true }, simulation: true,
  opening_line: "This is a training simulation.", learning_objectives: ["Pause and verify."], red_flag_ids: ["RF-01"],
  responses: {
    calm: { text: "Please pause and verify independently.", safety_status: "reviewed_safe" },
    bounded: { text: "This remains a simulation; use a known official channel.", safety_status: "reviewed_safe" },
    "system.safe-fallback": { text: "End this simulation and independently verify.", safety_status: "system_safe_template" },
  },
  nodes: [{ id: "start", parent_node_id: null, trigger_rules: [], response_id: "calm", learner_expected_behavior: ["Verify independently."], next_node_id: null, safe_fallback_response_id: "system.safe-fallback", debrief_tags: ["RF-01"], safety_constraints: ["No personal data."], branch_status: "approved" }],
  adaptive_policy: {
    max_pressure_level: 1,
    max_turns: 3,
    safe_word: "stop simulation",
    escalation_behaviors: ["COMPLIED", "DISCLOSED_DUMMY_SECRET"],
    terminal_states: ["SAFE_WORD", "LEARNER_ENDED", "VERIFIED_INDEPENDENTLY", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"],
    tactics: [
      { tactic_id: "calm-check", pressure_level: 0, behavior_targets: ["UNKNOWN", "REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY"], response_ids: ["calm"] },
      { tactic_id: "bounded-follow-up", pressure_level: 1, behavior_targets: ["COMPLIED", "DISCLOSED_DUMMY_SECRET"], response_ids: ["bounded"] },
    ],
  },
  safety_metadata: {
    visible_simulation_label: true,
    ai_voice_disclosure_required: true,
    consent_before_recording: true,
    audio_retention: "none_by_default",
    dummy_data_mode: "synthetic_only",
    safe_ending_response_id: "system.safe-fallback",
  },
  safety_constraints: ["Simulation only."], review_status: "approved", reviewed_by: "reviewer", reviewed_at: "2026-10-06T00:00:00.000Z",
}) as ScenarioDocument;

function select(input: Partial<Parameters<typeof selectAdaptiveAction>[0]> = {}) {
  return selectAdaptiveAction({
    scenario,
    behavior: "UNKNOWN",
    turnNumber: 1,
    currentPressureLevel: 0,
    previousTacticIds: [],
    learnerText: "No mapped action.",
    ...input,
  });
}

test("approved tactic selection is deterministic and returns only scenario response content", () => {
  const action = select();
  assert.equal(action.tacticId, "calm-check");
  assert.equal(action.pressureLevel, 0);
  assert.equal(action.response.responseId, "calm");
  assert.equal(action.response.text, scenario.responses.calm?.text);
  assert.equal(action.response.safetyStatus, "reviewed_safe");
  assert.equal(action.terminalState, null);
});

test("escalation is bounded by max pressure and selects an approved response", () => {
  const action = select({ behavior: "COMPLIED", learnerText: "I will share it.", currentPressureLevel: 0 });
  assert.equal(action.tacticId, "bounded-follow-up");
  assert.equal(action.pressureLevel, 1);
  assert.equal(action.pressureLevel <= scenario.adaptive_policy!.max_pressure_level, true);
});

test("safe-word, independent verification, disclosure, max turns, and learner end use safe terminal paths", () => {
  assert.deepEqual([select({ learnerText: "STOP SIMULATION!" }).reason, select({ learnerText: "STOP SIMULATION!" }).terminalState], ["safe_word", "SAFE_WORD"]);
  assert.deepEqual([select({ behavior: "VERIFIED_INDEPENDENTLY" }).reason, select({ behavior: "VERIFIED_INDEPENDENTLY" }).terminalState], ["verified_independently", "VERIFIED_INDEPENDENTLY"]);
  assert.deepEqual([select({ behavior: "DISCLOSED_DUMMY_SECRET" }).reason, select({ behavior: "DISCLOSED_DUMMY_SECRET" }).terminalState], ["dummy_secret_disclosed", "DUMMY_SECRET_DISCLOSED"]);
  assert.deepEqual([select({ turnNumber: 3 }).reason, select({ turnNumber: 3 }).terminalState], ["max_turns", "MAX_TURNS"]);
  assert.deepEqual([select({ learnerEnded: true }).reason, select({ learnerEnded: true }).terminalState], ["learner_ended", "LEARNER_ENDED"]);
});

test("previous tactic and response history prevent loops and fall back safely", () => {
  const action = select({ previousTacticIds: ["calm-check", "bounded-follow-up"], previousResponseIds: ["calm", "bounded"], behavior: "COMPLIED" });
  assert.equal(action.tacticId, null);
  assert.equal(action.response.responseId, "system.safe-fallback");
  assert.equal(action.response.safetyStatus, "system_safe_template");
  assert.equal(action.terminalState, "SAFE_FALLBACK");
});

test("unapproved scenarios cannot enter their adaptive tactic pool", () => {
  const draftScenario = { ...scenario, review_status: "draft" as const, reviewed_by: null, reviewed_at: null };
  const action = select({ scenario: draftScenario });
  assert.equal(action.tacticId, null);
  assert.equal(action.response.responseId, "system.safe-fallback");
  assert.equal(action.response.approvalReference, "system-template:system.safe-fallback");
});
