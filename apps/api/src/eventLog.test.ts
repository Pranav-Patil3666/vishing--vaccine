import assert from "node:assert/strict";
import test from "node:test";
import type { LearnerTurnEvent } from "@vaccine/contracts";
import { createSessionState } from "./session.js";
import { appendLearnerTurnEvent } from "./eventLog.js";

function newEvent(overrides: Partial<LearnerTurnEvent> = {}): LearnerTurnEvent {
  return {
    sessionId: "session-1", turnId: "turn-1", scenarioId: "S-01", scenarioVersion: "0.1", language: "en",
    callerTacticId: null, callerResponseId: "system.safe-fallback", callerPressureLevel: 0,
    fillerWords: [], fillerCount: 0, speechRateWpm: null, baselineSpeechRateWpm: null, speechRateDeltaPercent: null,
    baselineStatus: "insufficient_data", interruption: { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false },
    behavior: { label: "UNKNOWN", evidenceRuleIds: [], source: "unknown" }, complianceMoment: null, observedEvidenceRuleIds: [],
    ...overrides,
  };
}

function session() {
  return createSessionState({ sessionId: "session-1", scenarioId: "S-01", scenarioVersion: "0.1", language: "en", startingNodeId: "start", maxPressureLevel: 2 });
}

test("event log validates identity and appends only fact-only turn records", () => {
  const appended = appendLearnerTurnEvent(session(), newEvent());
  assert.equal(appended.timelineEvents.length, 1);
  assert.equal(appended.timelineEvents[0]?.turnId, "turn-1");
  assert.equal("transcriptText" in (appended.timelineEvents[0] ?? {}), false);
  assert.throws(() => appendLearnerTurnEvent(session(), newEvent({ sessionId: "other" })), /another session/);
  assert.throws(() => appendLearnerTurnEvent(appended, newEvent()), /Duplicate/);
  assert.throws(() => appendLearnerTurnEvent(session(), newEvent({ callerPressureLevel: 3 })), /maximum/);
});

test("only first segment-level disclosure is retained in a session timeline", () => {
  const disclosure = (turnId: string, segmentIndex: number): LearnerTurnEvent => newEvent({
    turnId,
    behavior: { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules" },
    complianceMoment: {
      segmentIndex,
      localSegmentStart: { monotonicMs: 1_000, source: "LOCAL_VAD", precision: "instant" },
      localSegmentEnd: { monotonicMs: 1_500, source: "LOCAL_VAD", precision: "instant" },
      timingSource: "LOCAL_VAD", precision: "segment", approximate: true,
    },
  });
  const one = appendLearnerTurnEvent(session(), disclosure("turn-1", 0));
  assert.equal(one.timelineEvents[0]?.complianceMoment?.segmentIndex, 0);
  assert.throws(() => appendLearnerTurnEvent(one, disclosure("turn-2", 1)), /Only the first/);
  assert.throws(() => appendLearnerTurnEvent(session(), newEvent({ behavior: { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules" } })), /first dummy-secret/);
  const repeatedWithoutSecondMoment = appendLearnerTurnEvent(one, newEvent({
    turnId: "turn-2",
    behavior: { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules" },
  }));
  assert.equal(repeatedWithoutSecondMoment.timelineEvents[1]?.complianceMoment, null);
});
