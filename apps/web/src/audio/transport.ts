import {
  BrowserAudioSummarySchema, BrowserAudioWindowSchema,
  type BrowserAudioSummary, type BrowserAudioTimingFacts, type PcmFrameMetadata,
} from "@vaccine/contracts";
import { audioFailure, BrowserAudioError } from "./errors.js";
import type { AudioPipelineDiagnostics } from "./diagnostics.js";

export interface AudioForwarder {
  setDiagnostics?(trace: AudioPipelineDiagnostics): void;
  open(audioClockId: string, turnNumber: number): Promise<void>;
  frame(bytes: Uint8Array, metadata: PcmFrameMetadata): void;
  finish(facts: BrowserAudioTimingFacts): Promise<BrowserAudioSummary>;
  cancel(): void;
  readonly queuedFrames: number;
}

/** Eight frames (256 ms) maximum, one in-flight HTTP request, no retries, no persistent storage. */
export class DevelopmentAudioForwarder implements AudioForwarder {
  private token: string | undefined;
  private queue: Array<{ bytes: Uint8Array; metadata: PcmFrameMetadata }> = [];
  private pending: Promise<void> = Promise.resolve();
  private inFlight = false;
  private activeBytes: Uint8Array | undefined;
  private closed = false;
  private failure: BrowserAudioError | undefined;
  private abort = new AbortController();
  private trace: AudioPipelineDiagnostics | undefined;
  setDiagnostics(trace: AudioPipelineDiagnostics): void { this.trace = trace; }
  constructor(private readonly sessionId: string, private readonly baseUrl = "", private readonly fetcher: typeof fetch = fetch,
    private readonly onError: (error: BrowserAudioError) => void = () => {}) {
    // Window.fetch rejects the forwarder as its receiver. Preserve a standalone call for every request, including cancel.
    this.fetcher = (input, init) => fetcher(input, init);
  }
  get queuedFrames(): number { return this.queue.length + Number(this.inFlight); }
  private url(action: string): string {
    const path = `/api/sessions/${encodeURIComponent(this.sessionId)}/audio/${action}`;
    return this.baseUrl.trim() ? new URL(path, this.baseUrl).toString() : path;
  }
  private async request(action: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<unknown> {
    const timeout = setTimeout(() => this.abort.abort(), 2000);
    try {
      const response = await this.fetcher(this.url(action), { method: "POST", cache: "no-store", signal: this.abort.signal,
        headers: { ...headers, ...(this.token ? { "x-audio-token": this.token } : {}) }, ...(body === undefined ? {} : { body }) });
      if (!response.ok) throw new Error(`Audio ${action} request failed (HTTP ${response.status}).`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async open(audioClockId: string, turnNumber: number): Promise<void> {
    try {
      const window = BrowserAudioWindowSchema.parse(await this.request("start", JSON.stringify({ audioClockId, turnNumber }), { "content-type": "application/json" }));
      this.token = window.token;
      if (this.closed) this.cancel();
      else this.trace?.mark("TRANSPORT_READY");
    } catch (cause) { throw audioFailure(cause, "PCM_PIPELINE_FAILED", "TRANSPORT_OPEN"); }
  }
  frame(bytes: Uint8Array, metadata: PcmFrameMetadata): void {
    if (this.closed || this.failure || !this.token) { bytes.fill(0); throw new BrowserAudioError("PCM_PIPELINE_FAILED"); }
    if (bytes.length !== 1024 || this.queuedFrames >= 8) { bytes.fill(0); throw new BrowserAudioError("BACKPRESSURE"); }
    this.queue.push({ bytes, metadata });
    if (!this.inFlight) this.pending = this.drain();
  }
  private async drain(): Promise<void> {
    this.inFlight = true;
    try {
      while (!this.closed && this.queue.length) {
        const item = this.queue.shift()!;
        this.activeBytes = item.bytes;
        try {
          await this.request("frame", item.bytes as Uint8Array<ArrayBuffer>, { "content-type": "application/octet-stream",
            "x-audio-sequence": String(item.metadata.sequence), "x-audio-produced-at": String(item.metadata.producedAtMonotonicMs) });
          this.trace?.mark("FIRST_FRAME_FORWARDED");
        } finally { item.bytes.fill(0); this.activeBytes = undefined; }
      }
    } catch (cause) {
      if (!this.closed) { this.failure = audioFailure(cause, "PCM_PIPELINE_FAILED", "TRANSPORT_FRAME"); this.onError(this.failure); this.cancel(); }
    } finally { this.inFlight = false; }
  }
  async finish(facts: BrowserAudioTimingFacts): Promise<BrowserAudioSummary> {
    await this.pending;
    if (this.failure || this.closed) throw this.failure ?? new BrowserAudioError("PCM_PIPELINE_FAILED");
    try {
      const result = BrowserAudioSummarySchema.parse(await this.request("finish", JSON.stringify(facts), { "content-type": "application/json" }));
      this.closed = true; this.token = undefined; return result;
    } catch (cause) { throw audioFailure(cause, "PCM_PIPELINE_FAILED", "TRANSPORT_FINISH"); }
  }
  cancel(): void {
    this.closed = true; this.abort.abort();
    this.activeBytes?.fill(0); this.activeBytes = undefined;
    for (const item of this.queue) item.bytes.fill(0);
    this.queue = [];
    if (this.token) {
      // Best effort only; capture cleanup never waits for a network acknowledgement.
      void this.fetcher(this.url("cancel"), { method: "POST", cache: "no-store", headers: { "x-audio-token": this.token }, keepalive: true }).catch(() => {});
      this.token = undefined;
    }
  }
}
