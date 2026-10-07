import type {
  PcmAudioConfiguration,
  PcmFrame,
  PrismaRealtimeTraceEvent,
  SpeechRecognitionRequest,
  SpeechRecognizer,
  TranscriptEvent,
} from "@vaccine/contracts";
import {
  PcmAudioConfigurationSchema,
  PrismaRealtimeTraceEventSchema,
  createPcmFrame,
  pcmFrameDurationMs,
  transitionPrismaConnection,
  validatePcmFrame,
} from "@vaccine/contracts";

export interface MockPrismaTranscriptFixture {
  text: string;
  segmentIndex?: number;
  segmentId?: string;
  audioDurationMs?: number;
  providerLatencyMs?: number;
  processingTimestamp?: string;
  providerTimestamp?: string;
  errorCode?: string;
}

/** Local, deterministic transport trace. It validates PCM and discards the frame bytes immediately. */
export class MockPrismaRealtimeTransport {
  private state: "IDLE" | "CONNECTING" | "CONNECTED" | "CLOSING" | "CLOSED" | "ERROR" = "IDLE";
  private configuration: PcmAudioConfiguration | undefined;
  private readonly trace: PrismaRealtimeTraceEvent[] = [];
  private frameIndex = 0;

  constructor(private readonly fixture: MockPrismaTranscriptFixture, private readonly nowIso: () => string = () => "2026-10-07T00:00:00.000Z") {}

  async connect(configuration: PcmAudioConfiguration): Promise<void> {
    if (this.state !== "IDLE" && this.state !== "CLOSED") throw new Error("Mock Prisma transport is already active.");
    this.configuration = PcmAudioConfigurationSchema.parse(configuration);
    this.state = transitionPrismaConnection(this.state, "CONNECTING");
    this.push({ type: "CONNECT" });
    this.state = transitionPrismaConnection(this.state, "CONNECTED");
    this.push({ type: "CONNECTED" });
  }

  async sendFrame(input: PcmFrame | Uint8Array): Promise<void> {
    if (this.state !== "CONNECTED" || !this.configuration) throw new Error("Mock Prisma transport must be connected before audio frames are sent.");
    const frame = validatePcmFrame(input);
    this.push({
      type: "AUDIO_FRAME", frameIndex: this.frameIndex,
      byteLength: frame.byteLength as 1_024,
      sampleRateHz: this.configuration.sampleRateHz,
      encoding: this.configuration.encoding,
      channels: this.configuration.channels,
      durationMs: pcmFrameDurationMs(this.configuration.sampleRateHz),
    });
    this.frameIndex += 1;
    this.push({ type: "PROCESSING", processingTimestamp: this.fixture.processingTimestamp ?? this.nowIso() });
    if (this.fixture.errorCode) {
      this.state = transitionPrismaConnection(this.state, "ERROR");
      this.push({ type: "ERROR", code: this.fixture.errorCode.slice(0, 80) });
      return;
    }
    this.push({
      type: "TRANSCRIPT",
      text: this.fixture.text,
      segmentIndex: this.fixture.segmentIndex ?? 0,
      segmentId: this.fixture.segmentId ?? `mock-segment-${this.frameIndex - 1}`,
      audioDurationMs: this.fixture.audioDurationMs ?? pcmFrameDurationMs(this.configuration.sampleRateHz),
      providerLatencyMs: this.fixture.providerLatencyMs ?? 0,
      providerTimestamp: this.fixture.providerTimestamp ?? this.nowIso(),
    });
  }

  async close(): Promise<void> {
    if (this.state === "CONNECTED" || this.state === "ERROR") this.state = transitionPrismaConnection(this.state, "CLOSING");
    else if (this.state === "IDLE") this.state = transitionPrismaConnection(this.state, "CLOSED");
    if (this.state === "CLOSING") this.state = transitionPrismaConnection(this.state, "CLOSED");
    this.push({ type: "CLOSE" });
  }

  async *events(): AsyncIterable<PrismaRealtimeTraceEvent> {
    for (const event of this.trace) yield PrismaRealtimeTraceEventSchema.parse(event);
  }

  snapshot(): readonly PrismaRealtimeTraceEvent[] {
    return this.trace.map((event) => PrismaRealtimeTraceEventSchema.parse(event));
  }

  private push(event: PrismaRealtimeTraceEvent): void {
    this.trace.push(PrismaRealtimeTraceEventSchema.parse(event));
  }
}

export class MockPrismaRecognizer implements SpeechRecognizer {
  constructor(private readonly transcripts: ReadonlyMap<string, string> = new Map()) {}

  async transcribe(request: SpeechRecognitionRequest): Promise<TranscriptEvent> {
    const key = `${request.sessionId}:${request.turnNumber}`;
    const mockText = request.input.mediaType === "text/mock"
      ? new TextDecoder().decode(request.input.bytes)
      : this.transcripts.get(key) ?? "";
    return {
      eventId: `mock-transcript-${request.sessionId}-${request.turnNumber}`,
      sessionId: request.sessionId,
      turnNumber: request.turnNumber,
      text: mockText,
      language: request.language,
      normalizationStatus: "unchanged",
    };
  }

  static frameFixture(): PcmFrame {
    return createPcmFrame(new Uint8Array(1_024));
  }
}
