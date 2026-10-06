import assert from "node:assert/strict";
import test from "node:test";
import { AudioInputSchema, SpeechSynthesisRequestSchema, TranscriptEventSchema } from "./domain.js";
import { LearnerTurnEventSchema } from "./pressure.js";

test("transcript contract keeps provider metadata and measurement fields optional", () => {
  const event = TranscriptEventSchema.parse({
    eventId: "event-1",
    sessionId: "session-1",
    turnNumber: 0,
    text: "",
    language: "language-pending-verification",
    normalizationStatus: "unchanged",
  });

  assert.equal(event.providerMetadata, undefined);
  assert.equal(event.timing, undefined);
  assert.equal(event.confidence, undefined);
});

test("audio input is represented as transient bytes without a persistence field", () => {
  const input = AudioInputSchema.parse({ bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual([...input.bytes], [1, 2, 3]);
  assert.equal("persist" in input, false);
});

test("caller synthesis contract requires a reviewed response identity instead of arbitrary text input", () => {
  assert.equal(SpeechSynthesisRequestSchema.safeParse({ responseId: "x", text: "free text", language: "en", voice: "v" }).success, false);
  assert.equal(SpeechSynthesisRequestSchema.safeParse({
    scenarioId: "S-01", scenarioVersion: "0.1", responseId: "opening",
    language: "en", voice: "voice-approved", safetyStatus: "reviewed_safe", scenarioReviewStatus: "approved",
    approvalReference: "S-01@0.1:opening",
  }).success, true);
  assert.equal(SpeechSynthesisRequestSchema.safeParse({
    scenarioId: "S-01", scenarioVersion: "0.1", responseId: "opening", text: "No text field in provider requests.",
    language: "en", voice: "voice-approved", safetyStatus: "reviewed_safe", scenarioReviewStatus: "approved",
    approvalReference: "S-01@0.1:opening",
  }).success, false);
});

test("learner event is fact-only and rejects transcript or audio persistence properties", () => {
  const event = {
    sessionId: "session-1", turnId: "session-1:turn-1", scenarioId: "S-01", scenarioVersion: "0.1", language: "en",
    callerTacticId: null, callerResponseId: "system.safe-fallback", callerPressureLevel: 0,
    fillerWords: [{ token: "um", count: 1 }], fillerCount: 1, speechRateWpm: null, baselineSpeechRateWpm: null,
    speechRateDeltaPercent: null, baselineStatus: "insufficient_data", interruption: { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false },
    behavior: { label: "UNKNOWN", evidenceRuleIds: [], source: "unknown" }, complianceMoment: null, observedEvidenceRuleIds: ["filler.um"],
  };
  assert.equal(LearnerTurnEventSchema.safeParse(event).success, true);
  assert.equal(LearnerTurnEventSchema.safeParse({ ...event, rawAudio: new Uint8Array([1]) }).success, false);
  assert.equal(LearnerTurnEventSchema.safeParse({ ...event, transcriptText: "private text" }).success, false);
});
