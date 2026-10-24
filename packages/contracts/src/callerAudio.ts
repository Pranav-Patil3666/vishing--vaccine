import { z } from "zod";
export const CallerAudioRequestSchema = z.object({ turnNumber: z.number().int().min(0).max(3), responseId: z.string().min(1).max(120) }).strict();
export const CallerAudioStatusSchema = z.object({ available: z.boolean(), responseId: z.string().nullable() }).strict();
export const CallerAudioAssetSchema = z.object({
  sessionId: z.string().min(1), turnNumber: z.number().int().nonnegative(), responseId: z.string().min(1),
  audioUrl: z.string().regex(/^\/api\/sessions\/[^/]+\/caller-audio\/[a-f0-9-]+$/u),
  mediaType: z.literal("audio/wav"), byteLength: z.number().int().positive().max(8 * 1024 * 1024), durationMs: z.number().positive().max(60000),
  cacheKey: z.string().regex(/^tts-[a-f0-9]{64}$/u), cacheHit: z.boolean(), provider: z.string(), model: z.string(), voice: z.string(), language: z.string(),
  sampleRateHz: z.literal(48000), synthesisMs: z.number().nonnegative().nullable(), cacheLookupMs: z.number().nonnegative(),
  providerAttempts: z.number().int().min(0).max(1),
}).strict();
export type CallerAudioAsset = z.infer<typeof CallerAudioAssetSchema>;
export type CallerAudioStatus = z.infer<typeof CallerAudioStatusSchema>;
