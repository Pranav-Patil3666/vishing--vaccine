import assert from "node:assert/strict";
import test from "node:test";
import type { LearnerTurnEvent, TimingInstant } from "@vaccine/contracts";
import { buildDeterministicDebrief } from "./debriefEngine.js";

const instant = (monotonicMs: number): TimingInstant => ({ monotonicMs, source: "LOCAL_VAD", precision: "instant" });

function event(overrides: Partial<LearnerTurnEvent> = {}): LearnerTurnEvent {
  return {
    sessionId: "session-1", turnId: "turn-1", scenarioId: "S-01", scenarioVersion: "0.2", language: "en",
    callerTacticId: "tactic-1", callerResponseId: "response-1", callerPressureLevel: 1,
    fillerWords: [], fillerCount: 0, speechRateWpm: null, baselineSpeechRateWpm: null, speechRateDeltaPercent: null,
    baselineStatus: "insufficient_data",
    interruption: { status: "not_detected", source: "DERIVED", playbackTimingCertain: true },
    behavior: { label: "VERIFIED_INDEPENDENTLY", evidenceRuleIds: ["behavior.verify_independent"], source: "deterministic_rules" },
    complianceMoment: null, observedEvidenceRuleIds: ["behavior.verify_independent"],
    ...overrides,
  };
}

test("debrief statements and pressure timeline trace directly to event facts", () => {
  const first = event({
    responseLatency: { valueMs: 320, source: "DERIVED", sourceInputs: ["LOCAL_MONOTONIC_CLOCK", "LOCAL_VAD"], precision: "turn" },
    preSpeechSilence: { valueMs: 320, source: "DERIVED", sourceInputs: ["LOCAL_MONOTONIC_CLOCK", "LOCAL_VAD"], precision: "turn" },
    fillerWords: [{ token: "um", count: 1 }], fillerCount: 1,
    speechDuration: { valueMs: 2_000, source: "DERIVED", sourceInputs: ["LOCAL_VAD", "LOCAL_VAD"], precision: "turn" },
    recognizedWordCount: 4, speechRateWpm: 120, baselineSpeechRateWpm: 100, speechRateDeltaPercent: 20, baselineStatus: "available",
  });
  const second = event({
    turnId: "turn-2", callerPressureLevel: 3,
    behavior: { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules" },
    complianceMoment: {
      segmentIndex: 4, localSegmentStart: instant(5_000), localSegmentEnd: instant(5_700),
      timingSource: "LOCAL_VAD", precision: "segment", approximate: true,
    },
    observedEvidenceRuleIds: ["behavior.synthetic_dummy_secret_match"],
  });
  const result = buildDeterministicDebrief([first, second]);
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.pressureTimeline[0]?.callerPressureLevel, 1);
  assert.equal(result.pressureTimeline[1]?.callerPressureLevel, 3);
  assert.equal(result.pressureTimeline[0]?.responseLatency?.valueMs, 320);
  assert.match(result.statements.find((statement) => statement.kind === "latency")?.text ?? "", /320 ms/);
  assert.match(result.statements.find((statement) => statement.kind === "hesitation")?.text ?? "", /320 ms/);
  assert.match(result.statements.find((statement) => statement.kind === "filler")?.text ?? "", /1 filler word/);
  assert.match(result.statements.find((statement) => statement.kind === "speech_rate")?.text ?? "", /120 words per minute/);
  assert.match(result.statements.find((statement) => statement.eventFact.includes("speechRateDeltaPercent"))?.text ?? "", /20%/);
  assert.match(result.statements.find((statement) => statement.kind === "compliance")?.text ?? "", /segment 4 \(approximate segment timing\)/);
  assert.equal(result.firstComplianceMoment?.segmentIndex, 4);
  assert.equal(result.pressureTimeline[1]?.approximateTiming, true);
  assert.equal(result.statements.some((statement) => /scared|nervous|anxious|intimidated|panicked/i.test(statement.text)), false);
});

test("debrief marks unavailable interruption timing and does not invent latency", () => {
  const result = buildDeterministicDebrief([event({
    responseLatency: undefined,
    interruption: { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false },
  })]);
  assert.equal(result.statements.some((statement) => statement.kind === "latency"), false);
  assert.match(result.statements.find((statement) => statement.eventFact === "interruption=unknown")?.text ?? "", /uncertain or missing/);
});

test("debrief cannot combine events from separate sessions", () => {
  assert.throws(() => buildDeterministicDebrief([event(), event({ sessionId: "other" })]), /different sessions/);
});
