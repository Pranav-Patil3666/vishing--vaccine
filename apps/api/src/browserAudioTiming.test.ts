import assert from "node:assert/strict";
import test from "node:test";
import { BrowserAudioTimingFactsSchema, type BrowserAudioTimingFacts } from "@vaccine/contracts";
import { captureBrowserAudioTiming, summarizeBrowserAudio } from "./browserAudioTiming.js";
import { deriveResponseLatency } from "./timing.js";

const clock = "00000000-0000-4000-8000-000000000001";
function facts(start: number | null = 1200, end: number | null = 1500): BrowserAudioTimingFacts {
  const events: BrowserAudioTimingFacts["events"] = [
    { sessionId: "s", turnNumber: 1, kind: "CALLER_AUDIO_START", at: { monotonicMs: 0, audioClockId: clock, source: "CLIENT_AUDIO_CLOCK", precision: "instant" }, availability: "available" },
    { sessionId: "s", turnNumber: 1, kind: "CALLER_AUDIO_END", at: { monotonicMs: 1000, audioClockId: clock, source: "CLIENT_AUDIO_CLOCK", precision: "instant" }, availability: "available" },
  ];
  if (start !== null) events.push({ sessionId: "s", turnNumber: 1, kind: "LEARNER_SPEECH_START", segmentNumber: 1, at: { monotonicMs: start, audioClockId: clock, source: "LOCAL_VAD", precision: "instant" }, availability: "available" });
  if (end !== null && start !== null) events.push({ sessionId: "s", turnNumber: 1, kind: "LEARNER_SPEECH_END", segmentNumber: 1, at: { monotonicMs: end, audioClockId: clock, source: "LOCAL_VAD", precision: "instant" }, availability: "available" });
  events.sort((a, b) => a.at.monotonicMs - b.at.monotonicMs);
  return { sessionId: "s", turnNumber: 1, audioClockId: clock, timingValid: true, events };
}
test("browser facts reuse canonical backend latency, silence and duration calculations", () => {
  const summary = summarizeBrowserAudio(facts(), 10);
  assert.deepEqual(summary.observations[0], { segmentNumber: 1, responseLatencyMs: 200, preSpeechSilenceMs: 200, speechDurationMs: 300, overlapCandidate: false, interruptionStatus: "unknown" });
  assert.equal(summary.interruptionReportingEnabled, false); assert.equal(summary.speakerBleedValidation, "UNKNOWN");
  assert.equal(captureBrowserAudioTiming(facts()).interruptionReportingEligible, false);
});
test("overlap remains a candidate with null latency; equal timestamps allow canonical zero", () => {
  const overlap = summarizeBrowserAudio(facts(500, 1500), 1).observations[0]!;
  assert.equal(overlap.overlapCandidate, true); assert.equal(overlap.responseLatencyMs, null); assert.equal(overlap.preSpeechSilenceMs, null); assert.equal(overlap.interruptionStatus, "unknown");
  assert.equal(summarizeBrowserAudio(facts(1000), 1).observations[0]?.responseLatencyMs, 0);
});
test("no speech, missing end and compromised timing remain unavailable instead of fake zero values", () => {
  assert.equal(summarizeBrowserAudio(facts(null, null), 0).observations[0]?.responseLatencyMs, null);
  assert.equal(summarizeBrowserAudio(facts(1200, null), 0).observations[0]?.speechDurationMs, null);
  const invalid = { ...facts(), timingValid: false };
  assert.equal(summarizeBrowserAudio(invalid, 0).observations[0]?.responseLatencyMs, null);
});
test("clock identity, page reload, order and provider/server timestamp domains cannot mix", () => {
  const input = facts(); input.events[1]!.at.audioClockId = "00000000-0000-4000-8000-000000000002";
  assert.equal(BrowserAudioTimingFactsSchema.safeParse(input).success, false);
  assert.equal(deriveResponseLatency(facts().events[1]!.at, input.events[1]!.at), undefined);
  const origin = facts().events[1]!.at;
  assert.equal(deriveResponseLatency(origin, { ...origin, source: "PROVIDER_TIMESTAMP" }), undefined);
  assert.equal(deriveResponseLatency(origin, { monotonicMs: 2000, source: "LOCAL_MONOTONIC_CLOCK", precision: "instant" }), undefined);
  assert.equal(BrowserAudioTimingFactsSchema.safeParse({ ...facts(), events: [...facts().events].reverse() }).success, false);
});
test("fact schemas reject PCM, transcript, arbitrary metadata and provider timestamp injection", () => {
  assert.equal(BrowserAudioTimingFactsSchema.safeParse({ ...facts(), audio: [1] }).success, false);
  const input = facts(); Object.assign(input.events[0]!, { transcript: "private" });
  assert.equal(BrowserAudioTimingFactsSchema.safeParse(input).success, false);
  const injected = facts(); Object.assign(injected.events[0]!.at, { providerTimestamp: "2026-10-11T00:00:00Z" });
  assert.equal(BrowserAudioTimingFactsSchema.safeParse(injected).success, false);
});
export { facts as browserFactsFixture };
