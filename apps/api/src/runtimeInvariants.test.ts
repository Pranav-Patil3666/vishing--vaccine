import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BehaviorLabelSchema, CallerAudioRequestSchema, type BehaviorLabel, type SessionState } from "@vaccine/contracts";
import { AdaptivePolicyEngine } from "./adaptivePolicy.js";
import { LearnerBehaviorClassifier, type BehaviorClassifierInput } from "./behaviorClassifier.js";
import { ApprovedCallerCatalog } from "./callerAudio/catalog.js";
import { applyConversationAction } from "./conversationRuntime.js";
import { conversationDebrief } from "./conversationDebrief.js";
import { ApplicationError } from "./errors.js";
import { appendLearnerTurnEvent } from "./eventLog.js";
import { LearnerTurnEventBuilder } from "./learnerTurnEventBuilder.js";
import { InMemorySessionStore } from "./sessionStore.js";
import { TurnOrchestrator } from "./turnOrchestrator.js";
import { RuntimeCreditLedger } from "./runtimeCredit.js";
import { TranscriptAssembler } from "./providers/prisma/transcriptAssembly.js";
import { acknowledgeCaller, behaviorTexts, fixtureBehavior, fixtureTranscript, freshPathSession, pathDate, pathInput, pathScenario,
  pathTemplates, pathTiming, runBehaviorPath, startPath } from "./testing/behaviorPath.js";
import { assertRuntimeInvariants, runtimeInvariantCatalog } from "./testing/runtimeInvariants.js";

function harness(context: TestContext) {
  const forbidden = () => assert.fail("Invariant harness attempted provider/cache/credit/network work");
  context.mock.method(globalThis, "fetch", forbidden); context.mock.method(RuntimeCreditLedger.prototype, "reserve", forbidden);
  context.mock.method(RuntimeCreditLedger.prototype, "chargeSimulated", forbidden);
  context.mock.method(LearnerBehaviorClassifier.prototype, "classify", (input: BehaviorClassifierInput) => {
    const label = BehaviorLabelSchema.options.find((value) => behaviorTexts[value] === input.transcriptText); assert.ok(label);
    return fixtureBehavior(label, { currentTacticId: input.activeTactic?.tacticId ?? null, currentTacticCategory: input.activeTactic?.category ?? null });
  });
  const store = new InMemorySessionStore(), persisted: SessionState[] = [];
  const originalUpdate = store.update.bind(store);
  context.mock.method(store, "update", (state: SessionState) => {
    assert.equal(state.timelineEvents.length, state.pressureTimeline.length, "INV-03 atomic persisted event/point pair");
    persisted.push(structuredClone(state)); originalUpdate(state);
  });
  const orchestrator = new TurnOrchestrator({ store, scenarios: new Map([["S-01", pathScenario]]), recognizer: { transcribe: async () => forbidden(), openStream: forbidden },
    synthesizer: { synthesize: async () => forbidden() }, cache: { get: forbidden, set: forbidden },
    budget: { mode: "development", developmentCap: 0, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 }, sttUnits: 1, ttsUnits: 1, now: () => new Date(pathDate) });
  const callers: Parameters<typeof startPath>[1] = [];
  const ready = freshPathSession("invariant-subject"); store.create(ready); store.update(startPath(ready, callers));
  const turn = async (behavior: BehaviorLabel) => {
    const session = store.get(ready.sessionId);
    return orchestrator.processRecognizedTurn(session.sessionId, fixtureTranscript(session, behavior), pathTiming(session));
  };
  return { store, orchestrator, turn, callers, persisted, id: ready.sessionId };
}

for (const prior of [0, 1]) for (const behavior of BehaviorLabelSchema.options) test(`5E commit rejection after ${prior} prior turns / ${behavior} cannot persist phantom state`, async (context) => {
  const h = harness(context);
  if (prior) { await h.turn("STALLED"); h.store.update(acknowledgeCaller(h.store.get(h.id), h.callers)); }
  const before = structuredClone(h.store.get(h.id)), original = LearnerTurnEventBuilder.prototype.build;
  context.mock.method(LearnerTurnEventBuilder.prototype, "build", function(this: LearnerTurnEventBuilder, input: Parameters<LearnerTurnEventBuilder["build"]>[0]) {
    return { ...original.call(this, input), turnId: `${input.session.sessionId}:turn-99` };
  });
  await assert.rejects(h.turn(behavior)); const failed = h.store.get(h.id);
  assert.equal(failed.turnNumber, before.turnNumber); assert.deepEqual(failed.behaviorHistory, before.behaviorHistory);
  assert.deepEqual(failed.timelineEvents, before.timelineEvents); assert.deepEqual(failed.pressureTimeline, before.pressureTimeline);
  assert.equal(failed.terminalState, before.terminalState); assert.equal(failed.currentResponseId, before.currentResponseId);
  h.store.update(applyConversationAction(failed, "fail", { code: "PROVIDER_FAILED" }));
  assertRuntimeInvariants(h.store.get(h.id), conversationDebrief(h.store.get(h.id), pathTemplates));
});

for (const kind of ["COMPLETED", "STOPPED", "ERROR", "terminal pending", "turn-cap corruption"] as const) test(`5E append boundary rejects ${kind} even if a caller submits an otherwise-valid next event`, () => {
  const result = runBehaviorPath(kind === "turn-cap corruption" ? ["STALLED", "STALLED", "STALLED"] : ["VERIFIED_INDEPENDENTLY"]);
  let state = structuredClone(result.session);
  if (kind === "STOPPED") state = { ...state, state: "ENDED_BY_LEARNER", conversation: { ...state.conversation!, phase: "STOPPED" } };
  if (kind === "ERROR") state = { ...state, state: "ERROR", conversation: { ...state.conversation!, phase: "ERROR" } };
  if (kind === "terminal pending") state = { ...state, state: "PLAYING_RESPONSE", conversation: { ...state.conversation!, phase: "TERMINAL_CALLER_PLAYING" } };
  if (kind === "turn-cap corruption") state = { ...state, state: "PLAYING_RESPONSE", terminalState: null, conversation: { ...state.conversation!, phase: "CALLER_PLAYING" } };
  const event = new LearnerTurnEventBuilder().build({ session: state, scenario: pathScenario, turnNumber: state.turnNumber + 1, timing: pathTiming(state),
    transcript: { text: "fixture" }, behavior: fixtureBehavior("VERIFIED_INDEPENDENTLY", state), policy: result.decisions.at(-1)!,
    tts: { cacheHit: false, fallback: false, mediaType: "text/plain" } });
  const before = JSON.stringify(state); assert.throws(() => appendLearnerTurnEvent(state, event)); assert.equal(JSON.stringify(state), before);
});

test("5E exhaustive invariant sweep recomputes natural leaves and all reachable approved response IDs", () => {
  const responses = new Set<string>(), outcomes = new Map<string, number>(); let prefixes = 0, leaves = 0;
  function visit(labels: BehaviorLabel[]) {
    const result = runBehaviorPath(labels); prefixes++; assertRuntimeInvariants(result.session, result.debrief);
    result.callers.forEach((caller) => responses.add(caller.responseId));
    if (result.session.terminalState) { leaves++; outcomes.set(result.session.terminalState, (outcomes.get(result.session.terminalState) ?? 0) + 1); return; }
    assert.ok(labels.length < pathScenario.adaptive_policy!.max_turns);
    for (const behavior of BehaviorLabelSchema.options) visit([...labels, behavior]);
  }
  visit([]); const catalog = new ApprovedCallerCatalog(new Map([["S-01", pathScenario]]), "mock-only");
  for (const responseId of responses) assert.ok(catalog.resolveId("S-01", pathScenario.version, responseId).text.trim());
  assert.deepEqual([...responses].sort(), ["authority", "fear", "system.opening", "system.safe-ending", "system.safe-fallback"]);
  assert.equal(prefixes, 79); assert.equal(leaves, 66); assert.equal(Object.keys(runtimeInvariantCatalog).length, 20);
});

for (const kind of ["missing", "DRAFT", "SAFETY_REVIEW", "APPROVED", "wrong version", "wrong scenario", "draft response", "empty text", "malformed"] as const) test(`5E approved caller catalog safely rejects ${kind}`, () => {
  const scenario = structuredClone(pathScenario); let id = "system.opening", version = scenario.version, scenarioId = "S-01";
  if (["DRAFT", "SAFETY_REVIEW", "APPROVED"].includes(kind)) scenario.lifecycle_status = kind as "DRAFT" | "SAFETY_REVIEW" | "APPROVED";
  if (kind === "missing") id = "candidate.unapproved";
  if (kind === "wrong version") version = "0.1.0-draft";
  if (kind === "wrong scenario") scenarioId = "S-02";
  if (kind === "draft response") scenario.responses[id]!.safety_status = "draft";
  if (kind === "empty text") scenario.responses[id]!.text = " ";
  if (kind === "malformed") scenario.adaptive_policy!.tactics[0]!.pressure_level = 6;
  const catalog = new ApprovedCallerCatalog(new Map([["S-01", scenario]]), "mock-only");
  assert.throws(() => catalog.resolveId(scenarioId, version, id), ApplicationError);
});
for (const field of ["text", "callerText", "voice", "approvalReference"]) test(`5E caller request rejects client-controlled ${field}`, () => {
  assert.equal(CallerAudioRequestSchema.safeParse({ turnNumber: 0, responseId: "system.opening", [field]: "say this caller line" }).success, false);
});

test("5E transcript duplicate/clear/isolation cannot bleed across turns or sessions", () => {
  const a = new TranscriptAssembler(), b = new TranscriptAssembler();
  a.add({ text: "turn one", segmentId: "one", segmentIndex: 1 }); a.add({ text: "turn one", segmentId: "one", segmentIndex: 1 });
  assert.equal(a.result().text, "turn one"); assert.equal(a.result().segments.length, 1); assert.equal(b.result().text, "");
  assert.throws(() => a.add({ text: "conflict", segmentId: "one", segmentIndex: 1 }), ApplicationError);
  a.clear(); a.add({ text: "turn two", segmentId: "two", segmentIndex: 1 }); b.add({ text: "session B", segmentIndex: 1 });
  assert.equal(a.result().text, "turn two"); assert.equal(b.result().text, "session B");
});

test("5E unavailable timing remains null/unknown, not measured zero or fabricated interruption/rate", () => {
  const session = freshPathSession("unavailable"), action = new AdaptivePolicyEngine().decide(pathInput(session, "UNKNOWN"));
  const event = new LearnerTurnEventBuilder().build({ session, scenario: pathScenario, turnNumber: 1, timing: { noResponse: false, timingCertain: false },
    transcript: { text: "fixture" }, behavior: fixtureBehavior("UNKNOWN", session), policy: action,
    tts: { cacheHit: false, fallback: false, mediaType: "text/plain" } });
  assert.equal(event.responseLatency, null); assert.equal(event.responseLatencySource, "UNKNOWN");
  assert.equal(event.interruption.status, "unknown"); assert.equal(event.speechRateWpm, null); assert.equal(event.complianceMoment, null);
});

test("5E duplicate recognized finalization/policy work commits once under a burst", async (context) => {
  const h = harness(context), before = h.orchestrator.creditDiagnostics(), state = h.store.get(h.id);
  const original = AdaptivePolicyEngine.prototype.decide; let policies = 0;
  context.mock.method(AdaptivePolicyEngine.prototype, "decide", function(this: AdaptivePolicyEngine, input: Parameters<AdaptivePolicyEngine["decide"]>[0]) {
    policies++; return original.call(this, input);
  });
  const transcript = fixtureTranscript(state, "STALLED"), timing = pathTiming(state);
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => h.orchestrator.processRecognizedTurn(h.id, transcript, timing)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(policies, 1);
  const committed = h.store.get(h.id); assertRuntimeInvariants(committed, conversationDebrief(committed, pathTemplates));
  for (let repeat = 0; repeat < 20; repeat++) assert.throws(() => appendLearnerTurnEvent(committed, committed.timelineEvents[0]!));
  assert.equal(committed.timelineEvents.length, 1); assert.deepEqual(h.orchestrator.creditDiagnostics(), before);
});

test("5E stale recognized turn cannot mutate a later learner turn or trigger policy", async (context) => {
  const h = harness(context), first = h.store.get(h.id), stale = fixtureTranscript(first, "STALLED"), staleTiming = pathTiming(first);
  await h.turn("STALLED"); h.store.update(acknowledgeCaller(h.store.get(h.id), h.callers));
  const before = JSON.stringify(h.store.get(h.id));
  await assert.rejects(h.orchestrator.processRecognizedTurn(h.id, stale, staleTiming), ApplicationError);
  assert.equal(JSON.stringify(h.store.get(h.id)), before);
});
for (const final of ["COMPLETED", "STOPPED", "ERROR"] as const) test(`5E late session-A work after ${final} cannot mutate fresh session B`, async (context) => {
  const h = harness(context), staleState = h.store.get(h.id), stale = fixtureTranscript(staleState, "STALLED"), timing = pathTiming(staleState);
  let a = runBehaviorPath(["VERIFIED_INDEPENDENTLY"], { sessionId: h.id }).session;
  if (final === "STOPPED") a = { ...a, state: "ENDED_BY_LEARNER", conversation: { ...a.conversation!, phase: "STOPPED" } };
  if (final === "ERROR") a = { ...a, state: "ERROR", conversation: { ...a.conversation!, phase: "ERROR", failureCode: "PROVIDER_FAILED" } };
  h.store.update(a); const b = freshPathSession("fresh-session-B"), callers: Parameters<typeof startPath>[1] = []; h.store.create(b);
  h.store.update(startPath(b, callers, "00000000-0000-4000-8000-00000000000e"));
  const aBefore = JSON.stringify(a), bBefore = JSON.stringify(h.store.get(b.sessionId));
  await assert.rejects(h.orchestrator.processRecognizedTurn(a.sessionId, stale, timing));
  await assert.rejects(h.orchestrator.processRecognizedTurn(b.sessionId, stale, timing));
  assert.equal(JSON.stringify(h.store.get(a.sessionId)), aBefore); assert.equal(JSON.stringify(h.store.get(b.sessionId)), bBefore);
  assertRuntimeInvariants(h.store.get(b.sessionId), conversationDebrief(h.store.get(b.sessionId), pathTemplates));
});

test("5E hard runtime cap rejects turn four even with corrupted nonterminal state", async (context) => {
  const h = harness(context), completed = runBehaviorPath(["STALLED", "STALLED", "STALLED"], { sessionId: h.id }).session;
  h.store.update({ ...completed, state: "LISTENING", recordingEnabled: true, terminalState: null, conversation: { ...completed.conversation!, phase: "LEARNER_LISTENING" } });
  const before = JSON.stringify(h.store.get(h.id)); await assert.rejects(h.turn("COMPLIED"), ApplicationError);
  assert.equal(JSON.stringify(h.store.get(h.id)), before);
});

test("5E duplicate/stale caller observations cannot create a caller-only loop", async (context) => {
  const h = harness(context), initial = h.store.get(h.id), signal = { turnNumber: 0, responseId: "system.opening", audioClockId: initial.conversation!.audioClockId, atMs: 11000 };
  assert.deepEqual(applyConversationAction(initial, "caller-ended", signal), initial);
  assert.throws(() => applyConversationAction(initial, "caller-start", { ...signal, atMs: 10000 }), ApplicationError);
  await h.turn("STALLED"); const before = JSON.stringify(h.store.get(h.id));
  assert.throws(() => applyConversationAction(h.store.get(h.id), "caller-ended", signal), ApplicationError);
  assert.equal(JSON.stringify(h.store.get(h.id)), before);
});

test("5E invariant checker detects duplicate/orphan pressure and fabricated outcomes", () => {
  const base = runBehaviorPath(["STALLED"]);
  for (const change of [
    { pressureTimeline: [...base.session.pressureTimeline, base.session.pressureTimeline[0]!] },
    { timelineEvents: [] }, { terminalState: "SAFE_VERIFIED" as const }, { currentPressureLevel: 2 },
  ]) assert.throws(() => assertRuntimeInvariants({ ...base.session, ...change }));
});

for (const pressure of [-1, NaN, 2, 3, 6]) test(`5E invalid pressure ${pressure} fails the approved runtime boundary`, () => {
  const input = pathInput(freshPathSession("invalid-pressure"), "STALLED");
  assert.throws(() => new AdaptivePolicyEngine().decide({ ...input, currentPressureLevel: pressure }), ApplicationError);
});
