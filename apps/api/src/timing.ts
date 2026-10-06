import { performance } from "node:perf_hooks";
import {
  type ComplianceMoment,
  type FillerEvidence,
  type FillerWord,
  type InterruptionStatus,
  type TimingInstant,
  type TimingSource,
  type TimingValue,
} from "@vaccine/contracts";

const fillerExpressions: ReadonlyArray<readonly [FillerWord, RegExp]> = [
  ["um", /\bum\b/giu],
  ["uh", /\buh\b/giu],
  ["erm", /\berm\b/giu],
  ["hmm", /\bhmm\b/giu],
  ["like", /\blike\b/giu],
  ["you_know", /\byou\s+know\b/giu],
];

export interface SessionMonotonicClock {
  now(): number;
  instant(source?: "LOCAL_MONOTONIC_CLOCK" | "LOCAL_VAD" | "CLIENT_AUDIO_CLOCK"): TimingInstant;
}

/** Creates one session-relative monotonic reference; clients must map their audio clock onto this timeline before comparison. */
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

export function deriveElapsed(start?: TimingInstant, end?: TimingInstant): TimingValue | undefined {
  if (!start || !end || !isOnLocalTimeline(start.source) || !isOnLocalTimeline(end.source) || end.monotonicMs < start.monotonicMs) return undefined;
  return {
    valueMs: end.monotonicMs - start.monotonicMs,
    source: "DERIVED",
    sourceInputs: [start.source, end.source],
    precision: "turn",
  };
}

/** caller playback end → first locally detected learner speech; negative intervals indicate overlap and are omitted. */
export function deriveResponseLatency(callerAudioEndedAt?: TimingInstant, learnerSpeechStartedAt?: TimingInstant): TimingValue | undefined {
  return deriveElapsed(callerAudioEndedAt, learnerSpeechStartedAt);
}

export function countFillerWords(text: string): FillerEvidence[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  return fillerExpressions.flatMap(([token, expression]) => {
    expression.lastIndex = 0;
    const count = [...normalized.matchAll(expression)].length;
    return count > 0 ? [{ token, count }] : [];
  });
}

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
  const recognizedWordCount = (text.normalize("NFKC").match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;
  if (!Number.isFinite(speechDurationMs) || speechDurationMs <= 0 || recognizedWordCount === 0) return { recognizedWordCount };
  return { recognizedWordCount, speechRateWpm: recognizedWordCount / (speechDurationMs / 60_000) };
}

export interface SpeechRateBaselineResult {
  baselineStatus: "insufficient_data" | "available";
  baselineSpeechRateWpm: number | null;
  speechRateDeltaPercent: number | null;
}

/** Baseline is the mean of the first three valid session-local rates and then stays fixed for comparison. */
export function evaluateSpeechRateBaseline(
  currentRate: number | undefined,
  priorRates: readonly number[],
  existingBaseline?: number | null,
  minSamples = 3,
): SpeechRateBaselineResult {
  if (!Number.isSafeInteger(minSamples) || minSamples < 1) throw new RangeError("Baseline sample count must be a positive integer.");
  const validPrior = priorRates.filter((rate) => Number.isFinite(rate) && rate > 0);
  const validCurrent = currentRate !== undefined && Number.isFinite(currentRate) && currentRate > 0;
  let baseline: number | undefined = existingBaseline !== undefined && existingBaseline !== null && Number.isFinite(existingBaseline) && existingBaseline > 0 ? existingBaseline : undefined;
  if (baseline === undefined) {
    const seed = validCurrent ? [...validPrior, currentRate] : validPrior;
    if (seed.length >= minSamples) baseline = seed.slice(0, minSamples).reduce((sum, rate) => sum + rate, 0) / minSamples;
  }
  if (baseline === undefined) return { baselineStatus: "insufficient_data", baselineSpeechRateWpm: null, speechRateDeltaPercent: null };
  return {
    baselineStatus: "available",
    baselineSpeechRateWpm: baseline,
    speechRateDeltaPercent: validCurrent ? (((currentRate as number) - baseline) / baseline) * 100 : null,
  };
}

export interface InterruptionInput {
  callerAudioStartedAt?: TimingInstant;
  callerAudioEndedAt?: TimingInstant;
  learnerSpeechStartedAt?: TimingInstant;
  callerPlaybackActive?: boolean;
  playbackTimingCertain: boolean;
}

export function detectInterruption(input: InterruptionInput): { status: InterruptionStatus; at?: TimingInstant; source: TimingSource; playbackTimingCertain: boolean } {
  const { callerAudioStartedAt, callerAudioEndedAt, learnerSpeechStartedAt, callerPlaybackActive, playbackTimingCertain } = input;
  if (!playbackTimingCertain || !callerAudioStartedAt || !learnerSpeechStartedAt || (callerAudioEndedAt === undefined && callerPlaybackActive !== true)) {
    return { status: "unknown", source: "UNKNOWN", playbackTimingCertain };
  }
  const sourceInstants = [callerAudioStartedAt, learnerSpeechStartedAt, ...(callerAudioEndedAt ? [callerAudioEndedAt] : [])];
  const sameTimeline = sourceInstants.every((instant) =>
    instant.source === "LOCAL_MONOTONIC_CLOCK" || instant.source === "LOCAL_VAD" || instant.source === "CLIENT_AUDIO_CLOCK");
  if (!sameTimeline) return { status: "unknown", source: "UNKNOWN", playbackTimingCertain };
  const overlapsPlayback = learnerSpeechStartedAt.monotonicMs >= callerAudioStartedAt.monotonicMs
    && (callerPlaybackActive === true || callerAudioEndedAt !== undefined && learnerSpeechStartedAt.monotonicMs < callerAudioEndedAt.monotonicMs);
  return overlapsPlayback
    ? { status: "detected", at: learnerSpeechStartedAt, source: "DERIVED", playbackTimingCertain }
    : { status: "not_detected", source: "DERIVED", playbackTimingCertain };
}

export interface DummySecretSegment {
  text: string;
  segmentIndex: number;
  localSegmentStart: TimingInstant;
  localSegmentEnd: TimingInstant;
  timingSource: TimingSource;
}

/** Returns only segment timing. Matched secret text and any position within the segment are never returned. */
export function detectDummySecretDisclosure(segment: DummySecretSegment, syntheticDummySecrets: readonly string[]): ComplianceMoment | null {
  if (!isOnLocalTimeline(segment.localSegmentStart.source) || !isOnLocalTimeline(segment.localSegmentEnd.source)
    || segment.localSegmentEnd.monotonicMs < segment.localSegmentStart.monotonicMs) return null;
  const normalizedText = segment.text.normalize("NFKC").toLocaleLowerCase();
  const matched = syntheticDummySecrets.some((secret) => {
    if (!secret.trim()) return false;
    return normalizedText.includes(secret.normalize("NFKC").toLocaleLowerCase());
  });
  if (!matched) return null;
  return {
    segmentIndex: segment.segmentIndex,
    localSegmentStart: segment.localSegmentStart,
    localSegmentEnd: segment.localSegmentEnd,
    timingSource: segment.timingSource,
    precision: "segment",
    approximate: true,
  };
}

/** Scans in segment order and reports at most the first observed synthetic dummy-secret disclosure. */
export function detectFirstDummySecretDisclosure(segments: readonly DummySecretSegment[], syntheticDummySecrets: readonly string[]): ComplianceMoment | null {
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
