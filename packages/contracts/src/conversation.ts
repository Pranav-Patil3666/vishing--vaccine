import { z } from "zod";
import { TechnicalFailureSchema } from "./runtimeDiagnostics.js";
export const CONVERSATION_CLOCK_LIMIT_MS = 600_000;
export const ConversationFailureSchema = z.enum(["CALLER_AUDIO_FAILED", "LEARNER_AUDIO_FAILED", "PROVIDER_FAILED", "CREDIT_LIMIT_REACHED", "TURN_LIMIT", "SESSION_TIMEOUT"]);
export const ConversationPhaseSchema = z.enum(["IDLE", "CALLER_PREPARING", "CALLER_PLAYING", "LEARNER_LISTENING", "LEARNER_FINALIZING", "TERMINAL_CALLER_PREPARING", "TERMINAL_CALLER_PLAYING", "COMPLETED", "STOPPED", "ERROR"]);
export const ConversationCallerSignalSchema = z.object({
  turnNumber: z.number().int().min(0).max(3), responseId: z.string().min(1), audioClockId: z.string().uuid(),
  atMs: z.number().finite().min(0).max(CONVERSATION_CLOCK_LIMIT_MS),
}).strict();
export const RuntimeConversationSchema = z.object({
  phase: ConversationPhaseSchema,
  audioClockId: z.string().uuid().optional(),
  caller: z.object({ turnNumber: z.number().int().nonnegative(), responseId: z.string(), startedAtMs: z.number().nonnegative(), endedAtMs: z.number().nonnegative().optional() }).strict().optional(),
  failureCode: ConversationFailureSchema.optional(),
  failure: TechnicalFailureSchema.optional(),
}).strict();
export type ConversationPhase = z.infer<typeof ConversationPhaseSchema>;
export type ConversationFailure = z.infer<typeof ConversationFailureSchema>;
export type RuntimeConversation = z.infer<typeof RuntimeConversationSchema>;
