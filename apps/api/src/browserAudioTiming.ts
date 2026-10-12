import { BrowserAudioTimingFactsSchema, type BrowserAudioTimingFacts, type BrowserAudioSummary } from "@vaccine/contracts";
import { deriveElapsed, deriveResponseLatency, deriveHesitation, detectInterruption, type CapturedAudioTiming } from "./timing.js";

/** No epoch conversion: the backend evaluates pairs inside the supplied browser clock only. */
export function captureBrowserAudioTiming(input: BrowserAudioTimingFacts, segmentNumber = 1): CapturedAudioTiming {
  const facts = BrowserAudioTimingFactsSchema.parse(input);
  const available = facts.timingValid ? facts.events.filter((event) => event.availability === "available") : [];
  const callerAudioStartedAt = available.find((event) => event.kind === "CALLER_AUDIO_START")?.at;
  const callerAudioEndedAt = available.find((event) => event.kind === "CALLER_AUDIO_END")?.at;
  const learnerSpeechStartedAt = available.find((event) => event.kind === "LEARNER_SPEECH_START" && event.segmentNumber === segmentNumber)?.at;
  const learnerSpeechEndedAt = available.find((event) => event.kind === "LEARNER_SPEECH_END" && event.segmentNumber === segmentNumber)?.at;
  return {
    ...(callerAudioStartedAt ? { callerAudioStartedAt } : {}), ...(callerAudioEndedAt ? { callerAudioEndedAt } : {}),
    ...(learnerSpeechStartedAt ? { learnerSpeechStartedAt } : {}), ...(learnerSpeechEndedAt ? { learnerSpeechEndedAt } : {}),
    noResponse: !learnerSpeechStartedAt, timingCertain: facts.timingValid, interruptionReportingEligible: false,
  };
}

export function summarizeBrowserAudio(input: BrowserAudioTimingFacts, frameCount: number): BrowserAudioSummary {
  const facts = BrowserAudioTimingFactsSchema.parse(input);
  const segments = facts.events.filter((event) => event.kind === "LEARNER_SPEECH_START").map((event) => event.segmentNumber!);
  const observations = (segments.length ? segments : [0]).map((segmentNumber) => {
    const timing = captureBrowserAudioTiming(facts, segmentNumber);
    const candidate = detectInterruption({ ...timing, playbackTimingCertain: timing.timingCertain && Boolean(timing.callerAudioEndedAt) });
    return {
      segmentNumber,
      responseLatencyMs: deriveResponseLatency(timing.callerAudioEndedAt, timing.learnerSpeechStartedAt)?.valueMs ?? null,
      preSpeechSilenceMs: deriveHesitation(timing.callerAudioEndedAt, timing.learnerSpeechStartedAt, "").preSpeechSilence?.valueMs ?? null,
      speechDurationMs: deriveElapsed(timing.learnerSpeechStartedAt, timing.learnerSpeechEndedAt)?.valueMs ?? null,
      overlapCandidate: candidate.status === "unknown" ? null : candidate.status === "detected",
      interruptionStatus: "unknown" as const,
    };
  });
  return { frameCount, receivedBytes: frameCount * 1024, observations, speakerBleedValidation: "UNKNOWN", interruptionReportingEnabled: false };
}
