import { z } from "zod";

export const TechnicalStageSchema = z.enum(["MICROPHONE_PREPARATION", "CALIBRATION", "STT_START", "STT_STREAM", "STT_FINALIZE", "POLICY", "CALLER_AUDIO_RESOLUTION", "TTS_CREDIT_GUARD", "TTS_PROVIDER", "TTS_CACHE", "CALLER_AUDIO_FETCH", "CALLER_AUDIO_DECODE", "CALLER_PLAYBACK"]);
export const TechnicalCauseSchema = z.enum(["SESSION_NOT_FOUND", "CONSENT_REQUIRED", "INVALID_STATE", "INVALID_REQUEST", "SCENARIO_NOT_FOUND", "INVALID_SCENARIO", "TRANSCRIPTION_FAILED", "ROUTING_FAILED", "SYNTHESIS_FAILED", "APPROVED_RESPONSE_UNAVAILABLE", "CLASSIFIER_FAILED", "INVALID_TIMING", "CREDIT_LIMIT_REACHED", "RATE_LIMITED", "INTERNAL_ERROR", "STT_UNAVAILABLE", "NO_SPEECH", "STT_EMPTY", "STT_TIMEOUT", "STT_CONNECTION_FAILED", "STT_PROTOCOL_ERROR", "STT_CANCELLED", "TTS_UNAVAILABLE", "TTS_PROVIDER_FAILED", "TTS_TIMEOUT", "TTS_CANCELLED", "NETWORK_ERROR", "AUDIO_ASSET_INVALID", "PLAYBACK_FAILED", "MEDIA_STREAM_ENDED", "MICROPHONE_DISABLED", "AUDIO_CONTEXT_CLOSED", "AUDIO_CONTEXT_SUSPENDED", "WORKLET_UNAVAILABLE", "CALIBRATION_REENTRANT", "CALIBRATION_TIMEOUT", "CALIBRATION_INVALID_INPUT", "INVALID_TURN_STATE"]);
export const CreditDecisionFactSchema = z.object({
  operation: z.enum(["stt", "tts"]), cap: z.number().nonnegative(), reserveCap: z.number().nonnegative(),
  usableCap: z.number().nonnegative(), usedUnits: z.number().nonnegative(), costUnits: z.number().nonnegative(),
  projectedUnits: z.number().nonnegative(), remainingUnits: z.number().nonnegative(), allowed: z.boolean(),
}).strict();
export const TechnicalFailureSchema = z.object({ stage: TechnicalStageSchema, causeCode: TechnicalCauseSchema,
  providerAttempted: z.boolean().nullable(), cacheResult: z.enum(["HIT", "MISS", "UNKNOWN"]).optional(), credit: CreditDecisionFactSchema.optional(),
}).strict();
export const RuntimeCreditEventSchema = z.object({ id: z.string().uuid(), operation: z.enum(["stt", "tts"]), sessionId: z.string(),
  state: z.enum(["RESERVED", "ATTEMPTED", "RELEASED", "DENIED"]), guardAllowed: z.boolean(), providerAttempted: z.boolean(),
  units: z.number().nonnegative(), usedBefore: z.number().nonnegative(), usedAfter: z.number().nonnegative(),
}).strict();
const counter = z.object({ usedUnits: z.number().nonnegative(), remainingUnits: z.number().nonnegative(), providerAttempts: z.number().int().nonnegative() }).strict();
export const RuntimeCreditSnapshotSchema = z.object({ processId: z.number().int().positive(), bootId: z.string().uuid(), loadedAt: z.string().datetime(),
  mode: z.enum(["development", "public-demo"]), cap: z.number().nonnegative(), reserveCap: z.number().nonnegative(), usableCap: z.number().nonnegative(),
  sttCostUnits: z.number().nonnegative(), ttsCostUnits: z.number().nonnegative(), initialTtsUsedUnits: z.number().nonnegative(),
  scope: z.literal("per-operation runtime process memory; used includes pending reservations; mock simulations separate"),
  simulation: z.object({ sttUsedUnits: z.number().nonnegative(), ttsUsedUnits: z.number().nonnegative() }).strict(),
  stt: counter, tts: counter, events: z.array(RuntimeCreditEventSchema).max(64),
}).strict();
export type TechnicalFailure = z.infer<typeof TechnicalFailureSchema>;
export type TechnicalStage = z.infer<typeof TechnicalStageSchema>;
export type CreditDecisionFact = z.infer<typeof CreditDecisionFactSchema>;
export type RuntimeCreditSnapshot = z.infer<typeof RuntimeCreditSnapshotSchema>;
export interface RuntimeCreditReservation { attempted(): void; releaseBeforeAttempt(): void; }
