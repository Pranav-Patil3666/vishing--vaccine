import { z } from "zod";
import { RuntimeConversationSchema } from "./conversation.js";
import {
  ApprovedCallerResponseReferenceSchema,
  BehaviorClassificationSchema,
  DeterministicDebriefSchema,
  LearnerTurnEventSchema,
  PressureTimelinePointSchema,
  SessionTerminalStateSchema,
} from "./pressure.js";

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

/** Provider segment metadata is reference-only; it never supplies learner timing. */
export const TranscriptSegmentSchema = z.object({
  text: z.string().max(8192),
  providerTimestamp: z.string().datetime({ offset: true }).optional(),
  segmentId: z.string().min(1).max(256).optional(),
  segmentIndex: z.number().int().nonnegative().optional(),
  providerAudioDurationMs: z.number().finite().nonnegative().optional(),
  providerLatencyMs: z.number().finite().nonnegative().optional(),
}).strict();
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  turnNumber: z.number().int().nonnegative(),
  text: z.string(),
  language: z.string().min(1),
  normalizationStatus: NormalizationStatusSchema,
  providerMetadata: ProviderMetadataSchema.optional(),
  segments: z.array(TranscriptSegmentSchema).max(64).optional(),
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

export const SpeechSynthesisRequestSchema = ApprovedCallerResponseReferenceSchema;
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
  callerTesting: z.string().min(1),
  observedBehavior: z.enum(["safe", "risky", "unmatched"]),
  redFlagIds: z.array(RedFlagIdSchema),
  recommendedAction: z.string().min(1),
  evidenceSnippet: z.string().optional(),
  rubricPoints: z.array(z.number().int().min(1).max(5)).optional(),
});
export type DebriefEvent = z.infer<typeof DebriefEventSchema>;

export const ConsentStateSchema = z.object({
  status: z.enum(["not-requested", "granted", "denied", "withdrawn"]),
  updatedAt: z.string().datetime().optional(),
  purpose: z.literal("microphone-transcription"),
  version: z.string().min(1).optional(),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const SessionLifecycleStateSchema = z.enum([
  "CREATED", "CONSENT_REQUIRED", "READY", "CALLER_SPEAKING", "LISTENING",
  "TRANSCRIBING", "ROUTING", "GENERATING_RESPONSE", "PLAYING_RESPONSE",
  "COMPLETED", "ENDED_BY_LEARNER", "FALLBACK", "ERROR",
]);
export type SessionLifecycleState = z.infer<typeof SessionLifecycleStateSchema>;

export const ScenarioRuntimeStatusSchema = z.enum(["DRAFT", "SAFETY_REVIEW", "APPROVED", "RUNTIME_ELIGIBLE"]);
export type ScenarioRuntimeStatus = z.infer<typeof ScenarioRuntimeStatusSchema>;

/** Development-only timing values use one session-local monotonic millisecond reference. */
export const AudioTimingFixtureSchema = z.object({
  callerAudioStartedAtMs: z.number().finite().nonnegative().optional(),
  callerAudioEndedAtMs: z.number().finite().nonnegative().optional(),
  learnerSpeechStartedAtMs: z.number().finite().nonnegative().nullable().optional(),
  learnerSpeechEndedAtMs: z.number().finite().nonnegative().nullable().optional(),
  callerPlaybackActive: z.boolean().optional(),
  noResponse: z.boolean().optional(),
}).strict().superRefine((fixture, context) => {
  if (fixture.callerAudioStartedAtMs !== undefined && fixture.callerAudioEndedAtMs !== undefined
    && fixture.callerAudioEndedAtMs < fixture.callerAudioStartedAtMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["callerAudioEndedAtMs"], message: "Caller playback end cannot precede its start." });
  }
  if (fixture.learnerSpeechStartedAtMs != null && fixture.learnerSpeechEndedAtMs != null
    && fixture.learnerSpeechEndedAtMs < fixture.learnerSpeechStartedAtMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["learnerSpeechEndedAtMs"], message: "Learner speech end cannot precede its start." });
  }
  if (fixture.noResponse && (fixture.learnerSpeechStartedAtMs != null || fixture.learnerSpeechEndedAtMs != null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["noResponse"], message: "A no-response fixture cannot include learner speech timing." });
  }
});
export type AudioTimingFixture = z.infer<typeof AudioTimingFixtureSchema>;

export const LatencyMeasurementSchema = z.object({
  operation: z.string().min(1),
  stage: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnNumber: z.number().int().nonnegative().optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative(),
  measuredAt: z.string().datetime(),
  success: z.boolean().optional(),
  failureCode: z.string().optional(),
  branchId: z.string().nullable().optional(),
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
  state: SessionLifecycleStateSchema,
  consentRequired: z.literal(true),
  recordingEnabled: z.boolean(),
  consentVersion: z.string().min(1),
  consent: ConsentStateSchema,
  scenarioRuntimeStatus: ScenarioRuntimeStatusSchema.default("DRAFT"),
  observedEvents: z.array(DebriefEventSchema),
  currentTacticId: z.string().min(1).nullable(),
  currentResponseId: z.string().min(1).nullable().default(null),
  currentTacticCategory: z.enum(["URGENCY", "AUTHORITY", "ISOLATION", "FEAR_CONSEQUENCE", "REWARD_FAKE_HELP"]).nullable().default(null),
  currentTacticPromptedDummySecret: z.boolean().default(false),
  currentPressureLevel: z.number().int().min(0).max(5),
  previousTacticIds: z.array(z.string().min(1)),
  maxPressureLevel: z.number().int().min(0).max(5),
  maxTurns: z.number().int().positive(),
  safeWordState: z.enum(["armed", "triggered"]),
  behaviorHistory: z.array(BehaviorClassificationSchema),
  baselineSpeechRateWpm: z.number().finite().positive().nullable(),
  baselineSpeechRateSampleCount: z.number().int().nonnegative(),
  timelineEvents: z.array(LearnerTurnEventSchema),
  pressureTimeline: z.array(PressureTimelinePointSchema).default([]),
  terminalState: SessionTerminalStateSchema.nullable(),
  mode: z.enum(["safe", "demo"]),
  runtimeMode: z.enum(["MOCK", "REAL_STT", "REAL_CONVERSATION"]).default("MOCK"),
  conversation: RuntimeConversationSchema.optional(),
  cache: z.object({ hits: z.number().int().nonnegative(), misses: z.number().int().nonnegative() }),
  metrics: z.array(LatencyMeasurementSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const CreateSessionRequestSchema = z.object({
  scenarioId: z.string().min(1), scenarioVersion: z.string().min(1), language: z.string().min(1),
  voiceId: z.string().min(1).optional(), demoMode: z.boolean(),
  runtimeMode: z.enum(["MOCK", "REAL_STT", "REAL_CONVERSATION"]).default("MOCK"),
}).strict();
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export const ConsentRequestSchema = z.object({ consentVersion: z.string().min(1) }).strict();
export const MockTurnRequestSchema = z.object({ text: z.string(), timingFixture: AudioTimingFixtureSchema.optional() }).strict().superRefine((request, context) => {
  if (!request.text.trim() && request.timingFixture?.noResponse !== true) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "Mock text must not be empty unless the timing fixture explicitly represents no response." });
  }
  if (request.timingFixture?.noResponse === true && request.text.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["timingFixture", "noResponse"], message: "A no-response fixture cannot include learner text." });
  }
});
export const EndSessionRequestSchema = z.object({}).strict();

export const SafeSessionSchema = z.object({
  sessionId: z.string().min(1), scenarioId: z.string().min(1), scenarioVersion: z.string().min(1),
  runtimeRelease: z.object({ publicationId: z.string().uuid().nullable(), packageHash: z.string().regex(/^[0-9a-f]{64}$/u), policyVersion: z.string().min(1) }).strict().optional(),
  language: z.string().min(1), state: SessionLifecycleStateSchema, consent: ConsentStateSchema,
  scenarioRuntimeStatus: ScenarioRuntimeStatusSchema.default("DRAFT"),
  turnNumber: z.number().int().nonnegative(), currentNodeId: z.string().min(1),
  currentTacticId: z.string().min(1).nullable(), currentPressureLevel: z.number().int().min(0).max(5),
  currentResponseId: z.string().min(1).nullable().default(null),
  currentTacticCategory: z.enum(["URGENCY", "AUTHORITY", "ISOLATION", "FEAR_CONSEQUENCE", "REWARD_FAKE_HELP"]).nullable().default(null),
  currentTacticPromptedDummySecret: z.boolean().default(false),
  previousTacticIds: z.array(z.string().min(1)), maxPressureLevel: z.number().int().min(0).max(5),
  maxTurns: z.number().int().positive(), safeWordState: z.enum(["armed", "triggered"]),
  behaviorHistory: z.array(BehaviorClassificationSchema),
  baselineSpeechRateWpm: z.number().finite().positive().nullable(), baselineSpeechRateSampleCount: z.number().int().nonnegative(),
  timelineEvents: z.array(LearnerTurnEventSchema), pressureTimeline: z.array(PressureTimelinePointSchema).default([]), terminalState: SessionTerminalStateSchema.nullable(),
  pressureDebrief: DeterministicDebriefSchema.nullable(),
  mode: z.enum(["safe", "demo"]), recordingEnabled: z.boolean(),
  runtimeMode: z.enum(["MOCK", "REAL_STT", "REAL_CONVERSATION"]).default("MOCK"),
  conversation: RuntimeConversationSchema.optional(),
  cache: z.object({ hits: z.number().int().nonnegative(), misses: z.number().int().nonnegative() }),
  debriefEvents: z.array(DebriefEventSchema),
  metrics: z.array(LatencyMeasurementSchema),
});
export type SafeSession = z.infer<typeof SafeSessionSchema>;

export const SessionCreateResponseSchema = z.object({ session: SafeSessionSchema, simulationOnly: z.literal(true), draftFallbackOnly: z.boolean() });
export const TurnApiResponseSchema = z.object({
  session: SafeSessionSchema,
  transcript: z.object({ eventId: z.string(), turnNumber: z.number().int(), text: z.string(), language: z.string(), normalizationStatus: z.string() }),
  branch: z.object({
    id: z.string().nullable(), responseId: z.string(), matched: z.boolean(), reason: z.string(),
    policyDecisionCode: z.string().min(1).default("DRAFT_SAFE_FALLBACK"),
    nextPressureLevel: z.number().int().min(0).max(5).default(0),
    terminalState: SessionTerminalStateSchema.nullable().default(null),
  }),
  response: z.object({ mediaType: z.string(), cacheKey: z.string(), cacheHit: z.boolean(), playable: z.literal(false), fallback: z.boolean(), durationMs: z.number().optional() }),
  debriefEvent: DebriefEventSchema,
  learnerTurnEvent: LearnerTurnEventSchema,
  latency: z.array(LatencyMeasurementSchema),
  creditMode: z.enum(["none", "demo"]),
});
export type TurnApiResponse = z.infer<typeof TurnApiResponseSchema>;

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
