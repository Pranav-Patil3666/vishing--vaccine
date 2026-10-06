import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState, endSession, restoreSessionState, transitionConsent, transitionSession } from "./session.js";

test("session state begins without consent and contains no audio field", () => {
  const state = createSessionState({
    sessionId: "session-1",
    scenarioId: "S-01",
    scenarioVersion: "0.1.0",
    language: "pending-verification",
    startingNodeId: "start",
  });
  assert.equal(state.consent.status, "not-requested");
  assert.equal(state.state, "CONSENT_REQUIRED");
  assert.equal(state.recordingEnabled, false);
  assert.equal(state.mode, "demo");
  assert.equal(state.currentTacticId, null);
  assert.equal(state.currentPressureLevel, 0);
  assert.equal(state.maxPressureLevel, 5);
  assert.equal(state.maxTurns, 12);
  assert.equal(state.safeWordState, "armed");
  assert.deepEqual(state.behaviorHistory, []);
  assert.equal(state.baselineSpeechRateWpm, null);
  assert.deepEqual(state.timelineEvents, []);
  assert.equal("audio" in state, false);
});

test("consent must be granted before it can be withdrawn", () => {
  const state = createSessionState({
    sessionId: "session-1",
    scenarioId: "S-01",
    scenarioVersion: "0.1.0",
    language: "pending-verification",
    startingNodeId: "start",
  });
  assert.throws(() => transitionConsent(state, "withdrawn", new Date()), /not allowed/);
  const granted = transitionConsent(state, "granted", new Date("2026-10-06T00:00:00.000Z"));
  assert.equal(granted.consent.status, "granted");
  assert.equal(granted.recordingEnabled, true);
  assert.equal(granted.consent.updatedAt, "2026-10-06T00:00:00.000Z");
  assert.equal(transitionConsent(granted, "withdrawn", new Date()).consent.status, "withdrawn");
});

test("state machine rejects invalid transitions and session end disables recording", () => {
  const state = createSessionState({ sessionId: "s", scenarioId: "S-01", scenarioVersion: "1", language: "pending-verification", startingNodeId: "start" });
  assert.throws(() => transitionSession(state, "LISTENING"), /not allowed/);
  const granted = transitionConsent(state, "granted", new Date());
  assert.throws(() => transitionSession(granted, "TRANSCRIBING"), /not allowed/);
  const ended = endSession(granted, new Date());
  assert.equal(ended.state, "ENDED_BY_LEARNER");
  assert.equal(ended.recordingEnabled, false);
  assert.equal(ended.terminalState, "LEARNER_ENDED");
});

test("replayed session snapshots require consent again", () => {
  const granted = transitionConsent(createSessionState({ sessionId: "s", scenarioId: "S-01", scenarioVersion: "1", language: "pending-verification", startingNodeId: "start" }), "granted", new Date());
  const restored = restoreSessionState(granted);
  assert.equal(restored.state, "CONSENT_REQUIRED");
  assert.equal(restored.recordingEnabled, false);
  assert.equal(restored.consent.status, "not-requested");
  assert.equal("audio" in restored, false);
});
