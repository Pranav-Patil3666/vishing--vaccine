import { z } from "zod";

export const PCM_SAMPLE_RATES = [8_000, 16_000, 44_100, 48_000] as const;
export const PCM_FRAME_BYTES = 1_024 as const;
export const PCM_FRAME_SAMPLES = PCM_FRAME_BYTES / 2;

export const PcmSampleRateSchema = z.union([
  z.literal(8_000), z.literal(16_000), z.literal(44_100), z.literal(48_000),
]);
export type PcmSampleRate = z.infer<typeof PcmSampleRateSchema>;

export const PcmAudioConfigurationSchema = z.object({
  encoding: z.literal("PCM_S16LE"),
  channels: z.literal(1),
  frameBytes: z.literal(PCM_FRAME_BYTES),
  sampleRateHz: PcmSampleRateSchema,
  language: z.string().min(1),
  minimumSegmentDurationCapability: z.object({
    durationMs: z.number().positive(),
    verificationStatus: z.enum(["unverified", "verified"]),
  }).strict().optional(),
}).strict();
export type PcmAudioConfiguration = z.infer<typeof PcmAudioConfigurationSchema>;

export const PcmFrameSchema = z.instanceof(Uint8Array).refine(
  (frame) => frame.byteLength === PCM_FRAME_BYTES,
  "A streaming PCM frame must contain exactly 1,024 bytes.",
);
declare const pcmFrameBrand: unique symbol;
export type PcmFrame = Uint8Array & { readonly [pcmFrameBrand]: "pcm-frame-1024" };

export function validatePcmConfiguration(input: unknown): PcmAudioConfiguration {
  return PcmAudioConfigurationSchema.parse(input);
}

export function validatePcmFrame(input: unknown): PcmFrame {
  return PcmFrameSchema.parse(input) as PcmFrame;
}

export function createPcmFrame(input: Uint8Array): PcmFrame {
  return validatePcmFrame(input.slice());
}

export function pcmFrameDurationMs(sampleRateHz: PcmSampleRate): number {
  return (PCM_FRAME_SAMPLES / sampleRateHz) * 1_000;
}

/** Delay before a frame is due, based on a caller-supplied local monotonic elapsed time. */
export function realtimePacingDelayMs(configuration: PcmAudioConfiguration, sentFrames: number, elapsedMs: number): number {
  if (!Number.isSafeInteger(sentFrames) || sentFrames < 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError("Pacing values must be non-negative finite monotonic measurements.");
  }
  return Math.max(0, sentFrames * pcmFrameDurationMs(configuration.sampleRateHz) - elapsedMs);
}

export const PrismaConnectionStateSchema = z.enum(["IDLE", "CONNECTING", "CONNECTED", "CLOSING", "CLOSED", "ERROR"]);
export type PrismaConnectionState = z.infer<typeof PrismaConnectionStateSchema>;

const lifecycleTransitions: Readonly<Record<PrismaConnectionState, readonly PrismaConnectionState[]>> = {
  IDLE: ["CONNECTING", "CLOSED"],
  CONNECTING: ["CONNECTED", "CLOSING", "ERROR"],
  CONNECTED: ["CLOSING", "ERROR"],
  CLOSING: ["CLOSED", "ERROR"],
  CLOSED: ["CONNECTING"],
  ERROR: ["CLOSING", "CLOSED", "CONNECTING"],
};

export function transitionPrismaConnection(current: PrismaConnectionState, next: PrismaConnectionState): PrismaConnectionState {
  if (!lifecycleTransitions[current].includes(next)) throw new Error(`Invalid realtime connection transition ${current} -> ${next}.`);
  return next;
}

export const PrismaProcessingEventSchema = z.object({
  type: z.literal("processing"),
  providerTimestamp: z.string().datetime(),
}).strict();
export const PrismaTranscriptEventSchema = z.object({
  type: z.literal("transcript"),
  providerTimestamp: z.string().datetime(),
  text: z.string(),
  audioDurationMs: z.number().finite().nonnegative(),
  segmentId: z.string().min(1),
  segmentIndex: z.number().int().nonnegative(),
  latencyMs: z.number().finite().nonnegative(),
}).strict();
export const PrismaErrorEventSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1).optional(),
}).strict();
export const PrismaUnknownEventSchema = z.object({
  type: z.literal("unknown"),
  providerType: z.string().optional(),
}).strict();
export const PrismaRealtimeEventSchema = z.discriminatedUnion("type", [
  PrismaProcessingEventSchema,
  PrismaTranscriptEventSchema,
  PrismaErrorEventSchema,
  PrismaUnknownEventSchema,
]);
export type PrismaRealtimeEvent = z.infer<typeof PrismaRealtimeEventSchema>;

/** Normalize documented provider events without using provider wall-clock timestamps as the session clock. */
export function parsePrismaRealtimeEvent(input: unknown): PrismaRealtimeEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { type: "unknown" };
  const event = input as Record<string, unknown>;
  if (event.type === "processing") {
    const parsed = PrismaProcessingEventSchema.safeParse({ type: event.type, providerTimestamp: event.timestamp });
    return parsed.success ? parsed.data : { type: "unknown", providerType: "processing" };
  }
  if (event.type === "transcript") {
    const parsed = PrismaTranscriptEventSchema.safeParse({
      type: event.type,
      providerTimestamp: event.timestamp,
      text: event.text,
      audioDurationMs: event.audio_duration_ms,
      segmentId: event.segment_id,
      segmentIndex: event.segment_index,
      latencyMs: event.latency,
    });
    return parsed.success ? parsed.data : { type: "unknown", providerType: "transcript" };
  }
  if (event.type === "error") {
    return PrismaErrorEventSchema.parse({ type: "error", ...(typeof event.code === "string" ? { code: event.code.slice(0, 80) } : {}) });
  }
  return { type: "unknown", ...(typeof event.type === "string" ? { providerType: event.type.slice(0, 80) } : {}) };
}

export const PrismaRealtimeLocalEventSchema = z.union([
  z.object({ type: z.literal("connected") }).strict(),
  PrismaProcessingEventSchema,
  PrismaTranscriptEventSchema,
  PrismaErrorEventSchema,
  PrismaUnknownEventSchema,
  z.object({ type: z.literal("closed") }).strict(),
]);
export type PrismaRealtimeLocalEvent = z.infer<typeof PrismaRealtimeLocalEventSchema>;

/** Backend-only boundary; a concrete WebSocket adapter is intentionally not part of this contract amendment. */
export interface PrismaRealtimeTransport {
  connect(configuration: PcmAudioConfiguration): Promise<void>;
  sendFrame(frame: PcmFrame): Promise<void>;
  events(): AsyncIterable<PrismaRealtimeLocalEvent>;
  close(): Promise<void>;
}
