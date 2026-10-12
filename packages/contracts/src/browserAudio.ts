import { z } from "zod";
import { TimingInstantSchema } from "./pressure.js";

export const AudioCaptureStateSchema = z.enum([
  "IDLE", "PERMISSION_REQUIRED", "REQUESTING_PERMISSION", "READY", "CALIBRATING", "LISTENING",
  "SPEECH_ACTIVE", "FINISHING", "COMPLETED", "STOPPING", "STOPPED", "PERMISSION_DENIED", "DEVICE_UNAVAILABLE", "ERROR",
]);
export type AudioCaptureState = z.infer<typeof AudioCaptureStateSchema>;
export const BrowserAudioErrorCodeSchema = z.enum([
  "PERMISSION_DENIED", "NO_INPUT_DEVICE", "UNSUPPORTED_BROWSER", "AUDIO_CONTEXT_FAILED", "WORKLET_LOAD_FAILED",
  "TRACK_ENDED", "PCM_PIPELINE_FAILED", "BACKPRESSURE", "SESSION_NOT_ELIGIBLE", "TIMING_UNAVAILABLE",
]);
export type BrowserAudioErrorCode = z.infer<typeof BrowserAudioErrorCodeSchema>;
export const BrowserAudioStartSchema = z.object({ audioClockId: z.string().uuid(), turnNumber: z.number().int().min(1) }).strict();
export const BrowserAudioWindowSchema = z.object({ token: z.string().uuid(), maxDurationMs: z.literal(60_000) }).strict();
const BrowserInstantSchema = TimingInstantSchema.extend({
  audioClockId: z.string().uuid(),
  source: z.enum(["CLIENT_AUDIO_CLOCK", "LOCAL_VAD"]),
  monotonicMs: z.number().finite().min(0).max(120_000),
}).omit({ providerTimestamp: true });
export const BrowserAudioFactSchema = z.object({
  sessionId: z.string().min(1).max(128), turnNumber: z.number().int().min(1),
  kind: z.enum(["CALLER_AUDIO_START", "CALLER_AUDIO_END", "LEARNER_SPEECH_START", "LEARNER_SPEECH_END"]),
  at: BrowserInstantSchema, segmentNumber: z.number().int().min(1).max(64).optional(),
  availability: z.enum(["available", "unavailable"]),
}).strict();
export type BrowserAudioFact = z.infer<typeof BrowserAudioFactSchema>;
export const BrowserAudioTimingFactsSchema = z.object({
  sessionId: z.string().min(1).max(128), turnNumber: z.number().int().min(1), audioClockId: z.string().uuid(),
  timingValid: z.boolean(), events: z.array(BrowserAudioFactSchema).max(128),
}).strict().superRefine((facts, context) => {
  let last = -1;
  let callerStarted = false;
  let callerEnded = false;
  let activeSegment: number | undefined;
  let segmentCount = 0;
  for (const event of facts.events) {
    let valid = event.sessionId === facts.sessionId && event.turnNumber === facts.turnNumber
      && event.at.audioClockId === facts.audioClockId && event.at.monotonicMs >= last;
    last = event.at.monotonicMs;
    if (event.kind.startsWith("CALLER")) {
      valid &&= event.at.source === "CLIENT_AUDIO_CLOCK" && event.segmentNumber === undefined;
      if (event.kind === "CALLER_AUDIO_START") { valid &&= !callerStarted; callerStarted = true; }
      else { valid &&= callerStarted && !callerEnded; callerEnded = true; }
    } else {
      valid &&= event.at.source === "LOCAL_VAD";
      if (event.kind === "LEARNER_SPEECH_START") {
        valid &&= activeSegment === undefined && event.segmentNumber === ++segmentCount;
        activeSegment = event.segmentNumber;
      } else { valid &&= activeSegment !== undefined && activeSegment === event.segmentNumber; activeSegment = undefined; }
    }
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: ["events"], message: "Audio facts must be ordered, paired and confined to one session/browser clock." });
  }
});
export type BrowserAudioTimingFacts = z.infer<typeof BrowserAudioTimingFactsSchema>;
export const BrowserAudioObservationSchema = z.object({
  segmentNumber: z.number().int().nonnegative(), responseLatencyMs: z.number().nonnegative().nullable(),
  preSpeechSilenceMs: z.number().nonnegative().nullable(), speechDurationMs: z.number().nonnegative().nullable(),
  overlapCandidate: z.boolean().nullable(), interruptionStatus: z.literal("unknown"),
}).strict();
export const BrowserAudioSummarySchema = z.object({
  frameCount: z.number().int().nonnegative(), receivedBytes: z.number().int().nonnegative(),
  observations: z.array(BrowserAudioObservationSchema).max(64),
  speakerBleedValidation: z.literal("UNKNOWN"), interruptionReportingEnabled: z.literal(false),
}).strict();
export type BrowserAudioSummary = z.infer<typeof BrowserAudioSummarySchema>;
export interface PcmFrameMetadata {
  sessionId: string; turnNumber: number; audioClockId: string; sequence: number;
  producedAtMonotonicMs: number; sampleRateHz: 16000; channels: 1; encoding: "PCM_S16LE"; byteLength: 1024;
  paddedSamples: number;
}
