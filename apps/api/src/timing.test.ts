import assert from "node:assert/strict";
import test from "node:test";
import {
  countFillerWords,
  createSessionMonotonicClock,
  deriveHesitation,
  deriveResponseLatency,
  deriveSpeechRate,
  detectFirstDummySecretDisclosure,
  detectInterruption,
  evaluateSpeechRateBaseline,
  monotonicInstant,
} from "./timing.js";

test("session clock provides a non-decreasing monotonic reference", () => {
  const samples = [500, 506, 503, 519];
  const clock = createSessionMonotonicClock(() => samples.shift() ?? 519);
  assert.equal(clock.now(), 6);
  assert.equal(clock.now(), 6);
  assert.deepEqual(clock.instant(), { monotonicMs: 19, source: "LOCAL_MONOTONIC_CLOCK", precision: "instant" });
});

test("response latency uses one monotonic timeline for immediate, delayed, missing, and negative intervals", () => {
  const callerEnded = monotonicInstant(1_000, "LOCAL_MONOTONIC_CLOCK");
  assert.deepEqual(deriveResponseLatency(callerEnded, monotonicInstant(1_000, "LOCAL_VAD")), {
    valueMs: 0, source: "DERIVED", sourceInputs: ["LOCAL_MONOTONIC_CLOCK", "LOCAL_VAD"], precision: "turn",
  });
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_450, "LOCAL_VAD"))?.valueMs, 450);
  assert.equal(deriveResponseLatency(callerEnded, undefined), undefined);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(900, "LOCAL_VAD")), undefined);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_100, "PROVIDER_TIMESTAMP")), undefined);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_450, "LOCAL_VAD"))?.source, "DERIVED");
});

test("filler evidence counts recognized fillers without retaining the utterance", () => {
  const evidence = countFillerWords("Um, uh, like, you know. Um.");
  assert.deepEqual(evidence, [
    { token: "um", count: 2 }, { token: "uh", count: 1 }, { token: "like", count: 1 }, { token: "you_know", count: 1 },
  ]);
  assert.equal(countFillerWords("um")[0]?.count, 1);
  const hesitation = deriveHesitation(monotonicInstant(2_000, "LOCAL_MONOTONIC_CLOCK"), monotonicInstant(2_650, "LOCAL_VAD"), "Um, let me think.");
  assert.equal(hesitation.preSpeechSilence?.valueMs, 650);
  assert.equal(hesitation.fillerCount, 1);
});

test("speech rate is an approximate transcript word count over a measured duration", () => {
  assert.deepEqual(deriveSpeechRate("Pause and independently verify this claim now.", 60_000), { recognizedWordCount: 7, speechRateWpm: 7 });
  assert.deepEqual(deriveSpeechRate("one two three", 0), { recognizedWordCount: 3 });
  assert.equal(deriveSpeechRate("one two", Number.NaN).speechRateWpm, undefined);
});

test("baseline stays unavailable until enough valid session samples and reports percentage change", () => {
  assert.deepEqual(evaluateSpeechRateBaseline(100, [90]), { baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null });
  const ready = evaluateSpeechRateBaseline(120, [120, 120]);
  assert.deepEqual(ready, { baselineStatus: "available", baselineSpeechRateWpm: 120, speechRateDeltaPercent: 0 });
  assert.equal(evaluateSpeechRateBaseline(180, [], ready.baselineSpeechRateWpm).speechRateDeltaPercent, 50);
  assert.deepEqual(evaluateSpeechRateBaseline(0, [Number.NaN, -2]), { baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null });
  assert.throws(() => evaluateSpeechRateBaseline(90, [], null, 0), /positive integer/);
});

test("interruption depends on certain overlapping local playback and speech timing", () => {
  const playbackStart = monotonicInstant(1_000, "LOCAL_MONOTONIC_CLOCK");
  const playbackEnd = monotonicInstant(2_000, "LOCAL_MONOTONIC_CLOCK");
  const during = detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true });
  assert.equal(during.status, "detected");
  assert.equal(during.at?.monotonicMs, 1_500);
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(2_100, "LOCAL_VAD"), playbackTimingCertain: true }).status, "not_detected");
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerPlaybackActive: true, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true }).status, "detected");
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: false }).status, "unknown");
  assert.equal(detectInterruption({ callerAudioStartedAt: monotonicInstant(1_000, "PROVIDER_TIMESTAMP"), callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true }).status, "unknown");
});

test("first dummy-secret disclosure is segment-level, approximate, and contains no within-segment position", () => {
  const start = monotonicInstant(3_000, "LOCAL_VAD");
  const end = monotonicInstant(3_700, "LOCAL_VAD");
  const result = detectFirstDummySecretDisclosure([
    { text: "I will verify first.", segmentIndex: 0, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
    { text: "Synthetic-alpha is the training token.", segmentIndex: 1, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
    { text: "SYNTHETIC-ALPHA was repeated.", segmentIndex: 2, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
  ], ["SYNTHETIC-ALPHA"]);
  assert.equal(result?.segmentIndex, 1);
  assert.equal(result?.precision, "segment");
  assert.equal(result?.approximate, true);
  assert.equal(result?.timingSource, "LOCAL_VAD");
  assert.equal(result && "wordIndex" in result, false);
  assert.equal(result && "offsetMs" in result, false);
  assert.equal(detectFirstDummySecretDisclosure([{ text: "not a match", segmentIndex: 0, localSegmentStart: start, localSegmentEnd: monotonicInstant(2_900, "LOCAL_VAD"), timingSource: "LOCAL_VAD" }], ["SYNTHETIC-ALPHA"]), null);
});
