import { randomUUID } from "node:crypto";
import WebSocket, { type ClientOptions, type RawData } from "ws";
import { z } from "zod";
import {
  REAL_TURN_LIMITS, TranscriptEventSchema, validatePcmFrame,
  type SpeechRecognizer, type SpeechRecognitionRequest, type StreamingRecognitionRequest,
  type StreamingRecognitionSession, type TranscriptEvent,
} from "@vaccine/contracts";
import { ApplicationError, type ApplicationErrorCode } from "../../errors.js";
import type { PrismaRuntimeConfig } from "./runtimeConfig.js";
import { TranscriptAssembler } from "./transcriptAssembly.js";

const timestamp = z.string().datetime({ offset: true }).optional();
const wireEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("connected"), timestamp,
    config: z.object({ sample_rate: z.number().positive().optional(), chunk_size: z.number().int().positive().optional() }).optional() }),
  z.object({ type: z.literal("speech_start"), timestamp }),
  z.object({ type: z.literal("transcript"), text: z.string().max(8192), timestamp,
    segment_id: z.string().min(1).max(256).optional(), segment_index: z.number().int().nonnegative().optional(),
    audio_duration_ms: z.number().finite().nonnegative().optional(), latency: z.number().finite().nonnegative().optional() }),
  z.object({ type: z.literal("error") }),
]);
export interface PrismaRuntimeDiagnostic { code: ApplicationErrorCode; event: "unknown" | "malformed" | "transport"; }
export interface PrismaRecognizerOptions {
  socketFactory?: (endpoint: string, options: ClientOptions) => WebSocket;
  limits?: Partial<{ [K in keyof typeof REAL_TURN_LIMITS]: number }>;
  onDiagnostic?: (diagnostic: PrismaRuntimeDiagnostic) => void;
}

/** Backend-only runtime adapter. Verification harnesses remain independent historical evidence. */
export class PrismaRealtimeSpeechRecognizer implements SpeechRecognizer {
  constructor(private readonly config: PrismaRuntimeConfig, private readonly options: PrismaRecognizerOptions = {}) {}
  openStream(request: StreamingRecognitionRequest): StreamingRecognitionSession {
    if (request.language !== "hi-IN" || !Number.isInteger(request.turnNumber) || request.turnNumber < 1 || request.turnNumber > 3) throw new ApplicationError("INVALID_REQUEST", "This runtime supports bounded hi-IN learner turns 1 through 3.");
    return new PrismaRecognitionStream(this.config, request, this.options);
  }
  async transcribe(request: SpeechRecognitionRequest): Promise<TranscriptEvent> {
    if (request.input.mediaType !== "audio/pcm" || request.input.sampleRateHz !== 16000
      || request.input.bytes.length === 0 || request.input.bytes.length % 1024 !== 0
      || request.input.bytes.length > REAL_TURN_LIMITS.maxFrames * 1024) {
      throw new ApplicationError("INVALID_REQUEST", "Runtime transcription requires bounded 16 kHz PCM16LE frames.");
    }
    const stream = this.openStream(request);
    try {
      await stream.ready;
      for (let offset = 0; offset < request.input.bytes.length; offset += 1024) {
        const bytes = request.input.bytes.slice(offset, offset + 1024);
        try { await stream.sendFrame(bytes); await pause(32); } finally { bytes.fill(0); }
      }
      return await stream.finish();
    } catch (error) { stream.cancel(); throw error; }
    finally { request.input.bytes.fill(0); }
  }
}

class PrismaRecognitionStream implements StreamingRecognitionSession {
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: ApplicationError) => void;
  private readonly closed: Promise<number>;
  private resolveClosed!: (code: number) => void;
  private readonly socket: WebSocket;
  private readonly limits;
  private readonly assembler = new TranscriptAssembler();
  private failure: ApplicationError | undefined;
  private connected = false;
  private inactive = false;
  private closing = false;
  private finishing: Promise<TranscriptEvent> | undefined;
  private sending = false;
  private frames = 0;
  private readonly startedAt = performance.now();
  private connectionMs: number | undefined;
  private firstTranscriptMs: number | undefined;
  private providerSpeechStartTimestamp: string | undefined;
  private speechStartCount = 0;
  private readonly connectTimer: ReturnType<typeof setTimeout>;
  private readonly totalTimer: ReturnType<typeof setTimeout>;
  constructor(config: PrismaRuntimeConfig, private readonly request: StreamingRecognitionRequest, private readonly options: PrismaRecognizerOptions) {
    this.limits = { ...REAL_TURN_LIMITS, ...options.limits };
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => {});
    this.closed = new Promise<number>((resolve) => { this.resolveClosed = resolve; });
    this.socket = (options.socketFactory ?? ((endpoint, settings) => new WebSocket(endpoint, settings)))(config.endpoint,
      { headers: config.headers, handshakeTimeout: this.limits.connectMs, maxPayload: 16_384, perMessageDeflate: false, followRedirects: false });
    this.connectTimer = setTimeout(() => this.fail("STT_TIMEOUT", "transport"), this.limits.connectMs);
    this.totalTimer = setTimeout(() => this.fail("STT_TIMEOUT", "transport"), this.limits.totalMs);
    this.socket.on("message", (data: RawData, binary: boolean) => this.receive(data, binary));
    this.socket.on("error", () => this.fail("STT_CONNECTION_FAILED", "transport"));
    this.socket.on("unexpected-response", (_request, response) => { response.resume(); this.fail("STT_CONNECTION_FAILED", "transport"); });
    this.socket.on("close", (code: number) => {
      this.resolveClosed(code);
      if (!this.inactive && (!this.closing || code !== 1000)) this.fail("STT_CONNECTION_FAILED", "transport");
    });
  }
  private receive(data: RawData, binary: boolean): void {
    if (this.inactive) return;
    try {
      if (binary) throw new Error();
      const raw = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
      if (raw.length > 16_384) throw new Error();
      const value: unknown = JSON.parse(raw.toString("utf8"));
      const result = wireEvent.safeParse(value);
      if (!result.success) {
        const unknown = typeof value === "object" && value !== null && "type" in value
          && !["connected", "speech_start", "transcript", "error"].includes(String(value.type));
        this.fail("STT_PROTOCOL_ERROR", unknown ? "unknown" : "malformed"); return;
      }
      const event = result.data;
      if (event.type === "connected") {
        if (this.connected || this.closing || (event.config?.sample_rate !== undefined && event.config.sample_rate !== 16000)
          || (event.config?.chunk_size !== undefined && event.config.chunk_size !== 512)) throw new Error();
        this.connected = true; this.connectionMs = performance.now() - this.startedAt;
        clearTimeout(this.connectTimer); this.resolveReady(); return;
      }
      if (!this.connected) throw new Error();
      if (event.type === "error") { this.fail("STT_CONNECTION_FAILED", "transport"); return; }
      // Provider speech_start is reference metadata only. No learner timing is constructed here.
      if (event.type === "speech_start") { this.speechStartCount++; this.providerSpeechStartTimestamp = event.timestamp; return; }
      this.assembler.add({ text: event.text,
        ...(event.timestamp === undefined ? {} : { providerTimestamp: event.timestamp }),
        ...(event.segment_id === undefined ? {} : { segmentId: event.segment_id }),
        ...(event.segment_index === undefined ? {} : { segmentIndex: event.segment_index }),
        ...(event.audio_duration_ms === undefined ? {} : { providerAudioDurationMs: event.audio_duration_ms }),
        ...(event.latency === undefined ? {} : { providerLatencyMs: event.latency }),
      });
      if (event.text.trim() && this.firstTranscriptMs === undefined) this.firstTranscriptMs = performance.now() - this.startedAt;
    } catch { this.fail("STT_PROTOCOL_ERROR", "malformed"); }
  }
  async sendFrame(frame: Uint8Array): Promise<void> {
    await this.ready;
    if (this.finishing || this.closing) throw new ApplicationError("STT_CANCELLED", "The audio window is already finishing.");
    if (++this.frames > this.limits.maxFrames) { this.fail("STT_PROTOCOL_ERROR", "transport"); this.check(); }
    try { await this.send(frame); }
    catch { if (!this.failure) this.fail("STT_PROTOCOL_ERROR", "transport"); throw this.failure; }
  }
  private async send(frame: Uint8Array): Promise<void> {
    this.check(); validatePcmFrame(frame);
    if (!this.connected || this.sending || this.socket.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 8 * 1024) {
      this.fail("STT_CONNECTION_FAILED", "transport"); this.check();
    }
    this.sending = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.fail("STT_TIMEOUT", "transport"); reject(this.failure); }, this.limits.sendMs);
        this.socket.send(frame, { binary: true }, (error) => {
          clearTimeout(timer);
          if (error) { this.fail("STT_CONNECTION_FAILED", "transport"); reject(this.failure); } else resolve();
        });
      });
      this.check();
    } finally { this.sending = false; }
  }
  finish(): Promise<TranscriptEvent> {
    this.finishing ??= this.finishOnce();
    return this.finishing;
  }
  private async finishOnce(): Promise<TranscriptEvent> {
    try {
      await this.ready; this.check();
      // Preserve Phase 4A's tested silence/drain approach; no guessed EOS/speech_end protocol.
      const silence = new Uint8Array(1024);
      for (let elapsed = 0; elapsed < this.limits.silenceMs; elapsed += 32) {
        await this.send(silence); await pause(Math.min(32, this.limits.silenceMs - elapsed)); this.check();
      }
      await pause(this.limits.settleMs); this.check();
      this.closing = true; this.socket.close(1000);
      const code = await deadline(this.closed, this.limits.closeMs);
      this.check();
      if (code !== 1000) throw new ApplicationError("STT_CONNECTION_FAILED", "Speech transcription could not complete. The turn was not advanced.");
      const { text, segments } = this.assembler.result();
      if (!text) throw new ApplicationError("STT_EMPTY", "Speech was detected but transcription was unavailable. The turn was not advanced.");
      const transcript = TranscriptEventSchema.parse({ eventId: randomUUID(), ...this.request, language: "hi-IN", text, segments,
        normalizationStatus: "normalized", providerMetadata: { provider: "prisma", semantics: "segments_without_finalness",
          segmentCount: segments.length, connectionMs: this.connectionMs ?? null, firstTranscriptMs: this.firstTranscriptMs ?? null, closeCode: code,
          speechStartCount: this.speechStartCount,
          ...(this.providerSpeechStartTimestamp === undefined ? {} : { providerSpeechStartReferenceTimestamp: this.providerSpeechStartTimestamp }) } });
      this.inactive = true; this.clear(); return transcript;
    } catch (error) {
      if (!this.failure) this.fail(error instanceof ApplicationError ? error.code : "STT_PROTOCOL_ERROR", "transport");
      throw this.failure;
    }
  }
  private check(): void {
    if (this.failure) throw this.failure;
    if (this.inactive) throw new ApplicationError("STT_CANCELLED", "Speech capture was cancelled.");
  }
  private fail(code: ApplicationErrorCode, event: PrismaRuntimeDiagnostic["event"]): void {
    if (this.inactive) return;
    this.failure = new ApplicationError(code, "Speech transcription could not complete. The turn was not advanced.");
    try { this.options.onDiagnostic?.({ code, event }); } catch { /* Diagnostics must not prevent capture cleanup. */ }
    this.inactive = true;
    this.rejectReady(this.failure); this.clear(); this.socket.terminate();
  }
  cancel(): void { this.fail("STT_CANCELLED", "transport"); }
  private clear(): void { clearTimeout(this.connectTimer); clearTimeout(this.totalTimer); this.assembler.clear(); }
}
function pause(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function deadline<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ApplicationError("STT_TIMEOUT", "Speech transcription timed out.")), ms); })]); }
  finally { clearTimeout(timer); }
}
