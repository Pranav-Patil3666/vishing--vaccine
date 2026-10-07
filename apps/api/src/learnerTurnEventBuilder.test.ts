import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { BehaviorClassification } from "@vaccine/contracts";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { selectAdaptiveAction } from "./adaptivePolicy.js";
import { LearnerTurnEventBuilder } from "./learnerTurnEventBuilder.js";
import { appendLearnerTurnEvent } from "./eventLog.js";
import { createSessionState } from "./session.js";
import { DeterministicAudioTimingClock } from "./timing.js";

const scenario = validateScenarioDocument(JSON.parse(readFileSync(resolve(process.cwd(), "content/scenarios/S-01-urgent-account-verification.json"), "utf8")) as unknown) as ScenarioDocument;
const behavior: BehaviorClassification = { label: "UNKNOWN", evidenceRuleIds: [], source: "unknown", context: { activeTacticId: null, activeTacticCategory: null, relevantRedFlagIds: [] }, safetySignals: [] };

function build(input: { text?: string; fixture?: Parameters<DeterministicAudioTimingClock["capture"]>[0]; session?: ReturnType<typeof createSessionState> }) {
  const session = input.session ?? createSessionState({ sessionId: "event-builder", scenarioId: scenario.scenario_id, scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" });
  const timing = new DeterministicAudioTimingClock().capture(input.fixture);
  const text = input.text ?? "";
  const observedBehavior: BehaviorClassification = text.includes("SYNTHETIC-SECRET-EXAMPLE")
    ? { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules", context: { activeTacticId: null, activeTacticCategory: null, relevantRedFlagIds: [] }, safetySignals: [] }
    : behavior;
  const policy = selectAdaptiveAction({ scenario, behavior: observedBehavior.label, turnNumber: 1, currentPressureLevel: session.currentPressureLevel, previousTacticIds: [], learnerText: text });
  return new LearnerTurnEventBuilder().build({
    session, scenario, turnNumber: session.turnNumber + 1, timing,
    transcript: { text, segmentIndex: 2, segmentId: "mock-segment-2" },
    behavior: observedBehavior, policy, tts: { cacheHit: false, fallback: false, mediaType: "application/x-vaccine-mock-audio" },
  });
}

test("builder records delayed response latency, local speech duration, filler evidence, and first speech baseline", () => {
  const event = build({
    text: "Um, I will pause and verify through the official channel.",
    fixture: { callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1_000, learnerSpeechStartedAtMs: 1_450, learnerSpeechEndedAtMs: 2_450 },
  });
  assert.equal(event.responseLatency?.valueMs, 450);
  assert.equal(event.preSpeechSilence?.valueMs, 450);
  assert.equal(event.speechDuration?.valueMs, 1_000);
  assert.equal(event.fillerCount, 1);
  assert.equal(event.baselineStatus, "available");
  assert.equal(event.baselineSpeechRateSampleCount, 1);
  assert.equal(event.speechRateDeltaPercent, null);
  assert.equal(event.policyDecisionCode, "DRAFT_SAFE_FALLBACK");
  assert.equal(event.cacheHit, false);
  assert.deepEqual(event.timingEvents.map((marker) => marker.type), [
    "CALLER_AUDIO_START", "CALLER_AUDIO_END", "LEARNER_SPEECH_START", "LEARNER_SPEECH_END",
  ]);
});

test("overlapping learner speech is a barge-in with null latency and non-negative offset", () => {
  const event = build({
    text: "I refuse to share that.",
    fixture: { callerAudioStartedAtMs: 1_000, callerAudioEndedAtMs: 2_000, learnerSpeechStartedAtMs: 1_500, learnerSpeechEndedAtMs: 2_200 },
  });
  assert.equal(event.responseLatency, null);
  assert.equal(event.interruption.status, "detected");
  assert.equal(event.interruption.offsetMs, 500);
  assert.deepEqual(event.timingEvents.map((marker) => marker.type), [
    "CALLER_AUDIO_START", "LEARNER_SPEECH_START", "CALLER_AUDIO_END", "LEARNER_SPEECH_END",
  ]);
});

test("no response and unavailable timing stay null instead of manufacturing latency or speech rate", () => {
  const event = build({ text: "", fixture: { noResponse: true } });
  assert.equal(event.responseLatency, null);
  assert.equal(event.speechDuration, null);
  assert.equal(event.speechRateWpm, null);
  assert.equal(event.baselineStatus, "insufficient_data");
  assert.equal(event.interruption.status, "unknown");
});

test("synthetic disclosure is first-per-session and logs only segment metadata, never the token", () => {
  const session = createSessionState({ sessionId: "disclosure-event", scenarioId: scenario.scenario_id, scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" });
  const first = build({ text: "The synthetic token is SYNTHETIC-SECRET-EXAMPLE.", fixture: { learnerSpeechStartedAtMs: 1_000, learnerSpeechEndedAtMs: 1_400 }, session });
  assert.equal(first.behavior.label, "DISCLOSED_DUMMY_SECRET");
  assert.equal(first.complianceMoment?.turnId, first.turnId);
  assert.equal(first.complianceMoment?.segmentIndex, 2);
  assert.equal(first.complianceMoment?.approximate, true);
  assert.equal(JSON.stringify(first).includes("SYNTHETIC-SECRET-EXAMPLE"), false);
  const updated = appendLearnerTurnEvent(session, { ...first, behavior: { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules", context: { activeTacticId: null, activeTacticCategory: null, relevantRedFlagIds: [] }, safetySignals: [] } });
  const second = build({ text: "SYNTHETIC-SECRET-EXAMPLE again.", fixture: { learnerSpeechStartedAtMs: 2_000, learnerSpeechEndedAtMs: 2_300 }, session: updated });
  assert.equal(second.complianceMoment, null);
});
