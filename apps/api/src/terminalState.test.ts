import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BehaviorLabelSchema, type BehaviorLabel, type SessionState } from "@vaccine/contracts";
import { validateScenarioDocument } from "@vaccine/scenario-schema";
import { AdaptivePolicyEngine, type AdaptivePolicyInput } from "./adaptivePolicy.js";
import { applyConversationAction } from "./conversationRuntime.js";
import { conversationDebrief, readConversationTemplates } from "./conversationDebrief.js";
import { ApplicationError } from "./errors.js";
import { appendLearnerTurnEvent } from "./eventLog.js";
import { LearnerTurnEventBuilder } from "./learnerTurnEventBuilder.js";
import { buildPressureTimelinePoint } from "./debriefEngine.js";
import { createSessionState, endSession, transitionConsent } from "./session.js";

const scenario = validateScenarioDocument(JSON.parse(readFileSync("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
const templates = readConversationTemplates("content/authoring/S-01-hi-IN.package.json", scenario);
const engine = new AdaptivePolicyEngine(), clock = "00000000-0000-4000-8000-000000000005";
const instant = (monotonicMs: number, source: "CLIENT_AUDIO_CLOCK" | "LOCAL_VAD") => ({ monotonicMs, source, precision: "instant" as const, audioClockId: clock });
function ready(sessionId = "terminal-test"): SessionState {
  return { ...transitionConsent(createSessionState({ sessionId, scenarioId: "S-01", scenarioVersion: scenario.version,
    language: "hi-IN", startingNodeId: "start", runtimeMode: "REAL_CONVERSATION", mode: "safe", maxTurns: 3,
    maxPressureLevel: scenario.adaptive_policy!.max_pressure_level, scenarioRuntimeStatus: "RUNTIME_ELIGIBLE" }), "granted", new Date("2026-10-24T00:00:00Z")), currentResponseId: "system.opening" };
}
function policyInput(session: SessionState, behavior: BehaviorLabel): AdaptivePolicyInput {
  return { scenario, behavior, turnNumber: session.turnNumber + 1, currentPressureLevel: session.currentPressureLevel,
    previousTacticIds: session.previousTacticIds,
    previousResponseIds: session.timelineEvents.flatMap((event) => event.selectedNextResponseId ? [event.selectedNextResponseId] : []), learnerText: "",
    sessionState: { scenarioId: session.scenarioId, scenarioVersion: session.scenarioVersion, currentNodeId: session.currentNodeId,
      turnNumber: session.turnNumber, terminalState: session.terminalState, state: session.state,
      currentTacticId: session.currentTacticId, currentResponseId: session.currentResponseId } };
}
function signal(session: SessionState, atMs: number) {
  return { turnNumber: session.turnNumber, responseId: session.currentResponseId, audioClockId: clock, atMs };
}
function playback(session: SessionState): SessionState {
  const start = (session.turnNumber + 1) * 10000;
  const playing = applyConversationAction(session, "caller-start", signal(session, start));
  assert.deepEqual(applyConversationAction(playing, "caller-start", signal(playing, start)), playing);
  return applyConversationAction(playing, "caller-ended", signal(playing, start + 1000));
}
function opening(): SessionState { return playback(applyConversationAction(ready(), "start", { audioClockId: clock })); }
function commit(session: SessionState, behavior: BehaviorLabel): SessionState {
  const action = engine.decide(policyInput(session, behavior)), caller = session.conversation!.caller!;
  const event = new LearnerTurnEventBuilder().build({ session, scenario, turnNumber: session.turnNumber + 1,
    behavior: { label: behavior, source: "deterministic_rules", evidenceRuleIds: [], safetySignals: [], context: {
      activeTacticId: session.currentTacticId, activeTacticCategory: session.currentTacticCategory, relevantRedFlagIds: [] } },
    transcript: { text: behavior === "DISCLOSED_DUMMY_SECRET" ? "DUMMY-4821" : "observable words only" }, dummySecretTokens: ["DUMMY-4821"],
    timing: { callerAudioStartedAt: instant(caller.startedAtMs, "CLIENT_AUDIO_CLOCK"), callerAudioEndedAt: instant(caller.endedAtMs!, "CLIENT_AUDIO_CLOCK"),
      learnerSpeechStartedAt: instant(caller.endedAtMs! + 400, "LOCAL_VAD"), learnerSpeechEndedAt: instant(caller.endedAtMs! + 1400, "LOCAL_VAD"), noResponse: false, timingCertain: true },
    policy: action, tts: { cacheHit: true, fallback: false, mediaType: "audio/wav" } });
  const appended = appendLearnerTurnEvent(session, event);
  return { ...appended, turnNumber: session.turnNumber + 1, state: "PLAYING_RESPONSE", recordingEnabled: false,
    currentTacticId: action.tacticId, currentTacticCategory: action.tacticCategory, currentResponseId: action.responseId,
    currentPressureLevel: action.nextPressureLevel, terminalState: action.terminalState,
    previousTacticIds: action.tacticId ? [...session.previousTacticIds, action.tacticId] : [...session.previousTacticIds],
    pressureTimeline: [...session.pressureTimeline, buildPressureTimelinePoint(event)],
    conversation: { audioClockId: clock, phase: action.terminalState ? "TERMINAL_CALLER_PREPARING" : "CALLER_PREPARING" } };
}
const invalid = (error: unknown) => { assert.ok(error instanceof ApplicationError); assert.equal(error.code, "INVALID_STATE"); return true; };

test("5C every reachable terminal leaf commits once, completes after acknowledged audio, retains deterministic debrief and rejects re-entry", (context) => {
  const forbidden = () => assert.fail("Terminal lifecycle attempted provider/random dependency");
  context.mock.method(globalThis, "fetch", forbidden); context.mock.method(Math, "random", forbidden);
  let decisions = 0, leaves = 0;
  const outcomes = new Map<string, number>();
  function visit(session: SessionState) {
    for (const behavior of BehaviorLabelSchema.options) {
      const before = JSON.stringify(session), next = commit(session, behavior); decisions++;
      assert.equal(JSON.stringify(session), before); assert.equal(next.timelineEvents.length, next.turnNumber);
      assert.equal(next.pressureTimeline.length, next.turnNumber);
      assert.equal(next.timelineEvents.at(-1)!.callerPressureLevel, session.currentPressureLevel);
      if (!next.terminalState) { assert.ok(next.turnNumber < next.maxTurns); visit(playback(next)); continue; }
      leaves++; outcomes.set(next.terminalState, (outcomes.get(next.terminalState) ?? 0) + 1);
      assert.equal(next.currentTacticId, null); assert.ok([0, 1].includes(next.currentPressureLevel));
      assert.equal(next.currentPressureLevel, session.currentPressureLevel);
      assert.equal(next.currentResponseId, next.terminalState === "SAFE_FALLBACK" ? "system.safe-fallback" : "system.safe-ending");
      assert.equal(scenario.responses[next.currentResponseId!]!.safety_status, "system_safe_template");
      assert.equal(conversationDebrief(next, templates)!.completionKind, "in_progress");
      const completed = playback(next), debrief = conversationDebrief(completed, templates)!;
      assert.equal(completed.state, "COMPLETED"); assert.equal(completed.recordingEnabled, false);
      assert.equal(completed.conversation!.phase, "COMPLETED"); assert.equal(debrief.completionKind, "complete");
      assert.equal(debrief.terminalOutcome, next.terminalState); assert.deepEqual(debrief, conversationDebrief(completed, templates));
      assert.deepEqual(completed.timelineEvents, next.timelineEvents); assert.deepEqual(completed.pressureTimeline, next.pressureTimeline);
      assert.equal(completed.timelineEvents.filter((event) => event.complianceMoment).length, behavior === "DISCLOSED_DUMMY_SECRET" ? 1 : 0);
      if (behavior === "DISCLOSED_DUMMY_SECRET") assert.equal(debrief.firstComplianceMoment!.turnId, `${completed.sessionId}:turn-${completed.turnNumber}`);
      assert.deepEqual(applyConversationAction(completed, "fail", { code: "PROVIDER_FAILED" }), completed);
      assert.deepEqual(endSession(completed, new Date("2026-10-24T01:00:00Z")), completed);
      for (const staleBehavior of BehaviorLabelSchema.options) assert.throws(() => engine.decide(policyInput(completed, staleBehavior)), invalid);
      for (const staleAction of ["start", "caller-start", "caller-ended"]) assert.throws(() => applyConversationAction(completed, staleAction,
        staleAction === "start" ? { audioClockId: clock } : signal(completed, 99999)), invalid);
    }
  }
  visit(opening()); assert.equal(decisions, 78); assert.equal(leaves, 66);
  assert.deepEqual(Object.fromEntries(outcomes), { SAFE_VERIFIED: 13, DUMMY_SECRET_DISCLOSED: 13, MAX_TURNS: 36, SAFE_FALLBACK: 4 });
});

test("5C stopping terminal playback preserves its causal outcome and yields partial, never complete, debrief", () => {
  const committed = commit(opening(), "VERIFIED_INDEPENDENTLY");
  const playing = applyConversationAction(committed, "caller-start", signal(committed, 20000));
  const stopped = endSession(playing, new Date("2026-10-24T01:00:00Z"));
  assert.equal(stopped.conversation!.phase, "STOPPED"); assert.equal(stopped.state, "ENDED_BY_LEARNER");
  assert.equal(stopped.terminalState, "SAFE_VERIFIED"); assert.deepEqual(stopped.timelineEvents, committed.timelineEvents);
  assert.equal(conversationDebrief(stopped, templates)!.completionKind, "partial");
  assert.throws(() => applyConversationAction(stopped, "caller-ended", signal(stopped, 21000)), invalid);
});

test("5C technical failure after committed terminal event remains ERROR with its outcome/evidence, including repeated fail/end", () => {
  const committed = commit(opening(), "DISCLOSED_DUMMY_SECRET");
  const failed = applyConversationAction(committed, "fail", { code: "CALLER_AUDIO_FAILED", technical: { stage: "TTS_CACHE", causeCode: "TTS_PROVIDER_FAILED", providerAttempted: false } });
  assert.equal(failed.state, "ERROR"); assert.equal(failed.terminalState, "DUMMY_SECRET_DISCLOSED");
  assert.equal(conversationDebrief(failed, templates)!.completionKind, "partial"); assert.deepEqual(failed.timelineEvents, committed.timelineEvents);
  assert.deepEqual(applyConversationAction(failed, "fail", { code: "PROVIDER_FAILED" }), failed);
  assert.deepEqual(endSession(failed, new Date("2026-10-24T01:00:00Z")), failed);
  assert.throws(() => engine.decide(policyInput(failed, "COMPLIED")), invalid);
});

test("5C new session after completed/stopped/error resets outcome, pressure, events and clock identity", () => {
  const completed = playback(commit(opening(), "VERIFIED_INDEPENDENTLY"));
  for (const previous of [completed, endSession(opening(), new Date("2026-10-24T01:00:00Z")), applyConversationAction(opening(), "fail", { code: "PROVIDER_FAILED" })]) {
    const fresh = ready(`${previous.sessionId}-new`), newClock = "00000000-0000-4000-8000-000000000006";
    const started = applyConversationAction(fresh, "start", { audioClockId: newClock });
    assert.notEqual(started.sessionId, previous.sessionId); assert.notEqual(started.conversation!.audioClockId, previous.conversation!.audioClockId);
    assert.equal(started.currentPressureLevel, 0); assert.equal(started.terminalState, null);
    assert.deepEqual(started.timelineEvents, []); assert.deepEqual(started.pressureTimeline, []); assert.equal(started.conversation!.caller, undefined);
  }
});
