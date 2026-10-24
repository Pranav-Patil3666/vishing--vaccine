import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BehaviorLabelSchema, SessionTerminalStateSchema, type BehaviorLabel } from "@vaccine/contracts";
import { ApprovedScenarioPackageSchema, isScenarioRuntimeEligible, validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { AdaptivePolicyEngine, ApprovedResponseResolver, selectAdaptiveAction, validatePolicyTransition, type AdaptivePolicyAction, type AdaptivePolicyInput } from "./adaptivePolicy.js";
import { ApplicationError } from "./errors.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const scenario = freeze(validateScenarioDocument(JSON.parse(readFileSync("content/scenarios/S-01-urgent-account-verification.json", "utf8"))));
const engine = new AdaptivePolicyEngine(), resolver = new ApprovedResponseResolver();
const behaviors = BehaviorLabelSchema.options;
const tacticIds = ["urgency", "authority", "isolation", "fear", "reward"];

function input(stage = 0, behavior: BehaviorLabel = "STALLED"): AdaptivePolicyInput {
  const history = ["authority", "fear"].slice(0, stage);
  return { scenario, behavior, turnNumber: stage + 1, currentPressureLevel: stage ? 1 : 0,
    previousTacticIds: history, previousResponseIds: [...history], learnerText: "", runtimeAllowed: true,
    sessionState: { scenarioId: "S-01", scenarioVersion: "0.2.0", currentNodeId: "start", turnNumber: stage, state: "ROUTING",
      terminalState: null, currentTacticId: history.at(-1) ?? null, currentResponseId: history.at(-1) ?? "system.opening" } };
}
function typed(code: string) { return (error: unknown) => { assert.ok(error instanceof ApplicationError); assert.equal(error.code, code); return true; }; }
function stateless(value: AdaptivePolicyInput): AdaptivePolicyInput { const preview = { ...value }; delete preview.sessionState; return preview; }
function check(value: AdaptivePolicyInput, action: AdaptivePolicyAction) {
  assert.ok(Number.isInteger(action.pressureLevel)); assert.equal(action.pressureLevel, action.nextPressureLevel);
  assert.ok([0, 1].includes(action.nextPressureLevel)); assert.ok(action.nextPressureLevel <= scenario.adaptive_policy!.max_pressure_level);
  const resolved = resolver.resolve({ scenario: value.scenario, language: "hi-IN", action });
  assert.deepEqual(resolved, action.response); assert.equal(resolved.scenarioId, "S-01"); assert.equal(resolved.scenarioVersion, "0.2.0");
  assert.ok(resolved.text.trim()); assert.equal(resolved.text, scenario.responses[action.responseId]!.text);
  if (action.terminalState) {
    assert.ok(scenario.adaptive_policy!.terminal_states.includes(action.terminalState));
    assert.equal(action.tacticId, null); assert.equal(action.tacticCategory, null);
    assert.ok(action.nextPressureLevel <= value.currentPressureLevel);
    assert.equal(resolved.safetyStatus, "system_safe_template");
  } else {
    assert.equal(action.decisionCode, "SELECTED_TACTIC"); assert.ok(tacticIds.includes(action.tacticId!));
    const tactic = scenario.adaptive_policy!.tactics.find((candidate) => candidate.tactic_id === action.tacticId)!;
    assert.ok(tactic.response_ids.includes(action.responseId)); assert.equal(tactic.pressure_level, action.nextPressureLevel);
    assert.equal(tactic.category, action.tacticCategory); assert.equal(resolved.safetyStatus, "reviewed_safe");
    assert.equal(resolved.approvalReference, `S-01@0.2.0:${action.responseId}`);
  }
  assert.equal(value.sessionState!.currentNodeId, "start", "adaptive pool selection retains the existing node; no invented next node");
}

for (const stage of [0, 1, 2]) for (const behavior of behaviors) test(`S-01 turn ${stage + 1}: ${behavior} has its exact approved transition`, () => {
  const value = freeze(input(stage, behavior)), before = JSON.stringify(value), action = engine.decide(value);
  const outcome = behavior === "VERIFIED_INDEPENDENTLY" ? "SAFE_VERIFIED" : behavior === "DISCLOSED_DUMMY_SECRET" ? "DUMMY_SECRET_DISCLOSED"
    : stage === 2 ? "MAX_TURNS" : behavior === "UNKNOWN" ? "SAFE_FALLBACK" : null;
  const tactic = outcome ? null : stage === 0 ? "authority" : "fear";
  const responseId = outcome === "SAFE_FALLBACK" ? "system.safe-fallback" : outcome ? "system.safe-ending" : tactic;
  assert.equal(action.terminalState, outcome); assert.equal(action.terminalState !== null, outcome !== null);
  assert.equal(action.decisionCode, outcome === "SAFE_FALLBACK" ? "NO_APPROVED_TACTIC" : outcome ?? "SELECTED_TACTIC");
  assert.equal(action.tacticId, tactic); assert.equal(action.responseId, responseId);
  assert.equal(action.nextPressureLevel, outcome ? (stage ? 1 : 0) : 1);
  check(value, action); assert.equal(JSON.stringify(value), before);
});

test("all reachable behavior prefixes through three turns resolve once, terminate within bounds and cannot re-enter policy", () => {
  let decisions = 0, terminals = 0;
  const visit = (base: AdaptivePolicyInput) => {
    for (const behavior of behaviors) {
      const value = freeze({ ...base, behavior }), action = engine.decide(value); decisions++; check(value, action);
      const next: AdaptivePolicyInput = { ...value, turnNumber: value.turnNumber + 1, currentPressureLevel: action.nextPressureLevel,
        previousTacticIds: action.tacticId ? [...value.previousTacticIds, action.tacticId] : [...value.previousTacticIds],
        previousResponseIds: [...value.previousResponseIds!, action.responseId],
        sessionState: { ...value.sessionState!, turnNumber: value.turnNumber, terminalState: action.terminalState,
          currentTacticId: action.tacticId, currentResponseId: action.responseId, state: "PLAYING_RESPONSE" } };
      if (action.terminalState) { terminals++; assert.throws(() => engine.decide(next), typed("INVALID_STATE")); }
      else { assert.ok(value.turnNumber < 3); visit(next); }
    }
  };
  visit(input()); assert.equal(decisions, 78); assert.equal(terminals, 66);
});

test("canonical release, approval package and policy pool cannot drift independently", () => {
  const approved = ApprovedScenarioPackageSchema.parse(JSON.parse(readFileSync("content/authoring/S-01-hi-IN.package.json", "utf8")));
  assert.deepEqual(scenario, approved.scenario); assert.equal(approved.runtimeEligible, true); assert.equal(isScenarioRuntimeEligible(scenario), true);
  assert.equal(scenario.version, "0.2.0"); assert.equal(scenario.language, "hi-IN"); assert.equal(scenario.nodes.length, 1);
  assert.deepEqual(behaviors, ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY", "COMPLIED", "DISCLOSED_DUMMY_SECRET", "UNKNOWN"]);
  assert.deepEqual(scenario.adaptive_policy!.tactics.map((tactic) => tactic.tactic_id), tacticIds);
  assert.equal(scenario.adaptive_policy!.max_pressure_level, 2); assert.equal(scenario.adaptive_policy!.max_turns, 3);
  assert.deepEqual(scenario.adaptive_policy!.escalation_behaviors, ["COMPLIED"]);
  assert.deepEqual(scenario.adaptive_policy!.terminal_states, ["SAFE_WORD", "LEARNER_ENDED", "SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS", "SAFE_FALLBACK"]);
  const categories = ["URGENCY", "AUTHORITY", "ISOLATION", "FEAR_CONSEQUENCE", "REWARD_FAKE_HELP"];
  assert.deepEqual(scenario.adaptive_policy!.tactics.map((tactic) => tactic.category), categories);
  for (const tactic of scenario.adaptive_policy!.tactics) {
    assert.equal(tactic.pressure_level, 1); assert.deepEqual(tactic.response_ids, [tactic.tactic_id]);
    assert.deepEqual(tactic.behavior_targets, ["REFUSED", "STALLED", "COMPLIED"]);
    assert.equal(scenario.responses[tactic.tactic_id]!.safety_status, "reviewed_safe");
  }
  assert.equal(scenario.safety_metadata!.safe_ending_response_id, "system.safe-ending");
  for (const id of ["system.safe-ending", "system.safe-fallback"]) assert.equal(scenario.responses[id]!.safety_status, "system_safe_template");
});

test("all five authored tactics resolve when earlier candidates are excluded, without introducing new tactic strings", () => {
  const order = ["authority", "fear", "isolation", "reward", "urgency"];
  for (const [index, tacticId] of order.entries()) {
    // Stateless pool coverage, not a claim that five tactics are reachable in the bounded three-turn session.
    const value = stateless({ ...input(), previousTacticIds: order.slice(0, index), previousResponseIds: order.slice(0, index) });
    const action = engine.decide(value); assert.equal(action.tacticId, tacticId); assert.equal(action.responseId, tacticId);
    assert.equal(resolver.resolve({ scenario, language: "hi-IN", action }).safetyStatus, "reviewed_safe");
  }
});

test("known 4C.3 STALLED → authority → VERIFIED_INDEPENDENTLY → safe ending path remains exact", () => {
  const first = engine.decide(input(0, "STALLED")); assert.equal(first.responseId, "authority"); assert.equal(first.nextPressureLevel, 1);
  const second = engine.decide(input(1, "VERIFIED_INDEPENDENTLY")); check(input(1, "VERIFIED_INDEPENDENTLY"), second);
  assert.equal(second.terminalState, "SAFE_VERIFIED"); assert.equal(second.responseId, "system.safe-ending"); assert.equal(second.nextPressureLevel, 1);
});

test("identical frozen inputs repeat exactly, with no provider, randomness, clock or input side effects", (context) => {
  const forbidden = () => assert.fail("Policy attempted an external/random/time dependency");
  context.mock.method(globalThis, "fetch", forbidden); context.mock.method(Math, "random", forbidden); context.mock.method(Date, "now", forbidden);
  for (const behavior of behaviors) {
    const value = freeze(input(0, behavior)), before = JSON.stringify(value), expected = engine.decide(value);
    for (let repeat = 0; repeat < 20; repeat++) assert.deepEqual(engine.decide(value), expected);
    assert.equal(JSON.stringify(value), before);
  }
  const source = readFileSync("apps/api/src/adaptivePolicy.ts", "utf8");
  assert.doesNotMatch(source, /from ["'](?:node:|.*(?:providers|credit|cache|classifier|eventLog))/u);
});

test("policy trusts the supplied behavior rather than reclassifying transcript, dummy-token or emotion wording", () => {
  for (const text of ["Main independently verify karunga", "DUMMY-4821", "थोड़ा समय चाहिए", "afraid nervous confused", "unrelated content"]) {
    assert.deepEqual(engine.decide({ ...input(), learnerText: text }), engine.decide(input()));
  }
  assert.notEqual(engine.decide(input(0, "COMPLIED")).terminalState, "DUMMY_SECRET_DISCLOSED");
  assert.equal(engine.decide(input(0, "DISCLOSED_DUMMY_SECRET")).terminalState, "DUMMY_SECRET_DISCLOSED");
  assert.notEqual(engine.decide(input(0, "UNKNOWN")).decisionCode, engine.decide(input(0, "REFUSED")).decisionCode);
});

test("existing explicit safe-word and learner-end safety overrides remain terminal without semantic reclassification", () => {
  for (const value of [{ ...input(), safeWordDetected: true }, { ...input(), learnerText: "please stop simulation now" }]) {
    const action = engine.decide(value); assert.equal(action.terminalState, "SAFE_WORD"); assert.equal(action.responseId, "system.safe-ending"); assert.equal(action.tacticId, null);
  }
  assert.equal(engine.decide({ ...input(), learnerEnded: true }).terminalState, "LEARNER_ENDED");
});

for (const behavior of ["SAFE", "UNSAFE", "CONFUSED", "stalled", null]) test(`invalid behavior ${String(behavior)} is rejected at runtime`, () => {
  assert.throws(() => selectAdaptiveAction({ ...input(), behavior } as unknown as AdaptivePolicyInput), typed("INVALID_REQUEST"));
});
for (const turn of [-1, 0, 1.5, NaN, Infinity, 4]) test(`invalid/prohibited turn ${turn} cannot select caller content`, () => {
  assert.throws(() => engine.decide({ ...input(), turnNumber: turn }), typed(turn === 4 ? "INVALID_STATE" : "INVALID_REQUEST"));
});
for (const pressure of [-1, 0.5, 3, 4, 5, NaN, Infinity]) test(`unsupported input pressure ${pressure} cannot enter S-01 runtime policy`, () => {
  assert.throws(() => engine.decide({ ...input(), currentPressureLevel: pressure }), typed("INVALID_STATE"));
});
for (const terminalState of SessionTerminalStateSchema.options) test(`already terminal ${terminalState} cannot produce another policy response`, () => {
  for (const behavior of behaviors) assert.throws(() => engine.decide({ ...input(1, behavior), sessionState: { ...input(1).sessionState!, terminalState } }), typed("INVALID_STATE"));
});
for (const [name, change] of [
  ["node", { currentNodeId: "missing" }], ["scenario", { scenarioId: "S-02" }], ["version", { scenarioVersion: "0.1.0" }],
  ["turn identity", { turnNumber: 2 }], ["tactic", { currentTacticId: "missing" }],
  ["response", { currentResponseId: "fear" }], ["completed lifecycle", { state: "COMPLETED" }], ["ended lifecycle", { state: "ENDED_BY_LEARNER" }], ["error lifecycle", { state: "ERROR" }],
] as const) test(`invalid session ${name} is rejected instead of inventing a transition`, () => {
  assert.throws(() => engine.decide({ ...input(1), sessionState: { ...input(1).sessionState!, ...change } }), typed("INVALID_STATE"));
});
test("contextual pressure must match the active tactic/root, including the configured but unauthored pressure two", () => {
  assert.throws(() => engine.decide({ ...input(1), currentPressureLevel: 2 }), typed("INVALID_STATE"));
  assert.throws(() => engine.decide({ ...input(), currentPressureLevel: 1 }), typed("INVALID_STATE"));
});
for (const change of [{ previousTacticIds: ["typo"] }, { previousResponseIds: ["missing"] }]) test("unknown history references fail safely", () => {
  assert.throws(() => engine.decide({ ...input(), ...change }), typed("INVALID_STATE"));
});
test("completed-turn history cannot contradict the active session tactic/response", () => {
  for (const change of [{ previousTacticIds: [] }, { previousResponseIds: [] }, { previousResponseIds: ["fear"] }]) {
    assert.throws(() => engine.decide({ ...input(1), ...change }), typed("INVALID_STATE"));
  }
});

for (const [name, mutate] of [
  ["missing tactic response", (s: ScenarioDocument) => { delete s.responses.authority; }],
  ["draft tactic response", (s: ScenarioDocument) => { s.responses.authority!.safety_status = "draft"; }],
  ["missing ending", (s: ScenarioDocument) => { delete s.responses["system.safe-ending"]; }],
  ["draft ending", (s: ScenarioDocument) => { s.responses["system.safe-ending"]!.safety_status = "draft"; }],
  ["missing fallback", (s: ScenarioDocument) => { delete s.responses["system.safe-fallback"]; }],
  ["draft fallback", (s: ScenarioDocument) => { s.responses["system.safe-fallback"]!.safety_status = "draft"; }],
  ["excess tactic pressure", (s: ScenarioDocument) => { s.adaptive_policy!.tactics[0]!.pressure_level = 3; }],
  ["draft node", (s: ScenarioDocument) => { s.nodes[0]!.branch_status = "draft"; }],
  ["missing review identity", (s: ScenarioDocument) => { s.reviewed_by = null; }],
  ["blank approved response", (s: ScenarioDocument) => { s.responses.authority!.text = "   "; }],
] as const) test(`released content drift: ${name} fails loudly without returning unapproved content`, () => {
  const changed = structuredClone(scenario); mutate(changed);
  assert.throws(() => engine.decide({ ...input(), scenario: changed }), typed("INVALID_SCENARIO"));
});

test("archived draft cannot enter the tactic pool or resolve a reviewed runtime response", () => {
  const archived = validateScenarioDocument(JSON.parse(readFileSync("content/scenario-candidates/history/S-01-0.1.0-draft.json", "utf8")));
  assert.equal(isScenarioRuntimeEligible(archived), false);
  const action = engine.decide(stateless({ ...input(), scenario: archived }));
  assert.equal(action.decisionCode, "DRAFT_SAFE_FALLBACK"); assert.equal(action.tacticId, null);
  assert.equal(action.responseId, "system.safe-fallback"); assert.equal(action.response.safetyStatus, "system_safe_template");
  assert.equal(resolver.resolve({ scenario: archived, language: archived.language ?? "pending-verification", action }).safetyStatus, "system_safe_template");
  assert.throws(() => resolver.resolve({ scenario: archived, language: "hi-IN", action: engine.decide(input()) }));
});
for (const lifecycle_status of ["DRAFT", "SAFETY_REVIEW", "APPROVED"] as const) test(`${lifecycle_status} blocks adaptive runtime content and retains only the explicit developer-safe fallback`, () => {
  const changed = { ...scenario, lifecycle_status }, value = stateless({ ...input(), scenario: changed });
  const action = engine.decide(value); assert.equal(action.decisionCode, "DRAFT_SAFE_FALLBACK"); assert.equal(action.tacticId, null);
  assert.equal(action.response.safetyStatus, "system_safe_template");
});
for (const review_status of ["draft", "in_review", "rejected"] as const) test(`${review_status} review cannot select an adaptive tactic`, () => {
  const action = engine.decide(stateless({ ...input(), scenario: { ...scenario, review_status } }));
  assert.equal(action.decisionCode, "DRAFT_SAFE_FALLBACK"); assert.equal(action.tacticId, null); assert.equal(action.response.safetyStatus, "system_safe_template");
});
test("runtime-disabled preview and exhausted approved pool retain explicit safe-fallback metadata", () => {
  assert.equal(engine.decide({ ...input(), runtimeAllowed: false }).decisionCode, "DRAFT_SAFE_FALLBACK");
  const action = engine.decide(stateless({ ...input(), previousTacticIds: tacticIds, previousResponseIds: tacticIds }));
  assert.equal(action.terminalState, "SAFE_FALLBACK"); assert.equal(action.tacticId, null); assert.equal(action.responseId, "system.safe-fallback");
});

for (const [name, change] of [
  ["next pressure mismatch", { nextPressureLevel: 2 }], ["negative pressure", { nextPressureLevel: -1 }],
  ["non-integer pressure", { nextPressureLevel: 1.5 }], ["NaN pressure", { nextPressureLevel: NaN }], ["cap excess", { nextPressureLevel: 3 }],
  ["wrong tactic", { tacticId: "missing" }], ["wrong category", { tacticCategory: "FEAR_CONSEQUENCE" }],
  ["wrong tactic response", { responseId: "fear" }],
] as const) test(`resolver rejects ${name} metadata`, () => {
  const action = { ...engine.decide(input()), ...change };
  assert.throws(() => resolver.resolve({ scenario, language: "hi-IN", action }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
});
for (const [name, change] of [
  ["scenario", { scenarioId: "S-02" }], ["version", { scenarioVersion: "0.1.0" }], ["response identity", { responseId: "fear" }],
  ["arbitrary text", { text: "unapproved replacement" }],
] as const) test(`resolver rejects forged response ${name}`, () => {
  const action = engine.decide(input());
  assert.throws(() => resolver.resolve({ scenario, language: "hi-IN", action: { ...action, response: { ...action.response, ...change } } }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
});
test("terminal response/category, scenario version and language cannot be silently substituted", () => {
  const verified = engine.decide(input(0, "VERIFIED_INDEPENDENTLY"));
  for (const action of [{ ...verified, tacticId: "authority", tacticCategory: "AUTHORITY" as const }, { ...verified, responseId: "authority" },
    { ...verified, terminalState: "SAFE_FALLBACK" as const }, { ...engine.decide(input()), terminalState: "SAFE_VERIFIED" as const }]) {
    assert.throws(() => validatePolicyTransition(scenario, action), typed("APPROVED_RESPONSE_UNAVAILABLE"));
  }
  assert.throws(() => resolver.resolve({ scenario, language: "en", action: verified }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
  assert.throws(() => resolver.resolve({ scenario: { ...scenario, version: "0.2.1" }, language: "hi-IN", action: verified }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
});
for (const [behavior, outcome] of [["DISCLOSED_DUMMY_SECRET", "DUMMY_SECRET_DISCLOSED"], ["COMPLIED", "MAX_TURNS"]] as const) {
  test(`policy cannot emit undeclared ${outcome} terminal outcome`, () => {
    const changed = structuredClone(scenario); changed.adaptive_policy!.terminal_states = changed.adaptive_policy!.terminal_states.filter((state) => state !== outcome);
    assert.throws(() => engine.decide({ ...input(outcome === "MAX_TURNS" ? 2 : 0, behavior), scenario: changed }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
  });
}
