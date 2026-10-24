import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BehaviorLabelSchema, type BehaviorLabel, type SessionState } from "@vaccine/contracts";
import { validateScenarioDocument } from "@vaccine/scenario-schema";
import { AdaptivePolicyEngine, ApprovedResponseResolver, validatePolicyTransition, type AdaptivePolicyInput } from "../../api/src/adaptivePolicy.js";
import { buildPressureTimelinePoint } from "../../api/src/debriefEngine.js";
import { ApplicationError } from "../../api/src/errors.js";
import { appendLearnerTurnEvent } from "../../api/src/eventLog.js";
import { LearnerTurnEventBuilder } from "../../api/src/learnerTurnEventBuilder.js";
import { createSessionState } from "../../api/src/session.js";
import { DeterministicAudioTimingClock } from "../../api/src/timing.js";
import { PressureLatencyCurve } from "./components/PressureLatencyCurve.js";

const scenario = validateScenarioDocument(JSON.parse(readFileSync("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
const engine = new AdaptivePolicyEngine(), resolver = new ApprovedResponseResolver();
const continuing = ["STALLED", "REFUSED", "COMPLIED"] as const;
const supported = new Set([0, ...scenario.adaptive_policy!.tactics.map((tactic) => tactic.pressure_level)]);
function initial(sessionId = "00000000-0000-4000-8000-000000000001"): SessionState {
  return { ...createSessionState({ sessionId, scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
    language: "hi-IN", startingNodeId: "start", maxPressureLevel: scenario.adaptive_policy!.max_pressure_level,
    maxTurns: scenario.adaptive_policy!.max_turns, scenarioRuntimeStatus: "RUNTIME_ELIGIBLE" }),
  state: "ROUTING", currentResponseId: "system.opening" };
}
function input(session: SessionState, behavior: BehaviorLabel): AdaptivePolicyInput {
  return { scenario, behavior, turnNumber: session.turnNumber + 1, currentPressureLevel: session.currentPressureLevel,
    previousTacticIds: session.previousTacticIds, previousResponseIds: session.timelineEvents.flatMap((event) => event.selectedNextResponseId ? [event.selectedNextResponseId] : []),
    learnerText: "", sessionState: { scenarioId: session.scenarioId, scenarioVersion: session.scenarioVersion,
      currentNodeId: session.currentNodeId, turnNumber: session.turnNumber, state: session.state,
      terminalState: session.terminalState, currentTacticId: session.currentTacticId, currentResponseId: session.currentResponseId } };
}
function typed(code: string) {
  return (error: unknown) => { assert.ok(error instanceof ApplicationError); assert.equal(error.code, code); return true; };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Exercise the real policy, canonical event constructor, append boundary and curve projection.
// Session storage here mirrors orchestration; separate existing conversation tests exercise HTTP/audio orchestration.
function step(session: SessionState, behavior: BehaviorLabel, observables = { latency: 400, duration: 1000, text: "same observable wording" }) {
  const value = input(session, behavior), action = engine.decide(value);
  assert.deepEqual(resolver.resolve({ scenario, language: "hi-IN", action }), action.response);
  assert.ok(supported.has(action.nextPressureLevel));
  assert.ok(action.nextPressureLevel >= session.currentPressureLevel);
  assert.ok(action.nextPressureLevel <= session.currentPressureLevel + 1);
  assert.ok(action.nextPressureLevel <= scenario.adaptive_policy!.max_pressure_level && action.nextPressureLevel <= 5);
  if (action.terminalState) {
    assert.equal(action.tacticId, null); assert.equal(action.tacticCategory, null);
    assert.equal(action.nextPressureLevel, session.currentPressureLevel);
  } else {
    const tactic = scenario.adaptive_policy!.tactics.find((item) => item.tactic_id === action.tacticId)!;
    assert.equal(tactic.pressure_level, action.nextPressureLevel); assert.ok(tactic.response_ids.includes(action.responseId));
    assert.equal(action.response.safetyStatus, "reviewed_safe"); assert.equal(action.decisionCode, "SELECTED_TACTIC");
    assert.equal(session.previousTacticIds.includes(action.tacticId!), false);
  }
  const start = value.turnNumber * 10000;
  const timing = new DeterministicAudioTimingClock().capture({ callerAudioStartedAtMs: start, callerAudioEndedAtMs: start + 1000,
    learnerSpeechStartedAtMs: start + 1000 + observables.latency,
    learnerSpeechEndedAtMs: start + 1000 + observables.latency + observables.duration });
  const event = new LearnerTurnEventBuilder().build({ session, scenario, turnNumber: value.turnNumber, timing,
    transcript: { text: behavior === "DISCLOSED_DUMMY_SECRET" ? "DUMMY-4821" : observables.text }, dummySecretTokens: ["DUMMY-4821"],
    behavior: { label: behavior, evidenceRuleIds: [], source: "deterministic_rules", context: {
      activeTacticId: session.currentTacticId, activeTacticCategory: session.currentTacticCategory, relevantRedFlagIds: [] }, safetySignals: [] },
    policy: action, tts: { cacheHit: true, fallback: false, mediaType: "audio/wav" } });
  assert.equal(event.callerPressureLevel, session.currentPressureLevel);
  assert.equal(event.nextPressureLevel, action.nextPressureLevel);
  const appended = appendLearnerTurnEvent(session, event), point = buildPressureTimelinePoint(appended.timelineEvents.at(-1)!);
  const next: SessionState = { ...appended, turnNumber: value.turnNumber, state: action.terminalState ? "COMPLETED" : "ROUTING",
    terminalState: action.terminalState, currentPressureLevel: action.nextPressureLevel, currentTacticId: action.tacticId,
    currentTacticCategory: action.tacticCategory, currentResponseId: action.responseId,
    previousTacticIds: action.tacticId ? [...session.previousTacticIds, action.tacticId] : [...session.previousTacticIds],
    pressureTimeline: [...session.pressureTimeline, point] };
  return { action, event, next };
}
function path(labels: readonly BehaviorLabel[]) {
  let session = initial();
  return labels.map((behavior) => {
    assert.equal(session.terminalState, null, "do not enumerate impossible post-terminal continuations");
    const result = step(freeze(session), behavior); session = result.next; return result;
  });
}
function compact(labels: readonly BehaviorLabel[]) {
  return path(labels).map(({ action, event }) => ({ behavior: event.behavior.label, current: event.callerPressureLevel,
    tactic: action.tacticId, response: action.responseId, next: action.nextPressureLevel,
    terminal: action.terminalState, reason: action.reason }));
}

for (const behavior of continuing) for (const count of [1, 2, 3]) test(`${behavior} x ${count}: approved 0→1→1 pressure, no invented fourth turn`, () => {
  const labels = Array<BehaviorLabel>(count).fill(behavior), rows = compact(labels);
  assert.deepEqual(rows.map((row) => row.current), [0, 1, 1].slice(0, count));
  assert.deepEqual(rows.map((row) => row.next), Array(count).fill(1));
  assert.deepEqual(rows.map((row) => row.tactic), ["authority", "fear", null].slice(0, count));
  assert.deepEqual(rows.map((row) => row.response), ["authority", "fear", "system.safe-ending"].slice(0, count));
  assert.deepEqual(rows.map((row) => row.reason), ["selected", "selected", "max_turns"].slice(0, count));
  assert.deepEqual(rows.map((row) => row.terminal), [null, null, "MAX_TURNS"].slice(0, count));
  assert.deepEqual(compact(labels), rows);
});
for (const first of continuing) for (const second of continuing.filter((label) => label !== first)) test(`${first} → ${second}: history selects authority then fear at pressure one`, () => {
  const rows = compact([first, second]); assert.deepEqual(rows.map((row) => [row.current, row.next, row.tactic]), [[0, 1, "authority"], [1, 1, "fear"]]);
  assert.deepEqual(compact([first, second]), rows);
});
for (const first of continuing) for (const last of ["VERIFIED_INDEPENDENTLY", "DISCLOSED_DUMMY_SECRET"] as const) test(`${first} → ${last} retains heard pressure one and stops`, () => {
  const rows = compact([first, last]); assert.equal(rows[1]!.current, 1); assert.equal(rows[1]!.next, 1);
  assert.equal(rows[1]!.tactic, null); assert.equal(rows[1]!.response, "system.safe-ending");
  assert.equal(rows[1]!.terminal, last === "VERIFIED_INDEPENDENTLY" ? "SAFE_VERIFIED" : "DUMMY_SECRET_DISCLOSED");
});
for (const terminal of ["VERIFIED_INDEPENDENTLY", "DISCLOSED_DUMMY_SECRET", "UNKNOWN"] as const) for (const stage of [0, 1, 2]) test(`${terminal} at learner turn ${stage + 1}: terminal pressure retained with established precedence`, () => {
  const labels: BehaviorLabel[] = [...Array<BehaviorLabel>(stage).fill("STALLED"), terminal];
  const { action, event, next } = path(labels).at(-1)!;
  const outcome = terminal === "VERIFIED_INDEPENDENTLY" ? "SAFE_VERIFIED" : terminal === "DISCLOSED_DUMMY_SECRET" ? "DUMMY_SECRET_DISCLOSED"
    : stage === 2 ? "MAX_TURNS" : "SAFE_FALLBACK";
  assert.equal(action.terminalState, outcome); assert.equal(action.tacticId, null);
  assert.equal(action.nextPressureLevel, stage ? 1 : 0); assert.equal(event.callerPressureLevel, stage ? 1 : 0);
  assert.equal(action.responseId, outcome === "SAFE_FALLBACK" ? "system.safe-fallback" : "system.safe-ending");
  const before = JSON.stringify(next);
  for (const behavior of BehaviorLabelSchema.options) assert.throws(() => engine.decide(input(next, behavior)), typed("INVALID_STATE"));
  assert.equal(JSON.stringify(next), before, "stale policy cannot append an event, select audio or mutate pressure");
});

test("all reachable behavior-history prefixes: 78 transitions, 66 terminal leaves, supported 0/1 only, deterministic and immutable", (context) => {
  const forbidden = () => assert.fail("Pressure policy attempted network/random/clock dependency");
  context.mock.method(globalThis, "fetch", forbidden); context.mock.method(Math, "random", forbidden); context.mock.method(Date, "now", forbidden);
  let transitions = 0, leaves = 0, expandable = 0;
  const pressures = new Set<number>(), tactics = new Set<string>();
  function visit(session: SessionState) {
    expandable++; freeze(session); const before = JSON.stringify(session);
    for (const behavior of BehaviorLabelSchema.options) {
      const result = step(session, behavior); transitions++;
      for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(step(session, behavior), result);
      pressures.add(result.event.callerPressureLevel); pressures.add(result.action.nextPressureLevel);
      if (result.action.tacticId) tactics.add(result.action.tacticId);
      assert.equal(JSON.stringify(session), before, "earlier committed pressure/events are immutable");
      if (result.action.terminalState) {
        leaves++; const terminalBefore = JSON.stringify(result.next);
        assert.throws(() => engine.decide(input(result.next, "COMPLIED")), typed("INVALID_STATE"));
        assert.equal(JSON.stringify(result.next), terminalBefore);
      } else { assert.ok(result.next.turnNumber < 3); visit(result.next); }
    }
  }
  visit(initial()); assert.equal(transitions, 78); assert.equal(leaves, 66); assert.equal(expandable, 13);
  assert.equal(1 + transitions, 79, "history-prefix states including initial and terminal leaves");
  assert.deepEqual([...pressures].sort(), [0, 1]); assert.equal(Math.max(...pressures), 1);
  assert.deepEqual([...tactics].sort(), ["authority", "fear"]);
});

for (const pressure of [null, undefined, NaN, Infinity, -Infinity, -1, 0.5, 2, 3, 4, 5, 6, "1"]) test(`invalid or unsupported pressure ${String(pressure)} rejects even stateless terminal preview`, () => {
  const value = input(initial(), "VERIFIED_INDEPENDENTLY"); delete value.sessionState;
  assert.throws(() => engine.decide({ ...value, currentPressureLevel: pressure } as unknown as AdaptivePolicyInput), typed("INVALID_STATE"));
});
test("policy output guard rejects unauthored two even below ceiling; ceiling/global bounds are independent", () => {
  const action = engine.decide(input(initial(), "VERIFIED_INDEPENDENTLY"));
  for (const pressure of [2, 3, 5, -1, NaN]) assert.throws(() => validatePolicyTransition(scenario, {
    ...action, pressureLevel: pressure, nextPressureLevel: pressure }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
  assert.equal(scenario.adaptive_policy!.max_pressure_level, 2); assert.deepEqual([...supported].sort(), [0, 1]);
});
test("approved pressure support derives from scenario content, not an S-01/global hardcoded maximum", () => {
  // Isolated schema-valid test fixture only; no canonical scenario/review/approval is edited or promoted.
  const fixture = structuredClone(scenario); fixture.adaptive_policy!.tactics[0]!.pressure_level = 2;
  const action = engine.decide({ ...input(initial(), "VERIFIED_INDEPENDENTLY"), scenario: fixture,
    currentPressureLevel: 2, sessionState: { ...input(initial(), "STALLED").sessionState!, currentTacticId: "urgency", currentResponseId: "urgency" } });
  assert.equal(action.nextPressureLevel, 2); assert.equal(action.terminalState, "SAFE_VERIFIED");
});
test("invalid tactic/response histories and corrupt active pressure reject instead of selecting arbitrary content", () => {
  const value = input(path(["STALLED"])[0]!.next, "STALLED");
  for (const change of [{ previousTacticIds: ["invented"] }, { previousResponseIds: ["unapproved"] },
    { currentPressureLevel: 0 }, { currentPressureLevel: 2 }]) assert.throws(() => engine.decide({ ...value, ...change }), typed("INVALID_STATE"));
});
test("invalid scenario tactic pressure above its ceiling rejects before selection", () => {
  const changed = structuredClone(scenario); changed.adaptive_policy!.tactics[0]!.pressure_level = 3;
  assert.throws(() => engine.decide({ ...input(initial(), "STALLED"), scenario: changed }), typed("INVALID_SCENARIO"));
});
test("response/tactic pressure mismatches cannot pass the policy output boundary", () => {
  const action = engine.decide(input(initial(), "STALLED"));
  for (const change of [{ pressureLevel: 0, nextPressureLevel: 0 }, { pressureLevel: 2, nextPressureLevel: 2 }, { responseId: "fear" }]) {
    assert.throws(() => validatePolicyTransition(scenario, { ...action, ...change }), typed("APPROVED_RESPONSE_UNAVAILABLE"));
  }
});
test("ordinary transcript wording, latency, speech rate, silence, interruption and emotion fields cannot change decisions", () => {
  const middle = path(["STALLED"])[0]!.next, value = input(middle, "COMPLIED"), expected = engine.decide(value);
  for (const learnerText of ["", "scared nervous afraid stressed", "थोड़ा समय चाहिए", "DUMMY-4821", "I refuse", "a".repeat(5000)]) {
    assert.deepEqual(engine.decide({ ...value, learnerText }), expected);
  }
  const augmented = { ...value, responseLatency: 99999, speechRateWpm: 999, interruption: true, emotion: "scared", sentimentScore: -1 };
  assert.deepEqual(engine.decide(augmented), expected);
  const slow = step(middle, "COMPLIED", { latency: 9000, duration: 9000, text: "um I am scared and nervous please wait for me" });
  const overlap = step(middle, "COMPLIED", { latency: -500, duration: 200, text: "yes okay" });
  assert.notDeepEqual(slow.event.responseLatency, overlap.event.responseLatency);
  assert.notEqual(slow.event.speechRateWpm, overlap.event.speechRateWpm);
  assert.notEqual(slow.event.interruption.status, overlap.event.interruption.status);
  assert.deepEqual(slow.action, overlap.action);
  assert.equal(engine.decide({ ...value, learnerText: "please stop simulation now" }).terminalState, "SAFE_WORD", "existing explicit safe-word exception only");
  const source = readFileSync("apps/api/src/adaptivePolicy.ts", "utf8");
  assert.doesNotMatch(source, /responseLatency|speechRate|sentimentScore|voiceEmotion|toneScore|Math\.random|Date\.now/u);
  assert.doesNotMatch(source, /from ["'](?:node:|.*(?:providers|credit|cache|classifier|eventLog))/u);
});
test("new session resets pressure/history/events after another completed session reaches one", () => {
  const completed = path(["STALLED", "VERIFIED_INDEPENDENTLY"]).at(-1)!.next;
  assert.equal(completed.currentPressureLevel, 1); assert.equal(completed.state, "COMPLETED");
  const fresh = initial("00000000-0000-4000-8000-000000000002");
  assert.equal(fresh.currentPressureLevel, 0); assert.deepEqual(fresh.previousTacticIds, []);
  assert.deepEqual(fresh.timelineEvents, []); assert.deepEqual(fresh.pressureTimeline, []);
  assert.equal(step(fresh, "STALLED").action.tacticId, "authority");
  assert.equal(completed.timelineEvents.length, 2); assert.equal(completed.currentPressureLevel, 1);
});
test("canonical event → projection → SVG shows heard 0→1 while next values are 1→1; earlier event never changes", () => {
  const results = path(["STALLED", "VERIFIED_INDEPENDENTLY"]), session = results[1]!.next;
  assert.deepEqual(session.timelineEvents.map((event) => event.callerPressureLevel), [0, 1]);
  assert.deepEqual(session.timelineEvents.map((event) => event.nextPressureLevel), [1, 1]);
  assert.deepEqual(session.pressureTimeline.map((point) => point.callerPressureLevel), [0, 1]);
  assert.equal(session.timelineEvents[0], results[0]!.next.timelineEvents[0]);
  assert.equal(session.timelineEvents[0]!.callerResponseId, "system.opening");
  assert.equal(session.timelineEvents[1]!.callerResponseId, "authority");
  const markup = renderToStaticMarkup(<PressureLatencyCurve points={session.pressureTimeline} />);
  assert.match(markup, /points="55,185 545,155"/u);
  assert.match(markup, /Turn 1: pressure 0/u); assert.match(markup, /Turn 2: pressure 1/u);
  assert.equal((markup.match(/data-pressure-point="true"/gu) ?? []).length, 2);
});
test("MAX_TURNS curve retains final heard pressure one instead of safe-ending zero; no fourth point", () => {
  const session = path(["COMPLIED", "COMPLIED", "COMPLIED"]).at(-1)!.next;
  assert.equal(session.terminalState, "MAX_TURNS"); assert.equal(session.currentResponseId, "system.safe-ending");
  assert.deepEqual(session.pressureTimeline.map((point) => point.callerPressureLevel), [0, 1, 1]);
  const markup = renderToStaticMarkup(<PressureLatencyCurve points={session.pressureTimeline} />);
  assert.match(markup, /points="55,185 300,155 545,155"/u);
  assert.equal((markup.match(/data-pressure-point="true"/gu) ?? []).length, 3);
  assert.throws(() => engine.decide(input(session, "COMPLIED")), typed("INVALID_STATE"));
});
test("UI plots explicit event pressure even with reordered tactic names or different next-pressure metadata", () => {
  const point = path(["STALLED"])[0]!.next.pressureTimeline[0]!;
  const markup = renderToStaticMarkup(<PressureLatencyCurve points={[{ ...point, callerTacticId: "fear", callerPressureLevel: 0, nextPressureLevel: 1 }]} />);
  assert.match(markup, /points="300,185"/u); assert.match(markup, /Turn 1: pressure 0/u);
});
