import { performance } from "node:perf_hooks";
import type { AudioTimingFixture } from "@vaccine/contracts";
import { AudioTimingFixtureSchema } from "@vaccine/contracts";
import {
  type ComplianceMoment,
  type FillerEvidence,
  type FillerWord,
  type InterruptionStatus,
  type TimingInstant,
  type TimingSource,
  type TimingValue,
} from "@vaccine/contracts";

const fillerDictionary: ReadonlyArray<{ token: FillerWord; phrases: readonly string[] }> = [
  { token: "um", phrases: ["um"] },
  { token: "uh", phrases: ["uh"] },
  { token: "erm", phrases: ["erm"] },
  { token: "uhm", phrases: ["uhm"] },
  { token: "hmm", phrases: ["hmm"] },
  { token: "like", phrases: ["like"] },
  { token: "you_know", phrases: ["you know"] },
  { token: "hindi_matlab", phrases: ["मतलब"] },
  { token: "hindi_haan", phrases: ["हाँ", "हां"] },
  { token: "hindi_achha", phrases: ["अच्छा", "अछा"] },
  { token: "hindi_arey", phrases: ["अरे"] },
  { token: "hindi_hmm", phrases: ["हम्म"] },
  { token: "hinglish_matlab", phrases: ["matlab"] },
  { token: "hinglish_haan", phrases: ["haan", "han"] },
  { token: "hinglish_achha", phrases: ["achha", "acha"] },
  { token: "hinglish_toh", phrases: ["toh"] },
  { token: "hinglish_yaar", phrases: ["yaar"] },
];

export interface SessionMonotonicClock {
  now(): number;
  instant(source?: "LOCAL_MONOTONIC_CLOCK" | "LOCAL_VAD" | "CLIENT_AUDIO_CLOCK"): TimingInstant;
}

/** Creates one session-relative monotonic reference; wall-clock values are never subtracted from it. */
export function createSessionMonotonicClock(readClock: () => number = () => performance.now()): SessionMonotonicClock {
  const origin = readClock();
  let last = 0;
  const now = () => {
    const relative = readClock() - origin;
    if (!Number.isFinite(relative)) throw new RangeError("Monotonic clock returned a non-finite value.");
    last = Math.max(last, 0, relative);
    return last;
  };
  return {
    now,
    instant: (source = "LOCAL_MONOTONIC_CLOCK") => monotonicInstant(now(), source),
  };
}

export interface CapturedAudioTiming {
  callerAudioStartedAt?: TimingInstant;
  callerAudioEndedAt?: TimingInstant;
  learnerSpeechStartedAt?: TimingInstant;
  learnerSpeechEndedAt?: TimingInstant;
  callerPlaybackActive?: boolean;
  noResponse: boolean;
  timingCertain: boolean;
}

/** Minimal adapter boundary for future browser audio clocks and deterministic mock fixtures. */
export interface AudioTimingClock {
  capture(fixture?: AudioTimingFixture): CapturedAudioTiming;
}

export class DeterministicAudioTimingClock implements AudioTimingClock {
  capture(input?: AudioTimingFixture): CapturedAudioTiming {
    if (!input) return { noResponse: false, timingCertain: false };
    const fixture = AudioTimingFixtureSchema.parse(input);
    const source = "LOCAL_VAD" as const;
    const instant = (value: number | null | undefined) => value == null ? undefined : monotonicInstant(value, source);
    const callerAudioStartedAt = instant(fixture.callerAudioStartedAtMs);
    const callerAudioEndedAt = instant(fixture.callerAudioEndedAtMs);
    const learnerSpeechStartedAt = fixture.noResponse ? undefined : instant(fixture.learnerSpeechStartedAtMs);
    const learnerSpeechEndedAt = fixture.noResponse ? undefined : instant(fixture.learnerSpeechEndedAtMs);
    const callerPlaybackActive = fixture.callerPlaybackActive
      ?? (callerAudioStartedAt !== undefined && callerAudioEndedAt !== undefined
        ? callerAudioEndedAt.monotonicMs > (learnerSpeechStartedAt?.monotonicMs ?? callerAudioEndedAt.monotonicMs)
        : undefined);
    return {
      ...(callerAudioStartedAt ? { callerAudioStartedAt } : {}),
      ...(callerAudioEndedAt ? { callerAudioEndedAt } : {}),
      ...(learnerSpeechStartedAt ? { learnerSpeechStartedAt } : {}),
      ...(learnerSpeechEndedAt ? { learnerSpeechEndedAt } : {}),
      ...(callerPlaybackActive === undefined ? {} : { callerPlaybackActive }),
      noResponse: fixture.noResponse ?? false,
      timingCertain: true,
    };
  }
}

export function deriveElapsed(start?: TimingInstant, end?: TimingInstant): TimingValue | undefined {
  if (!start || !end || !isOnLocalTimeline(start.source) || !isOnLocalTimeline(end.source) || end.monotonicMs < start.monotonicMs) return undefined;
  return {
    valueMs: end.monotonicMs - start.monotonicMs,
    source: "DERIVED",
    sourceInputs: [start.source, end.source],
    precision: "turn",
  };
}

/** Caller playback end → learner speech start. An overlap is represented as interruption, never negative latency. */
export function deriveResponseLatency(callerAudioEndedAt?: TimingInstant, learnerSpeechStartedAt?: TimingInstant): TimingValue | undefined {
  return deriveElapsed(callerAudioEndedAt, learnerSpeechStartedAt);
}

/** Counts each non-overlapping configured phrase once after Unicode normalization and case folding. */
export function countFillerWords(text: string, dictionary: ReadonlyArray<{ token: FillerWord; phrases: readonly string[] }> = fillerDictionary): FillerEvidence[] {
  const phrases = new Map<string, FillerWord>(dictionary.flatMap(({ token, phrases: entries }) => entries.map((phrase) => [phrase.normalize("NFKC").toLocaleLowerCase(), token] as const)));
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...phrases.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const counts = new Map<FillerWord, number>();
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  for (const match of normalized.matchAll(expression)) {
    const phrase = match[0]?.toLocaleLowerCase();
    const token = phrase ? phrases.get(phrase) : undefined;
    if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return dictionary.flatMap(({ token }) => {
    const count = counts.get(token) ?? 0;
    return count > 0 ? [{ token, count }] : [];
  });
}

/** Pre-speech silence is specifically caller playback end → first learner speech start on the same local timeline. */
export function deriveHesitation(callerAudioEndedAt: TimingInstant | undefined, learnerSpeechStartedAt: TimingInstant | undefined, transcriptText: string): {
  preSpeechSilence?: TimingValue;
  fillerWords: FillerEvidence[];
  fillerCount: number;
} {
  const fillerWords = countFillerWords(transcriptText);
  const preSpeechSilence = deriveElapsed(callerAudioEndedAt, learnerSpeechStartedAt);
  return {
    ...(preSpeechSilence ? { preSpeechSilence } : {}),
    fillerWords,
    fillerCount: fillerWords.reduce((sum, item) => sum + item.count, 0),
  };
}

export function deriveSpeechRate(text: string, speechDurationMs: number): { recognizedWordCount: number; speechRateWpm?: number } {
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const recognizedWordCount = (normalized.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;
  if (!Number.isFinite(speechDurationMs) || speechDurationMs <= 0 || recognizedWordCount === 0) return { recognizedWordCount };
  return { recognizedWordCount, speechRateWpm: recognizedWordCount / (speechDurationMs / 60_000) };
}

export interface SpeechRateBaselineResult {
  baselineStatus: "insufficient_data" | "available";
  baselineSpeechRateWpm: number | null;
  speechRateDeltaPercent: number | null;
  sampleCount: number;
}

/** First valid turn with at least five normalized transcript words establishes a fixed session-local baseline. */
export class SpeechRateBaseline {
  evaluate(input: {
    currentRate: number | undefined;
    recognizedWordCount: number;
    existingBaseline: number | null;
    existingSampleCount: number;
  }): SpeechRateBaselineResult {
    const validRate = input.currentRate !== undefined && Number.isFinite(input.currentRate) && input.currentRate > 0;
    const hasBaseline = input.existingBaseline !== null && Number.isFinite(input.existingBaseline) && input.existingBaseline > 0;
    if (hasBaseline) {
      return {
        baselineStatus: "available",
        baselineSpeechRateWpm: input.existingBaseline,
        speechRateDeltaPercent: validRate ? ((input.currentRate! - input.existingBaseline!) / input.existingBaseline!) * 100 : null,
        sampleCount: input.existingSampleCount,
      };
    }
    if (validRate && input.recognizedWordCount >= 5) {
      return { baselineStatus: "available", baselineSpeechRateWpm: input.currentRate!, speechRateDeltaPercent: null, sampleCount: 1 };
    }
    return { baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null, sampleCount: input.existingSampleCount };
  }
}

export interface InterruptionInput {
  callerAudioStartedAt?: TimingInstant;
  callerAudioEndedAt?: TimingInstant;
  learnerSpeechStartedAt?: TimingInstant;
  callerPlaybackActive?: boolean;
  playbackTimingCertain: boolean;
}

export function detectInterruption(input: InterruptionInput): { status: InterruptionStatus; at?: TimingInstant; offsetMs?: number; source: TimingSource; playbackTimingCertain: boolean } {
  const { callerAudioStartedAt, callerAudioEndedAt, learnerSpeechStartedAt, callerPlaybackActive, playbackTimingCertain } = input;
  if (!playbackTimingCertain || !callerAudioStartedAt || !learnerSpeechStartedAt) {
    return { status: "unknown", source: "UNKNOWN", playbackTimingCertain };
  }
  const sourceInstants = [callerAudioStartedAt, learnerSpeechStartedAt, ...(callerAudioEndedAt ? [callerAudioEndedAt] : [])];
  if (!sourceInstants.every((instant) => isOnLocalTimeline(instant.source))) {
    return { status: "unknown", source: "UNKNOWN", playbackTimingCertain };
  }
  const startMs = callerAudioStartedAt.monotonicMs;
  const learnerMs = learnerSpeechStartedAt.monotonicMs;
  if (learnerMs < startMs) return { status: "not_detected", source: "DERIVED", playbackTimingCertain };
  const knownEndedBeforeSpeech = callerAudioEndedAt !== undefined && learnerMs >= callerAudioEndedAt.monotonicMs;
  if (knownEndedBeforeSpeech) {
    return { status: "not_detected", source: "DERIVED", playbackTimingCertain };
  }
  if (callerPlaybackActive === false) {
    return callerAudioEndedAt !== undefined && learnerMs < callerAudioEndedAt.monotonicMs
      ? { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false }
      : { status: "not_detected", source: "DERIVED", playbackTimingCertain };
  }
  const activeAtSpeechStart = callerAudioEndedAt !== undefined
    ? learnerMs < callerAudioEndedAt.monotonicMs
    : callerPlaybackActive === true;
  if (!activeAtSpeechStart) return { status: "unknown", source: "UNKNOWN", playbackTimingCertain };
  return { status: "detected", at: learnerSpeechStartedAt, offsetMs: learnerMs - startMs, source: "DERIVED", playbackTimingCertain };
}

export interface DummySecretSegment {
  turnId: string;
  text: string;
  segmentIndex: number;
  segmentId?: string;
  localSegmentStart?: TimingInstant;
  localSegmentEnd?: TimingInstant;
  timingSource: TimingSource;
}

export const SYNTHETIC_DUMMY_SECRET_FIXTURES = [
  "SYNTHETIC-SECRET-EXAMPLE",
  "DUMMY-OTP-EXAMPLE",
  "DUMMY-PIN-EXAMPLE",
  "TEST-DATE-OF-BIRTH-EXAMPLE",
] as const;

/** Returns timing only, and accepts only named synthetic fixtures with no real credential value. */
export function detectDummySecretDisclosure(segment: DummySecretSegment, syntheticDummySecrets: readonly string[] = SYNTHETIC_DUMMY_SECRET_FIXTURES): ComplianceMoment | null {
  if (segment.localSegmentStart && !isOnLocalTimeline(segment.localSegmentStart.source)) return null;
  if (segment.localSegmentEnd && !isOnLocalTimeline(segment.localSegmentEnd.source)) return null;
  if ((segment.localSegmentStart === undefined) !== (segment.localSegmentEnd === undefined)) return null;
  if (segment.localSegmentStart && segment.localSegmentEnd && segment.localSegmentEnd.monotonicMs < segment.localSegmentStart.monotonicMs) return null;
  const allowed = syntheticDummySecrets.filter(isSyntheticFixtureToken);
  const normalizedText = segment.text.normalize("NFKC").toLocaleLowerCase();
  const matched = allowed.some((secret) => normalizedText.includes(secret.normalize("NFKC").toLocaleLowerCase()));
  if (!matched) return null;
  return {
    turnId: segment.turnId,
    ...(segment.segmentId ? { segmentId: segment.segmentId } : {}),
    segmentIndex: segment.segmentIndex,
    ...(segment.localSegmentStart && segment.localSegmentEnd ? { localSegmentStart: segment.localSegmentStart, localSegmentEnd: segment.localSegmentEnd } : {}),
    timingSource: segment.localSegmentStart ? segment.timingSource : "UNKNOWN",
    source: "synthetic_dummy_secret_detector",
    precision: "segment",
    approximate: true,
  };
}

/** Scans in segment order and returns only the first synthetic disclosure observed in this turn. */
export function detectFirstDummySecretDisclosure(segments: readonly DummySecretSegment[], syntheticDummySecrets: readonly string[] = SYNTHETIC_DUMMY_SECRET_FIXTURES): ComplianceMoment | null {
  for (const segment of [...segments].sort((left, right) => left.segmentIndex - right.segmentIndex)) {
    const moment = detectDummySecretDisclosure(segment, syntheticDummySecrets);
    if (moment) return moment;
  }
  return null;
}

export function monotonicInstant(monotonicMs: number, source: TimingSource): TimingInstant {
  if (!Number.isFinite(monotonicMs) || monotonicMs < 0) throw new RangeError("Monotonic time must be a non-negative finite value.");
  return { monotonicMs, source, precision: "instant" };
}

function isOnLocalTimeline(source: TimingSource): boolean {
  return source === "LOCAL_MONOTONIC_CLOCK" || source === "LOCAL_VAD" || source === "CLIENT_AUDIO_CLOCK";
}

function isSyntheticFixtureToken(value: string): boolean {
  return /^(?:SYNTHETIC|DUMMY|TEST|EXAMPLE)(?:-[A-Z]+){1,5}$/iu.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
