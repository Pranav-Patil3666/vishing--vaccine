import { z } from "zod";
import { BrowserAudioSummarySchema, BrowserAudioWindowSchema } from "./browserAudio.js";
import { TranscriptSegmentSchema, TurnApiResponseSchema } from "./domain.js";

export const REAL_TURN_LIMITS = {
  connectMs: 5000, sendMs: 1500, silenceMs: 2016, settleMs: 3000, closeMs: 1000,
  noSpeechMs: 10000, captureMs: 30000, totalMs: 45000,
  startRequestMs: 6500, finishRequestMs: 8500, maxFrames: 1000, maxQueuedFrames: 8,
} as const;
export const RealAudioWindowSchema = BrowserAudioWindowSchema.extend({ maxDurationMs: z.literal(REAL_TURN_LIMITS.captureMs) });

export const RealVoiceStatusSchema = z.object({
  available: z.boolean(), reason: z.enum(["READY", "DISABLED", "CONTENT_UNAVAILABLE", "TURN_UNAVAILABLE"]),
  openingText: z.string().nullable(), language: z.literal("hi-IN"),
  playback: z.literal("mock_cue_only"),
}).strict();
export type RealVoiceStatus = z.infer<typeof RealVoiceStatusSchema>;
export const RealVoiceTurnResultSchema = z.object({
  source: z.literal("PRISMA_REALTIME"),
  turn: TurnApiResponseSchema,
  audioSummary: BrowserAudioSummarySchema,
  segments: z.array(TranscriptSegmentSchema).min(1).max(64),
  approvedResponseText: z.string().min(1),
  callerAudio: z.object({ available: z.boolean(), responseId: z.string(), turnNumber: z.number().int().nonnegative() }).strict().optional(),
  service: z.object({ connectionMs: z.number().nonnegative().nullable(), firstTranscriptMs: z.number().nonnegative().nullable() }).strict(),
}).strict();
export type RealVoiceTurnResult = z.infer<typeof RealVoiceTurnResultSchema>;
