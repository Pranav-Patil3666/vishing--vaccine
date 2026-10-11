import { createHash } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../../errors.js";

const metadata = {
  timestamp: z.string().datetime({ offset: true }).optional(),
  audio_duration_ms: z.number().finite().nonnegative().optional(),
  segment_id: z.string().min(1).max(256).optional(),
  segment_index: z.number().int().nonnegative().optional(),
  latency: z.number().finite().nonnegative().optional(),
};
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected"), timestamp: metadata.timestamp,
    config: z.object({ sample_rate: z.number().finite().positive().optional(), chunk_size: z.number().int().positive().optional() }).optional() }),
  z.object({ type: z.literal("processing"), timestamp: metadata.timestamp }),
  // Live-observed provider VAD metadata; never a learner/session timing authority.
  z.object({ type: z.literal("speech_start"), timestamp: metadata.timestamp }),
  z.object({ type: z.literal("transcript"), text: z.string().min(1).max(8192).refine((text) => text.trim().length > 0), ...metadata }),
  z.object({ type: z.literal("error") }),
]);
export type CandidateEvent = z.infer<typeof eventSchema>;
export interface SanitizedEvent {
  eventType: CandidateEvent["type"] | "unknown";
  receivedAtMonotonicMs: number;
  providerTimestamp?: string;
  characterCount?: number;
  hasLatin?: boolean;
  hasDevanagari?: boolean;
  digitCount?: number;
  matchesSyntheticPhrase?: boolean;
  matchedSyntheticPartIndexes?: number[];
  segmentFingerprint?: string;
  segmentIndex?: number;
  audioDurationMs?: number;
  providerLatencyMs?: number;
  reportedSampleRateHz?: number;
  reportedChunkSize?: number;
  knownFields: Record<string, string>;
  unknownFieldCount: number;
  recognizedUnknownType?: string;
}
const knownFields = ["type", "timestamp", "text", "audio_duration_ms", "segment_id", "segment_index", "latency", "config", "message", "code"];
const unknownTypes = new Set(["partial", "interim", "revision", "speech_end", "vad_start", "vad_end", "settings_updated"]);
function invalid(): never { throw new ApplicationError("TRANSCRIPTION_FAILED", "Prisma returned malformed verification data."); }

/** Candidate parser, not a verified production provider contract. Missing metadata stays absent. */
export function inspectCandidateEvent(raw: string, receivedAtMonotonicMs: number, expectedText: string, expectedParts: readonly string[] = []): { event?: CandidateEvent; diagnostic: SanitizedEvent } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalid(); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const object = value as Record<string, unknown>;
  const fields = Object.fromEntries(knownFields.filter((key) => Object.hasOwn(object, key)).map((key) => [key,
    object[key] === null ? "null" : Array.isArray(object[key]) ? "array" : typeof object[key]]));
  const base = { receivedAtMonotonicMs, knownFields: fields, unknownFieldCount: Object.keys(object).filter((key) => !knownFields.includes(key)).length };
  if (typeof object.type !== "string") return invalid();
  if (!["connected", "processing", "speech_start", "transcript", "error"].includes(object.type)) {
    return { diagnostic: { ...base, eventType: "unknown", ...(unknownTypes.has(object.type) ? { recognizedUnknownType: object.type } : {}) } };
  }
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return invalid();
  const event = parsed.data;
  const diagnostic: SanitizedEvent = { ...base, eventType: event.type };
  if ("timestamp" in event && event.timestamp !== undefined) diagnostic.providerTimestamp = event.timestamp;
  if (event.type === "connected" && event.config) {
    if (event.config.sample_rate !== undefined) diagnostic.reportedSampleRateHz = event.config.sample_rate;
    if (event.config.chunk_size !== undefined) diagnostic.reportedChunkSize = event.config.chunk_size;
  }
  if (event.type === "transcript") {
    diagnostic.characterCount = event.text.length;
    diagnostic.hasLatin = /[a-zA-Z]/.test(event.text);
    diagnostic.hasDevanagari = /[\u0900-\u097f]/.test(event.text);
    diagnostic.digitCount = (event.text.match(/[0-9\u0966-\u096f]/g) ?? []).length;
    diagnostic.matchesSyntheticPhrase = event.text.trim().toLowerCase() === expectedText.toLowerCase();
    if (expectedParts.length) diagnostic.matchedSyntheticPartIndexes = expectedParts.flatMap((part, index) =>
      event.text.trim().toLowerCase() === part.toLowerCase() ? [index] : []);
    if (event.segment_id !== undefined) diagnostic.segmentFingerprint = createHash("sha256").update(event.segment_id).digest("hex").slice(0, 16);
    if (event.segment_index !== undefined) diagnostic.segmentIndex = event.segment_index;
    if (event.audio_duration_ms !== undefined) diagnostic.audioDurationMs = event.audio_duration_ms;
    if (event.latency !== undefined) diagnostic.providerLatencyMs = event.latency;
  }
  return { event, diagnostic };
}
