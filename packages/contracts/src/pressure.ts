import { z } from "zod";

export const TimingSourceSchema = z.enum([
  "LOCAL_MONOTONIC_CLOCK",
  "LOCAL_VAD",
  "CLIENT_AUDIO_CLOCK",
  "PROVIDER_TIMESTAMP",
  "PROVIDER_SEGMENT",
  "DERIVED",
  "UNKNOWN",
]);
export type TimingSource = z.infer<typeof TimingSourceSchema>;

export const TimingPrecisionSchema = z.enum(["instant", "segment", "turn", "unknown"]);
export type TimingPrecision = z.infer<typeof TimingPrecisionSchema>;

export const TimingInstantSchema = z.object({
  monotonicMs: z.number().finite().nonnegative(),
  source: TimingSourceSchema,
  precision: TimingPrecisionSchema.default("instant"),
  providerTimestamp: z.string().datetime().optional(),
}).strict();
export type TimingInstant = z.infer<typeof TimingInstantSchema>;

export const TimingValueSchema = z.object({
  valueMs: z.number().finite().nonnegative(),
  source: TimingSourceSchema,
  sourceInputs: z.array(TimingSourceSchema).optional(),
  precision: TimingPrecisionSchema.default("turn"),
}).strict();
export type TimingValue = z.infer<typeof TimingValueSchema>;

export const BehaviorLabelSchema = z.enum([
  "REFUSED",
  "STALLED",
  "VERIFIED_INDEPENDENTLY",
  "COMPLIED",
  "DISCLOSED_DUMMY_SECRET",
  "UNKNOWN",
]);
export type BehaviorLabel = z.infer<typeof BehaviorLabelSchema>;

export const BehaviorClassificationSchema = z.object({
  label: BehaviorLabelSchema,
  evidenceRuleIds: z.array(z.string().min(1)),
  source: z.enum(["deterministic_rules", "human_review", "unknown"]),
}).strict();
export type BehaviorClassification = z.infer<typeof BehaviorClassificationSchema>;

export const FillerWordSchema = z.enum(["um", "uh", "erm", "hmm", "like", "you_know"]);
export type FillerWord = z.infer<typeof FillerWordSchema>;

export const FillerEvidenceSchema = z.object({
  token: FillerWordSchema,
  count: z.number().int().positive(),
}).strict();
export type FillerEvidence = z.infer<typeof FillerEvidenceSchema>;

export const BaselineStatusSchema = z.enum(["insufficient_data", "available"]);
export type BaselineStatus = z.infer<typeof BaselineStatusSchema>;

export const InterruptionStatusSchema = z.enum(["detected", "not_detected", "unknown"]);
export type InterruptionStatus = z.infer<typeof InterruptionStatusSchema>;

export const ComplianceMomentSchema = z.object({
  segmentIndex: z.number().int().nonnegative(),
  localSegmentStart: TimingInstantSchema,
  localSegmentEnd: TimingInstantSchema,
  timingSource: TimingSourceSchema,
  precision: z.literal("segment"),
  approximate: z.literal(true),
}).strict().superRefine((moment, context) => {
  if (moment.localSegmentEnd.monotonicMs < moment.localSegmentStart.monotonicMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["localSegmentEnd"], message: "Segment end cannot precede segment start." });
  }
});
export type ComplianceMoment = z.infer<typeof ComplianceMomentSchema>;

/** A privacy-conscious turn fact. Transcript/audio payloads and secret values are deliberately absent. */
export const LearnerTurnEventSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioVersion: z.string().min(1),
  language: z.string().min(1),
  callerTacticId: z.string().min(1).nullable(),
  callerResponseId: z.string().min(1).nullable(),
  callerPressureLevel: z.number().int().min(0).max(5),
  callerAudioStartedAt: TimingInstantSchema.optional(),
  callerAudioEndedAt: TimingInstantSchema.optional(),
  learnerSpeechStartedAt: TimingInstantSchema.optional(),
  learnerSpeechEndedAt: TimingInstantSchema.optional(),
  responseLatency: TimingValueSchema.optional(),
  preSpeechSilence: TimingValueSchema.optional(),
  fillerWords: z.array(FillerEvidenceSchema),
  fillerCount: z.number().int().nonnegative(),
  speechDuration: TimingValueSchema.optional(),
  recognizedWordCount: z.number().int().nonnegative().optional(),
  speechRateWpm: z.number().finite().nonnegative().nullable(),
  baselineSpeechRateWpm: z.number().finite().positive().nullable(),
  speechRateDeltaPercent: z.number().finite().nullable(),
  baselineStatus: BaselineStatusSchema,
  interruption: z.object({
    status: InterruptionStatusSchema,
    at: TimingInstantSchema.optional(),
    source: TimingSourceSchema,
    playbackTimingCertain: z.boolean(),
  }).strict(),
  behavior: BehaviorClassificationSchema,
  complianceMoment: ComplianceMomentSchema.nullable(),
  observedEvidenceRuleIds: z.array(z.string().min(1)),
}).strict().superRefine((event, context) => {
  if (event.fillerWords.reduce((sum, item) => sum + item.count, 0) !== event.fillerCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fillerCount"], message: "Filler count must equal the recorded token counts." });
  }
  if (event.complianceMoment !== null && event.behavior.label !== "DISCLOSED_DUMMY_SECRET") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["complianceMoment"], message: "A compliance moment must refer to an observed dummy-secret disclosure." });
  }
  if (event.baselineStatus === "available" && event.baselineSpeechRateWpm === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["baselineSpeechRateWpm"], message: "An available speech-rate baseline requires a measured baseline value." });
  }
  if (event.baselineStatus === "insufficient_data" && event.baselineSpeechRateWpm !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["baselineSpeechRateWpm"], message: "An insufficient baseline cannot carry a baseline value." });
  }
  if (event.speechRateDeltaPercent !== null && (event.speechRateWpm === null || event.baselineSpeechRateWpm === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["speechRateDeltaPercent"], message: "Speech-rate change requires both current and baseline rates." });
  }
  if (event.speechRateWpm !== null && (!event.speechDuration || !event.recognizedWordCount || event.speechDuration.valueMs <= 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["speechRateWpm"], message: "Speech rate requires transcript word count and positive measured speech duration." });
  }
  if (event.interruption.status === "detected" && !event.interruption.at) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["interruption", "at"], message: "Detected interruption requires an observed learner speech-start time." });
  }
});
export type LearnerTurnEvent = z.infer<typeof LearnerTurnEventSchema>;

export const SessionTerminalStateSchema = z.enum([
  "SAFE_WORD",
  "LEARNER_ENDED",
  "VERIFIED_INDEPENDENTLY",
  "DUMMY_SECRET_DISCLOSED",
  "MAX_TURNS",
  "SAFE_FALLBACK",
]);
export type SessionTerminalState = z.infer<typeof SessionTerminalStateSchema>;

/** TTS accepts only text carried by an explicitly reviewed scenario response or system-safe template. */
export const ApprovedCallerResponseSchema = z.object({
  scenarioId: z.string().min(1),
  scenarioVersion: z.string().min(1),
  responseId: z.string().min(1),
  text: z.string().min(1),
  language: z.string().min(1),
  voice: z.string().min(1),
  safetyStatus: z.enum(["system_safe_template", "reviewed_safe"]),
  scenarioReviewStatus: z.enum(["approved", "not_applicable"]),
  approvalReference: z.string().min(1),
}).strict().superRefine((response, context) => {
  if (response.safetyStatus === "reviewed_safe" && response.scenarioReviewStatus !== "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioReviewStatus"], message: "Reviewed scenario responses require an approved scenario." });
  }
  if (response.safetyStatus === "system_safe_template" && response.scenarioReviewStatus !== "not_applicable") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioReviewStatus"], message: "System-safe templates do not claim scenario approval." });
  }
  const expectedReference = response.safetyStatus === "system_safe_template"
    ? `system-template:${response.responseId}`
    : `${response.scenarioId}@${response.scenarioVersion}:${response.responseId}`;
  if (response.approvalReference !== expectedReference) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalReference"], message: "Approval reference must match the scenario version and response identity." });
  }
});
export type ApprovedCallerResponse = z.infer<typeof ApprovedCallerResponseSchema>;

/** Provider request carries an approved content reference, never caller-supplied speech text. */
export const ApprovedCallerResponseReferenceSchema = z.object({
  scenarioId: z.string().min(1),
  scenarioVersion: z.string().min(1),
  responseId: z.string().min(1),
  language: z.string().min(1),
  voice: z.string().min(1),
  safetyStatus: z.enum(["system_safe_template", "reviewed_safe"]),
  scenarioReviewStatus: z.enum(["approved", "not_applicable"]),
  approvalReference: z.string().min(1),
}).strict().superRefine((response, context) => {
  if (response.safetyStatus === "reviewed_safe" && response.scenarioReviewStatus !== "approved") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioReviewStatus"], message: "Reviewed scenario responses require an approved scenario." });
  }
  if (response.safetyStatus === "system_safe_template" && response.scenarioReviewStatus !== "not_applicable") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioReviewStatus"], message: "System-safe templates do not claim scenario approval." });
  }
  const expectedReference = response.safetyStatus === "system_safe_template"
    ? `system-template:${response.responseId}`
    : `${response.scenarioId}@${response.scenarioVersion}:${response.responseId}`;
  if (response.approvalReference !== expectedReference) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["approvalReference"], message: "Approval reference must match the scenario version and response identity." });
  }
});
export type ApprovedCallerResponseReference = z.infer<typeof ApprovedCallerResponseReferenceSchema>;

export const PressureTimelinePointSchema = z.object({
  turnId: z.string().min(1),
  callerPressureLevel: z.number().int().min(0).max(5),
  responseLatency: TimingValueSchema.nullable(),
  learnerBehavior: BehaviorClassificationSchema,
  interruptedCaller: InterruptionStatusSchema,
  complianceMoment: ComplianceMomentSchema.nullable(),
  approximateTiming: z.boolean(),
  timeReference: z.literal("session-local monotonic milliseconds"),
  observedEvidence: z.array(z.string().min(1)),
}).strict();
export type PressureTimelinePoint = z.infer<typeof PressureTimelinePointSchema>;

export const DebriefStatementSchema = z.object({
  kind: z.enum(["pressure", "latency", "hesitation", "filler", "speech_rate", "behavior", "interruption", "compliance", "timing_limit"]),
  text: z.string().min(1),
  sourceTurnId: z.string().min(1),
  eventFact: z.string().min(1),
}).strict();
export type DebriefStatement = z.infer<typeof DebriefStatementSchema>;

export const DeterministicDebriefSchema = z.object({
  sessionId: z.string().min(1),
  statements: z.array(DebriefStatementSchema),
  pressureTimeline: z.array(PressureTimelinePointSchema),
  firstComplianceMoment: ComplianceMomentSchema.nullable(),
  sourceTurnIds: z.array(z.string().min(1)),
}).strict();
export type DeterministicDebrief = z.infer<typeof DeterministicDebriefSchema>;
