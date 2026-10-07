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
  DeterministicAudioTimingClock,
  monotonicInstant,
  SpeechRateBaseline,
} from "./timing.js";

test("session clock provides a non-decreasing monotonic reference", () => {
  const samples = [500, 506, 503, 519];
  const clock = createSessionMonotonicClock(() => samples.shift() ?? 519);
  assert.equal(clock.now(), 6);
  assert.equal(clock.now(), 6);
  assert.deepEqual(clock.instant(), { monotonicMs: 19, source: "LOCAL_MONOTONIC_CLOCK", precision: "instant" });
});

test("AudioTimingClock maps development fixtures to one local monotonic reference", () => {
  const timing = new DeterministicAudioTimingClock().capture({
    callerAudioStartedAtMs: 100, callerAudioEndedAtMs: 1_000,
    learnerSpeechStartedAtMs: 1_450, learnerSpeechEndedAtMs: 2_100,
  });
  assert.equal(timing.callerAudioStartedAt?.source, "LOCAL_VAD");
  assert.equal(timing.callerAudioEndedAt?.monotonicMs, 1_000);
  assert.equal(timing.learnerSpeechStartedAt?.monotonicMs, 1_450);
  assert.equal(timing.timingCertain, true);
  assert.equal(new DeterministicAudioTimingClock().capture().timingCertain, false);
  assert.throws(() => new DeterministicAudioTimingClock().capture({ callerAudioStartedAtMs: 10, callerAudioEndedAtMs: 1 }), /Caller playback end/);
});

test("response latency uses caller end to learner start and never returns negative overlap", () => {
  const callerEnded = monotonicInstant(1_000, "LOCAL_MONOTONIC_CLOCK");
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_000, "LOCAL_VAD"))?.valueMs, 0);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_450, "LOCAL_VAD"))?.valueMs, 450);
  assert.equal(deriveResponseLatency(callerEnded, undefined), undefined);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(900, "LOCAL_VAD")), undefined);
  assert.equal(deriveResponseLatency(callerEnded, monotonicInstant(1_450, "PROVIDER_TIMESTAMP")), undefined);
});

test("filler detector counts English, Hindi, and Hinglish phrases without duplicate token passes", () => {
  const evidence = countFillerWords("UM, uh, like, you know. Um. मतलब, हाँ, अच्छा; matlab, haan, achha, toh, yaar.");
  assert.deepEqual(evidence, [
    { token: "um", count: 2 }, { token: "uh", count: 1 }, { token: "like", count: 1 }, { token: "you_know", count: 1 },
    { token: "hindi_matlab", count: 1 }, { token: "hindi_haan", count: 1 }, { token: "hindi_achha", count: 1 },
    { token: "hinglish_matlab", count: 1 }, { token: "hinglish_haan", count: 1 }, { token: "hinglish_achha", count: 1 },
    { token: "hinglish_toh", count: 1 }, { token: "hinglish_yaar", count: 1 },
  ]);
  const hesitation = deriveHesitation(monotonicInstant(2_000, "LOCAL_MONOTONIC_CLOCK"), monotonicInstant(2_650, "LOCAL_VAD"), "Um, let me think.");
  assert.equal(hesitation.preSpeechSilence?.valueMs, 650);
  assert.equal(hesitation.fillerCount, 1);
  assert.equal(deriveHesitation(monotonicInstant(2_000, "LOCAL_MONOTONIC_CLOCK"), monotonicInstant(1_900, "LOCAL_VAD"), "x").preSpeechSilence, undefined);
});

test("speech-rate approximation normalizes words and requires measured positive duration", () => {
  assert.deepEqual(deriveSpeechRate("Pause  and independently verify this claim now.", 60_000), { recognizedWordCount: 7, speechRateWpm: 7 });
  assert.deepEqual(deriveSpeechRate("one two three", 0), { recognizedWordCount: 3 });
  assert.equal(deriveSpeechRate("one two", Number.NaN).speechRateWpm, undefined);
});

test("first sufficiently long valid learner turn establishes a fixed baseline; later turns compare", () => {
  const baseline = new SpeechRateBaseline();
  assert.deepEqual(baseline.evaluate({ currentRate: 100, recognizedWordCount: 4, existingBaseline: null, existingSampleCount: 0 }), {
    baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null, sampleCount: 0,
  });
  assert.deepEqual(baseline.evaluate({ currentRate: undefined, recognizedWordCount: 10, existingBaseline: null, existingSampleCount: 0 }), {
    baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null, sampleCount: 0,
  });
  const first = baseline.evaluate({ currentRate: 120, recognizedWordCount: 8, existingBaseline: null, existingSampleCount: 0 });
  assert.deepEqual(first, { baselineStatus: "available", baselineSpeechRateWpm: 120, speechRateDeltaPercent: null, sampleCount: 1 });
  const later = baseline.evaluate({ currentRate: 180, recognizedWordCount: 8, existingBaseline: first.baselineSpeechRateWpm, existingSampleCount: first.sampleCount });
  assert.equal(later.speechRateDeltaPercent, 50);
  const invalidDuration = deriveSpeechRate("one two three four five", 0);
  assert.equal(baseline.evaluate({ currentRate: invalidDuration.speechRateWpm, recognizedWordCount: invalidDuration.recognizedWordCount, existingBaseline: null, existingSampleCount: 0 }).baselineSpeechRateWpm, null);
});

test("barge-in requires certain active caller playback and records offset when known", () => {
  const playbackStart = monotonicInstant(1_000, "LOCAL_MONOTONIC_CLOCK");
  const playbackEnd = monotonicInstant(2_000, "LOCAL_MONOTONIC_CLOCK");
  const during = detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true });
  assert.equal(during.status, "detected");
  assert.equal(during.offsetMs, 500);
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(2_100, "LOCAL_VAD"), playbackTimingCertain: true }).status, "not_detected");
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerPlaybackActive: true, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true }).status, "detected");
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: false }).status, "unknown");
  assert.equal(detectInterruption({ callerAudioStartedAt: monotonicInstant(1_000, "PROVIDER_TIMESTAMP"), callerAudioEndedAt: playbackEnd, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true }).status, "unknown");
  assert.equal(detectInterruption({ callerAudioStartedAt: playbackStart, callerAudioEndedAt: playbackEnd, callerPlaybackActive: false, learnerSpeechStartedAt: monotonicInstant(1_500, "LOCAL_VAD"), playbackTimingCertain: true }).status, "unknown");
});

test("only fixed synthetic dummy-secret patterns produce a segment-level approximate compliance moment", () => {
  const start = monotonicInstant(3_000, "LOCAL_VAD");
  const end = monotonicInstant(3_700, "LOCAL_VAD");
  const result = detectFirstDummySecretDisclosure([
    { turnId: "s:turn-1", text: "I will verify first.", segmentIndex: 0, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
    { turnId: "s:turn-1", text: "Synthetic secret is SYNTHETIC-SECRET-EXAMPLE.", segmentIndex: 1, segmentId: "seg-1", localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
    { turnId: "s:turn-1", text: "SYNTHETIC-SECRET-EXAMPLE was repeated.", segmentIndex: 2, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" },
  ]);
  assert.equal(result?.turnId, "s:turn-1");
  assert.equal(result?.segmentIndex, 1);
  assert.equal(result?.precision, "segment");
  assert.equal(result?.approximate, true);
  assert.equal(result?.timingSource, "LOCAL_VAD");
  assert.equal(result && "wordIndex" in result, false);
  assert.equal(result && "offsetMs" in result, false);
  assert.equal(detectFirstDummySecretDisclosure([{ turnId: "s:turn-2", text: "My OTP is 123456", segmentIndex: 0, localSegmentStart: start, localSegmentEnd: end, timingSource: "LOCAL_VAD" }]), null);
  const untimed = detectFirstDummySecretDisclosure([{ turnId: "s:turn-3", text: "DUMMY-OTP-EXAMPLE", segmentIndex: 0, timingSource: "UNKNOWN" }]);
  assert.equal(untimed?.timingSource, "UNKNOWN");
  assert.equal(untimed?.localSegmentStart, undefined);
});
