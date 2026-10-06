import { z } from "zod";

export const redFlagIds = [
  "RF-01",
  "RF-02",
  "RF-03",
  "RF-04",
  "RF-05",
  "RF-06",
  "RF-07",
  "RF-08",
] as const;

export const SYSTEM_SAFE_FALLBACK_RESPONSE_ID = "system.safe-fallback";

export const RedFlagIdSchema = z.enum(redFlagIds);
export type RedFlagId = z.infer<typeof RedFlagIdSchema>;

export const ProviderMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

export const TriggerRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact_phrase"), phrases: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("keyword"), keywords: z.array(z.string().min(1)).min(1), mode: z.enum(["any", "all"]) }),
  z.object({ type: z.literal("normalized_text"), text: z.string().min(1) }),
  z.object({ type: z.literal("regex"), pattern: z.string().min(1).max(160), flags: z.string().max(2).optional() }),
]);
export type TriggerRule = z.infer<typeof TriggerRuleSchema>;

export const NormalizationStatusSchema = z.enum(["normalized", "unchanged", "failed"]);
export type NormalizationStatus = z.infer<typeof NormalizationStatusSchema>;

export const TranscriptEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
  text: z.string(),
  language: z.string().min(1),
  normalizationStatus: NormalizationStatusSchema,
  providerMetadata: ProviderMetadataSchema.optional(),
  timing: z.object({
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  }).optional(),
  confidence: z.object({
    transcription: z.number().min(0).max(1).optional(),
    normalization: z.number().min(0).max(1).optional(),
  }).optional(),
});
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;

export const AudioInputSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mediaType: z.string().optional(),
  sampleRateHz: z.number().positive().optional(),
});
export type AudioInput = z.infer<typeof AudioInputSchema>;

export const AudioResultSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mediaType: z.string().min(1),
  durationMs: z.number().nonnegative().optional(),
  cache: z.object({ key: z.string().min(1), hit: z.boolean() }).optional(),
});
export type AudioResult = z.infer<typeof AudioResultSchema>;

export const SpeechRecognitionRequestSchema = z.object({
  input: AudioInputSchema,
  language: z.string().min(1),
  mode: z.enum(["turn", "stream"]),
  sessionId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
});
export type SpeechRecognitionRequest = z.infer<typeof SpeechRecognitionRequestSchema>;

export const SpeechSynthesisRequestSchema = z.object({
  responseId: z.string().min(1),
  text: z.string().min(1),
  language: z.string().min(1),
  voice: z.string().min(1),
});
export type SpeechSynthesisRequest = z.infer<typeof SpeechSynthesisRequestSchema>;

export const ScenarioStateSchema = z.object({
  scenarioId: z.string().min(1),
  version: z.string().min(1),
  currentNodeId: z.string().min(1),
});
export type ScenarioState = z.infer<typeof ScenarioStateSchema>;

export const ScenarioBranchSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  triggerRules: z.array(TriggerRuleSchema).min(1),
  responseId: z.string().min(1),
  nextNodeId: z.string().nullable(),
  status: z.enum(["draft", "approved"]),
});
export type ScenarioBranch = z.infer<typeof ScenarioBranchSchema>;

export const ScenarioNodeSchema = z.object({
  id: z.string().min(1),
  triggerRules: z.array(TriggerRuleSchema),
  learnerExpectedBehavior: z.array(z.string().min(1)),
  nextNodeId: z.string().nullable(),
  safeFallbackResponseId: z.string().min(1),
  debriefTags: z.array(RedFlagIdSchema),
});
export type ScenarioNode = z.infer<typeof ScenarioNodeSchema>;

export const DebriefEventSchema = z.object({
  eventId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
  observedBehavior: z.enum(["safe", "risky", "unmatched"]),
  redFlagIds: z.array(RedFlagIdSchema),
  recommendedAction: z.string().min(1),
});
export type DebriefEvent = z.infer<typeof DebriefEventSchema>;

export const ConsentStateSchema = z.object({
  status: z.enum(["not-requested", "granted", "denied", "withdrawn"]),
  updatedAt: z.string().datetime().optional(),
  purpose: z.literal("microphone-transcription"),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const LatencyMeasurementSchema = z.object({
  operation: z.string().min(1),
  durationMs: z.number().nonnegative(),
  measuredAt: z.string().datetime(),
  cacheHit: z.boolean().optional(),
});
export type LatencyMeasurement = z.infer<typeof LatencyMeasurementSchema>;

export const CreditUsageEventSchema = z.object({
  eventId: z.string().min(1),
  operation: z.string().min(1),
  kind: z.enum(["projected", "used", "rejected"]),
  configuredUnits: z.number().nonnegative(),
  occurredAt: z.string().datetime(),
  sessionId: z.string().optional(),
});
export type CreditUsageEvent = z.infer<typeof CreditUsageEventSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioVersion: z.string().min(1),
  language: z.string().min(1),
  currentNodeId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
  consent: ConsentStateSchema,
  observedEvents: z.array(DebriefEventSchema),
  mode: z.enum(["safe", "demo"]),
  cache: z.object({ hits: z.number().int().nonnegative(), misses: z.number().int().nonnegative() }),
  metrics: z.array(LatencyMeasurementSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const ProviderErrorSchema = z.object({
  code: z.enum(["unavailable", "invalid_request", "rate_limited", "capacity_exceeded", "unknown"]),
  message: z.string().min(1),
  operation: z.string().min(1),
  retryable: z.boolean(),
});
export type ProviderError = z.infer<typeof ProviderErrorSchema>;

export const ApiHealthResponseSchema = z.object({
  status: z.literal("ok"),
  environment: z.string().min(1),
  version: z.string().min(1).optional(),
  timestamp: z.string().datetime(),
});
export type ApiHealthResponse = z.infer<typeof ApiHealthResponseSchema>;

export const DraftTreeSchema = z.object({
  scenarioId: z.string().min(1),
  language: z.string().nullable(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    text: z.string(),
    suggestedRedFlags: z.array(RedFlagIdSchema),
  })),
  providerMetadata: ProviderMetadataSchema.optional(),
});
export type DraftTree = z.infer<typeof DraftTreeSchema>;

export const ScenarioBriefSchema = z.object({
  scenarioId: z.string().min(1),
  learningObjective: z.string().min(1),
  redFlags: z.array(RedFlagIdSchema),
  language: z.string().nullable(),
});
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;
