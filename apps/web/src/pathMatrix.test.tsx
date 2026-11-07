import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BehaviorLabelSchema, type BehaviorLabel, type SessionState } from "@vaccine/contracts";
import { AdaptivePolicyEngine, ApprovedResponseResolver, type AdaptivePolicyAction, type AdaptivePolicyInput } from "../../api/src/adaptivePolicy.js";
import { LearnerBehaviorClassifier, type BehaviorClassifierInput } from "../../api/src/behaviorClassifier.js";
import { applyConversationAction } from "../../api/src/conversationRuntime.js";
import { conversationDebrief } from "../../api/src/conversationDebrief.js";
import { ApplicationError } from "../../api/src/errors.js";
import { RuntimeCreditLedger } from "../../api/src/runtimeCredit.js";
import { InMemorySessionStore } from "../../api/src/sessionStore.js";
import { TurnOrchestrator } from "../../api/src/turnOrchestrator.js";
import { endSession } from "../../api/src/session.js";
import { acknowledgeCaller, behaviorTexts, fixtureBehavior, fixtureTranscript, freshPathSession, pathClock, pathDate,
  pathInput, pathScenario, pathSignature, pathTemplates, pathTiming, runBehaviorPath,
  startPath, type BehaviorPathResult, type ScheduledCaller } from "../../api/src/testing/behaviorPath.js";
import { PressureTimeline } from "./components/PressureTimeline.js";

const R = "REFUSED", S = "STALLED", C = "COMPLIED", V = "VERIFIED_INDEPENDENTLY", D = "DISCLOSED_DUMMY_SECRET", U = "UNKNOWN";
interface MatrixRow {
  name: string; behaviors: readonly BehaviorLabel[]; turns: number; events: number; points: number;
  heard: number[]; next: number[]; tactics: (string | null)[]; responses: string[];
  outcome: SessionState["terminalState"]; state: "COMPLETED";
}
// Golden vectors for the approved three-state S-01 path, independent of execution output.
function row(name: string, behaviors: readonly BehaviorLabel[], outcome: NonNullable<SessionState["terminalState"]>): MatrixRow {
  const turns = behaviors.length, prefix = turns === 1 ? [] : turns === 2 ? ["authority"] : ["authority", "fear"];
  return { name, behaviors, turns, events: turns, points: turns, heard: turns === 1 ? [0] : turns === 2 ? [0, 1] : [0, 1, 1],
    next: turns === 1 ? [0] : turns === 2 ? [1, 1] : [1, 1, 1], tactics: [...prefix, null],
    responses: [...prefix, outcome === "SAFE_FALLBACK" ? "system.safe-fallback" : "system.safe-ending"], outcome, state: "COMPLETED" };
}
const matrix = [
  row("verified-first", [V], "SAFE_VERIFIED"), row("disclosed-first", [D], "DUMMY_SECRET_DISCLOSED"), row("unknown-first", [U], "SAFE_FALLBACK"),
  ...([R, S, C] as const).flatMap((first) => [row(`${first}-verified`, [first, V], "SAFE_VERIFIED"),
    row(`${first}-disclosed`, [first, D], "DUMMY_SECRET_DISCLOSED"), row(`${first}-unknown`, [first, U], "SAFE_FALLBACK")]),
  row("refused-stalled-verified", [R, S, V], "SAFE_VERIFIED"), row("stalled-refused-verified", [S, R, V], "SAFE_VERIFIED"),
  row("complied-stalled-verified", [C, S, V], "SAFE_VERIFIED"), row("refused-complied-verified", [R, C, V], "SAFE_VERIFIED"),
  row("complied-refused-disclosed", [C, R, D], "DUMMY_SECRET_DISCLOSED"),
  row("stalled-times-three", [S, S, S], "MAX_TURNS"), row("refused-times-three", [R, R, R], "MAX_TURNS"), row("complied-times-three", [C, C, C], "MAX_TURNS"),
  row("stalled-refused-stalled", [S, R, S], "MAX_TURNS"), row("refused-stalled-complied", [R, S, C], "MAX_TURNS"),
  row("complied-refused-stalled", [C, R, S], "MAX_TURNS"), row("unknown-final", [S, S, U], "MAX_TURNS"),
];
function offline(context: TestContext) {
  const forbidden = () => assert.fail("Path matrix attempted provider, network, cache or credit work");
  context.mock.method(globalThis, "fetch", forbidden); context.mock.method(Math, "random", forbidden);
  context.mock.method(RuntimeCreditLedger.prototype, "reserve", forbidden);
  context.mock.method(RuntimeCreditLedger.prototype, "chargeSimulated", forbidden);
  return forbidden;
}
function harness(context: TestContext) {
  const forbidden = offline(context), store = new InMemorySessionStore(), calls: AdaptivePolicyAction[] = [];
  const original = AdaptivePolicyEngine.prototype.decide;
  context.mock.method(AdaptivePolicyEngine.prototype, "decide", function(this: AdaptivePolicyEngine, input: AdaptivePolicyInput) {
    const action = original.call(this, input); calls.push(action); return action;
  });
  // Supply the six fixture labels at the classifier boundary: this phase does not evaluate/redefine classification.
  context.mock.method(LearnerBehaviorClassifier.prototype, "classify", (input: BehaviorClassifierInput) => {
    const label = BehaviorLabelSchema.options.find((value) => behaviorTexts[value] === input.transcriptText);
    assert.ok(label, "Unexpected transcript outside supplied behavior fixtures");
    return fixtureBehavior(label, { currentTacticId: input.activeTactic?.tacticId ?? null, currentTacticCategory: input.activeTactic?.category ?? null });
  });
  const orchestrator = new TurnOrchestrator({ store, scenarios: new Map([["S-01", pathScenario]]),
    recognizer: { transcribe: async () => forbidden(), openStream: forbidden }, synthesizer: { synthesize: async () => forbidden() },
    cache: { get: forbidden, set: forbidden }, budget: { mode: "development", developmentCap: 0, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 },
    sttUnits: 1, ttsUnits: 1, now: () => new Date(pathDate) });
  function begin(sessionId: string, audioClockId = pathClock) {
    const ready = freshPathSession(sessionId), callers: ScheduledCaller[] = []; store.create(ready);
    const session = startPath(ready, callers, audioClockId); store.update(session);
    return { session, callers };
  }
  async function turn(session: SessionState, behavior: BehaviorLabel) {
    calls.length = 0;
    const result = await orchestrator.processRecognizedTurn(session.sessionId, fixtureTranscript(session, behavior), pathTiming(session));
    assert.equal(calls.length, 1, "Exactly one policy decision per accepted learner turn");
    return { result, action: calls[0]! };
  }
  async function run(labels: readonly BehaviorLabel[], sessionId: string, partial?: "stop" | "fail"): Promise<BehaviorPathResult> {
    const begun = begin(sessionId), callers = begun.callers, decisions: AdaptivePolicyAction[] = [], processed: BehaviorLabel[] = [];
    let session = begun.session; const credit = orchestrator.creditDiagnostics();
    for (const behavior of labels) {
      if (session.terminalState !== null) break;
      const { result, action } = await turn(session, behavior); session = result.session; decisions.push(action); processed.push(behavior);
      assert.equal(result.branch.responseId, action.responseId); assert.equal(result.branch.id, action.tacticId);
      assert.equal(result.branch.nextPressureLevel, action.nextPressureLevel); assert.equal(result.branch.terminalState, action.terminalState);
      assert.deepEqual(result.learnerTurnEvent, session.timelineEvents.at(-1));
      if (partial && processed.length === labels.length && !action.terminalState) {
        session = partial === "stop" ? endSession(session, new Date(pathDate))
          : applyConversationAction(session, "fail", { code: "CALLER_AUDIO_FAILED", technical: { stage: "CALLER_AUDIO_RESOLUTION", causeCode: "TTS_PROVIDER_FAILED", providerAttempted: false } });
        store.update(session); break;
      }
      const committed = JSON.stringify(session.timelineEvents); session = acknowledgeCaller(session, callers); store.update(session);
      assert.equal(JSON.stringify(session.timelineEvents), committed, "Caller acknowledgement must not create/mutate a learner event");
    }
    assert.deepEqual(orchestrator.creditDiagnostics(), credit); assert.deepEqual(session.cache, { hits: 0, misses: 0 });
    return { session, processed, decisions, callers, debrief: conversationDebrief(session, pathTemplates) };
  }
  return { orchestrator, store, begin, turn, run, calls };
}
function assertConversationPathInvariant(result: BehaviorPathResult) {
  const { session, processed, decisions, callers, debrief } = result, events = session.timelineEvents, count = events.length;
  assert.equal(count, processed.length); assert.equal(session.turnNumber, count); assert.equal(session.pressureTimeline.length, count);
  assert.ok(count <= pathScenario.adaptive_policy!.max_turns);
  const ids = events.map((event) => event.turnId); assert.equal(new Set(ids).size, count);
  assert.deepEqual(ids, processed.map((_, index) => `${session.sessionId}:turn-${index + 1}`));
  assert.deepEqual(events.map((event) => event.behavior.label), processed); assert.deepEqual(session.behaviorHistory.map((value) => value.label), processed);
  assert.deepEqual(session.previousTacticIds, decisions.flatMap((value) => value.tacticId ? [value.tacticId] : []));
  assert.deepEqual(events.map((event) => event.selectedNextResponseId), decisions.map((value) => value.responseId));
  for (const [index, event] of events.entries()) {
    const action = decisions[index]!;
    new ApprovedResponseResolver().resolve({ scenario: pathScenario, language: "hi-IN", action });
    assert.equal(event.callerResponseId, callers[index]!.responseId);
    assert.equal(event.callerPressureLevel, index === 0 ? 0 : decisions[index - 1]!.nextPressureLevel);
    assert.equal(event.callerTacticId, index === 0 ? null : decisions[index - 1]!.tacticId);
    assert.equal(event.nextPressureLevel, action.nextPressureLevel); assert.equal(event.selectedNextTacticId, action.tacticId);
    assert.deepEqual(session.pressureTimeline[index]!.learnerBehavior, event.behavior);
    assert.equal(session.pressureTimeline[index]!.callerPressureLevel, event.callerPressureLevel);
    assert.ok([0, 1].includes(event.callerPressureLevel) && [0, 1].includes(event.nextPressureLevel));
    assert.ok(event.nextPressureLevel <= pathScenario.adaptive_policy!.max_pressure_level);
    assert.ok(event.callerAudioStartedAt!.monotonicMs < event.callerAudioEndedAt!.monotonicMs);
    assert.ok(event.callerAudioEndedAt!.monotonicMs < event.learnerSpeechStartedAt!.monotonicMs);
    assert.ok(event.learnerSpeechStartedAt!.monotonicMs < event.learnerSpeechEndedAt!.monotonicMs);
    if (index) assert.ok(event.callerAudioStartedAt!.monotonicMs > events[index - 1]!.learnerSpeechEndedAt!.monotonicMs);
    if (action.tacticId) {
      const tactic = pathScenario.adaptive_policy!.tactics.find((value) => value.tactic_id === action.tacticId)!;
      assert.equal(tactic.pressure_level, action.nextPressureLevel); assert.ok(tactic.response_ids.includes(action.responseId));
    }
  }
  assert.equal(new Set(callers.map((value) => value.turnNumber)).size, callers.length);
  for (const caller of callers) assert.equal(caller.afterEventCount, caller.turnNumber);
  if (!count) { assert.equal(debrief, null); return; }
  assert.ok(debrief); assert.equal(debrief.turnSummaries.length, count); assert.deepEqual(debrief.sourceTurnIds, ids);
  assert.deepEqual(debrief.turnSummaries.map((value) => value.learnerBehavior.label), processed);
  assert.deepEqual(debrief.pressureTimeline, session.pressureTimeline); assert.equal(debrief.terminalOutcome, session.terminalState);
  assert.equal(debrief.turnSummaries.filter((value) => value.learnerBehavior.label === V).length, processed.filter((value) => value === V).length);
  const disclosure = processed.indexOf(D), moments = events.filter((event) => event.complianceMoment !== null);
  assert.equal(moments.length, disclosure < 0 ? 0 : 1);
  assert.equal(debrief.firstComplianceMoment?.turnId ?? null, disclosure < 0 ? null : ids[disclosure]);
  if (session.state === "COMPLETED") {
    assert.equal(debrief.completionKind, "complete"); assert.equal(callers.length, count + 1);
    assert.equal(session.conversation?.phase, "COMPLETED"); assert.notEqual(session.terminalState, null);
    assert.equal(session.currentTacticId, null); assert.equal(decisions.at(-1)!.tacticId, null);
    assert.equal(events.at(-1)!.terminalState, session.terminalState);
    assert.deepEqual(callers.map((value) => value.responseId), ["system.opening", ...decisions.map((value) => value.responseId)]);
    assert.equal(new Set(callers.map((value) => value.responseId)).size, callers.length);
    for (const behavior of BehaviorLabelSchema.options) assert.throws(() => new AdaptivePolicyEngine().decide(pathInput(session, behavior)), ApplicationError);
  }
}
for (const expected of matrix) test(`5D matrix: ${expected.name}`, async (context) => {
  const h = harness(context), id = `matrix-${expected.name}`;
  const pure = runBehaviorPath(expected.behaviors, { sessionId: id }), actual = await h.run(expected.behaviors, id);
  for (const result of [pure, actual]) {
    assertConversationPathInvariant(result); const signature = pathSignature(result);
    assert.deepEqual(signature.processed, expected.behaviors); assert.deepEqual(signature.heard, expected.heard); assert.deepEqual(signature.next, expected.next);
    assert.deepEqual(signature.tactics, expected.tactics); assert.deepEqual(signature.responses, expected.responses);
    assert.equal(result.session.timelineEvents.length, expected.events); assert.equal(result.session.pressureTimeline.length, expected.points);
    assert.equal(result.session.turnNumber, expected.turns); assert.equal(signature.outcome, expected.outcome); assert.equal(signature.state, expected.state);
  }
  assert.deepEqual(pathSignature(actual), pathSignature(pure), "Actual orchestrator must agree with the independently composed policy runner");
  for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(pathSignature(runBehaviorPath(expected.behaviors, { sessionId: id })), pathSignature(pure));
  for (const compact of [false, true]) {
    const markup = renderToStaticMarkup(<PressureTimeline points={actual.session.pressureTimeline} compact={compact} />);
    const cards = markup.split('<article class="timeline-card">').slice(1); assert.equal(cards.length, expected.events);
    for (const [index, card] of cards.entries()) {
      assert.ok(card.includes(`TURN ${String(index + 1).padStart(2, "0")}`));
      assert.ok(card.includes(expected.behaviors[index]!.replaceAll("_", " ")));
      assert.ok(card.includes(`aria-label="Pressure: level ${expected.heard[index]} of 5"`));
      const action = actual.decisions[index]!, heading = action.tacticId ? `NEXT: ${action.tacticId.toUpperCase()}`
        : action.decisionCode === "NO_APPROVED_TACTIC" ? "SAFE FALLBACK" : action.decisionCode.replaceAll("_", " ");
      assert.ok(card.includes(`class="timeline-event-label">${heading}</span>`));
    }
  }
});

test("5D recompute all bounded prefixes/leaves and compare every complete path with real orchestration", async (context) => {
  const h = harness(context), leaves: BehaviorLabel[][] = [], prefixes: BehaviorLabel[][] = [];
  function visit(prefix: BehaviorLabel[]) {
    const path = runBehaviorPath(prefix); assertConversationPathInvariant(path); prefixes.push(prefix);
    if (path.session.terminalState) { leaves.push(prefix); return; }
    assert.ok(prefix.length < path.session.maxTurns);
    for (const behavior of BehaviorLabelSchema.options) visit([...prefix, behavior]);
  }
  visit([]); const outcomes = new Map<string, number>(), depths = new Map<number, number>(); let maxPressure = 0;
  for (const [index, labels] of leaves.entries()) {
    const id = `exhaustive-${index}`, expected = runBehaviorPath(labels, { sessionId: id }), actual = await h.run(labels, id);
    assertConversationPathInvariant(actual); assert.deepEqual(pathSignature(actual), pathSignature(expected));
    const last = labels.at(-1)!;
    const outcome = last === V ? "SAFE_VERIFIED" : last === D ? "DUMMY_SECRET_DISCLOSED" : labels.length === actual.session.maxTurns ? "MAX_TURNS" : "SAFE_FALLBACK";
    assert.equal(actual.session.terminalState, outcome);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1); depths.set(labels.length, (depths.get(labels.length) ?? 0) + 1);
    maxPressure = Math.max(maxPressure, ...actual.session.timelineEvents.map((value) => value.callerPressureLevel));
  }
  // Counts are recomputed from traversal; derive the expected bound from continuing branches, labels and depth.
  const branchCount = BehaviorLabelSchema.options.filter((behavior) => !runBehaviorPath([behavior]).session.terminalState).length;
  const maxTurns = pathScenario.adaptive_policy!.max_turns;
  const internal = Array.from({ length: maxTurns }, (_, index) => branchCount ** index).reduce((sum, value) => sum + value, 0);
  assert.equal(prefixes.length, 1 + BehaviorLabelSchema.options.length * internal);
  assert.equal(leaves.length, prefixes.length - internal);
  const terminalAtAnyDepth = internal, earlierFallback = internal - branchCount ** (maxTurns - 1);
  assert.deepEqual(Object.fromEntries(outcomes), { MAX_TURNS: branchCount ** (maxTurns - 1) * (BehaviorLabelSchema.options.length - 2),
    SAFE_VERIFIED: terminalAtAnyDepth, DUMMY_SECRET_DISCLOSED: terminalAtAnyDepth, SAFE_FALLBACK: earlierFallback });
  assert.deepEqual(Object.fromEntries(depths), Object.fromEntries(Array.from({ length: maxTurns }, (_, index) => [index + 1,
    branchCount ** index * (index + 1 === maxTurns ? BehaviorLabelSchema.options.length : BehaviorLabelSchema.options.length - branchCount)])));
  assert.equal(maxPressure, 1);
  context.diagnostic(JSON.stringify({ exploredPrefixesIncludingInitial: prefixes.length, decisionPrefixes: prefixes.length - 1,
    completePaths: leaves.length, terminalLeaves: leaves.length, terminalDistribution: Object.fromEntries(outcomes),
    pathsByDepth: Object.fromEntries(depths), maxDepth: Math.max(...depths.keys()), maxPressure,
    orchestratedLearnerTurns: leaves.reduce((sum, labels) => sum + labels.length, 0) }));
});

for (const labels of [[S, V, C], [C, D, V], [U, V], [R, U, C], [S, S, S, V]] as const) test(`5D terminal suffix short-circuit: ${labels.join("→")}`, async (context) => {
  const h = harness(context), expected = runBehaviorPath(labels), actual = await h.run(labels, "behavior-path");
  assertConversationPathInvariant(actual); assert.deepEqual(pathSignature(actual), pathSignature(expected));
  const consumed = actual.processed.length; assert.ok(consumed < labels.length);
  assert.deepEqual(actual.processed, labels.slice(0, consumed));
});
for (const partial of ["stop", "fail"] as const) test(`5D STALLED → ${partial} preserves exactly one event and partial debrief`, async (context) => {
  const h = harness(context), expected = runBehaviorPath([S], { partial }), actual = await h.run([S], "behavior-path", partial);
  assertConversationPathInvariant(actual); assert.deepEqual(pathSignature(actual), pathSignature(expected));
  assert.equal(actual.session.timelineEvents.length, 1); assert.equal(actual.session.pressureTimeline.length, 1);
  assert.equal(actual.debrief?.completionKind, "partial"); assert.equal(actual.session.conversation?.phase, partial === "stop" ? "STOPPED" : "ERROR");
  assert.deepEqual(actual.processed, [S]); assert.equal(actual.session.terminalState, partial === "stop" ? "LEARNER_ENDED" : null);
  assert.equal(actual.callers.length, 1); assert.throws(() => new AdaptivePolicyEngine().decide(pathInput(actual.session, C)), ApplicationError);
});

test("5D duplicate recognized-turn delivery cannot duplicate policy, event, response or credit work", async (context) => {
  const h = harness(context), { session } = h.begin("duplicate-turn"); h.calls.length = 0;
  const transcript = fixtureTranscript(session, S), timing = pathTiming(session);
  const attempts = await Promise.allSettled([h.orchestrator.processRecognizedTurn(session.sessionId, transcript, timing),
    h.orchestrator.processRecognizedTurn(session.sessionId, transcript, timing)]);
  assert.equal(attempts.filter((value) => value.status === "fulfilled").length, 1); assert.equal(h.calls.length, 1);
  assert.equal(h.store.get(session.sessionId).timelineEvents.length, 1); assert.equal(h.store.get(session.sessionId).pressureTimeline.length, 1);
});

test("5D shared orchestrator isolates interleaved sessions and fresh practice starts", async (context) => {
  const h = harness(context), a = h.begin("isolation-A"), b = h.begin("isolation-B", "00000000-0000-4000-8000-00000000000e");
  let resultA = await h.turn(a.session, C), resultB = await h.turn(b.session, S);
  const firstA = JSON.stringify(resultA.result.session.timelineEvents), firstB = JSON.stringify(resultB.result.session.timelineEvents);
  const nextA = acknowledgeCaller(resultA.result.session, a.callers), nextB = acknowledgeCaller(resultB.result.session, b.callers);
  h.store.update(nextA); h.store.update(nextB);
  resultA = await h.turn(nextA, D); resultB = await h.turn(nextB, V);
  const completedA = acknowledgeCaller(resultA.result.session, a.callers), completedB = acknowledgeCaller(resultB.result.session, b.callers);
  h.store.update(completedA); h.store.update(completedB);
  assert.equal(JSON.stringify(completedA.timelineEvents.slice(0, 1)), firstA); assert.equal(JSON.stringify(completedB.timelineEvents.slice(0, 1)), firstB);
  assert.equal(completedA.terminalState, "DUMMY_SECRET_DISCLOSED"); assert.equal(completedB.terminalState, "SAFE_VERIFIED");
  assert.equal(conversationDebrief(completedB, pathTemplates)!.firstComplianceMoment, null);
  assert.notEqual(completedA.timelineEvents[0]!.turnId, completedB.timelineEvents[0]!.turnId);
  assert.notEqual(completedA.conversation!.audioClockId, completedB.conversation!.audioClockId);
  const fresh = freshPathSession("isolation-C"); h.store.create(fresh);
  assert.equal(fresh.turnNumber, 0); assert.equal(fresh.currentPressureLevel, 0); assert.equal(fresh.terminalState, null);
  assert.deepEqual(fresh.timelineEvents, []); assert.deepEqual(fresh.previousTacticIds, []); assert.deepEqual(fresh.pressureTimeline, []);
  assert.equal(conversationDebrief(fresh, pathTemplates), null);
});

test("5D legacy turn summary describes the actual opening response, never a fallback that did not play", async (context) => {
  const h = harness(context), result = await h.run([S, V], "opening-summary");
  assert.match(result.session.observedEvents[0]!.callerTesting, /system\.opening/u);
  assert.doesNotMatch(result.session.observedEvents[0]!.callerTesting, /fallback/iu);
  assert.match(result.session.observedEvents[1]!.callerTesting, /authority.*pressure 1/u);
});
