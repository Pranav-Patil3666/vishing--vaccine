import type { AudioCaptureState, BrowserAudioFact, BrowserAudioSummary, BrowserAudioTimingFacts, PcmFrameMetadata } from "@vaccine/contracts";
import type { AppliedAudioSettings, CaptureConnection } from "./browserCapture.js";
import { audioFailure, BrowserAudioError } from "./errors.js";
import { AudioPipelineDiagnostics, sanitizeAudioException, type AudioFailureDiagnostic, type AudioPipelineSnapshot } from "./diagnostics.js";
import { PcmFrameAssembler, StreamingResampler, rms } from "./pcm.js";
import type { AudioForwarder } from "./transport.js";
import { LocalVad } from "./vad.js";

export interface AudioDiagnostics {
  state: AudioCaptureState; error: BrowserAudioError | null; sourceRate: number | null; settings: AppliedAudioSettings;
  level: number; noiseFloor: number; speechOn: number; speechOff: number; vadState: string;
  frameCount: number; paddedSamples: number; backpressuredFrames: number; queuedFrames: number;
  latestStartMs: number | null; latestEndMs: number | null; timingValid: boolean;
  summary: BrowserAudioSummary | null; callerPlaying: boolean; callerPlayed: boolean; segmentCount: number;
  pipeline: AudioPipelineSnapshot | null; failure: AudioFailureDiagnostic | null;
}
export interface AudioControllerOptions {
  sessionId: string; turnNumber: number; eligible: () => boolean;
  acquire: (signal: AbortSignal, trace?: AudioPipelineDiagnostics) => Promise<CaptureConnection>;
  forwarder: (onError: (error: BrowserAudioError) => void) => AudioForwarder;
  onChange: (snapshot: AudioDiagnostics) => void;
  developmentDiagnostics?: boolean; onDiagnostic?: (diagnostic: AudioFailureDiagnostic) => void;
  readClock?: () => number; newClockId?: () => string;
  setDeadline?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearDeadline?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Owns transient resources. React receives throttled metadata only, never PCM or transcript bytes. */
export class BrowserAudioController {
  readonly diagnostics: AudioDiagnostics = {
    state: "IDLE", error: null, sourceRate: null, settings: {}, level: 0, noiseFloor: 0, speechOn: 0, speechOff: 0,
    vadState: "idle", frameCount: 0, paddedSamples: 0, backpressuredFrames: 0, queuedFrames: 0,
    latestStartMs: null, latestEndMs: null, timingValid: true, summary: null, callerPlaying: false, callerPlayed: false, segmentCount: 0,
    pipeline: null, failure: null,
  };
  private connection: CaptureConnection | undefined;
  private forwarder: AudioForwarder | undefined;
  private resampler: StreamingResampler | undefined;
  private assembler: PcmFrameAssembler | undefined;
  private vad: LocalVad | undefined;
  private facts: BrowserAudioFact[] = [];
  private generation = 0;
  private origin = 0;
  private lastClock = 0;
  private clockId = "";
  private lastBlock: number | undefined;
  private lastRender = -Infinity;
  private segment = 0;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private callerPlayed = false;
  private acquisitionAbort: AbortController | undefined;
  private finishing = false;
  private trace: AudioPipelineDiagnostics;
  constructor(private readonly options: AudioControllerOptions) { this.trace = this.newTrace(); }
  private newTrace(): AudioPipelineDiagnostics { return new AudioPipelineDiagnostics(this.options.developmentDiagnostics === true, this.options.onDiagnostic); }
  requirePermission(): void { if (this.diagnostics.state === "IDLE") this.state("PERMISSION_REQUIRED"); }
  private clock(): number {
    const time = (this.options.readClock ?? (() => performance.now()))() - this.origin;
    if (!Number.isFinite(time) || time < this.lastClock) throw new BrowserAudioError("TIMING_UNAVAILABLE");
    this.lastClock = time; return time;
  }
  private notify(force = false): void {
    const time = (this.options.readClock ?? (() => performance.now()))();
    if (force || time - this.lastRender >= 100) {
      this.diagnostics.pipeline = this.trace.enabled ? this.trace.snapshot() : null;
      this.lastRender = time; this.options.onChange({ ...this.diagnostics, settings: { ...this.diagnostics.settings } });
    }
  }
  private state(state: AudioCaptureState): void { this.diagnostics.state = state; this.notify(true); }
  async prepare(): Promise<void> {
    if (["REQUESTING_PERMISSION", "CALIBRATING", "LISTENING", "SPEECH_ACTIVE", "READY", "FINISHING", "STOPPING"].includes(this.diagnostics.state)) return;
    if (!this.options.eligible()) { this.fail(new BrowserAudioError("SESSION_NOT_ELIGIBLE")); return; }
    const generation = ++this.generation;
    this.trace = this.newTrace(); this.diagnostics.failure = null;
    this.diagnostics.error = null; this.diagnostics.summary = null; this.diagnostics.timingValid = true;
    this.diagnostics.frameCount = 0; this.diagnostics.paddedSamples = 0; this.diagnostics.backpressuredFrames = 0;
    this.diagnostics.latestStartMs = null; this.diagnostics.latestEndMs = null;
    this.diagnostics.sourceRate = null; this.diagnostics.settings = {}; this.diagnostics.noiseFloor = 0; this.diagnostics.vadState = "idle";
    this.diagnostics.speechOn = 0; this.diagnostics.speechOff = 0;
    this.diagnostics.callerPlayed = false; this.diagnostics.segmentCount = 0;
    this.segment = 0; this.callerPlayed = false; this.facts = []; this.lastBlock = undefined; this.lastClock = 0;
    this.finishing = false;
    this.state("REQUESTING_PERMISSION");
    try {
      this.acquisitionAbort = new AbortController();
      const connection = await this.options.acquire(this.acquisitionAbort.signal, this.trace);
      if (generation !== this.generation || !this.options.eligible()) { connection.stop(); return; }
      this.connection = connection;
      this.diagnostics.sourceRate = connection.sampleRate; this.diagnostics.settings = connection.settings;
      this.state("READY");
      this.trace.enter("LOCAL_TIMING"); this.clockId = (this.options.newClockId ?? (() => crypto.randomUUID()))();
      this.trace.enter("TRANSPORT_CREATION");
      const forwarder = this.options.forwarder((error) => { if (generation === this.generation) this.fail(error); });
      this.forwarder = forwarder;
      forwarder.setDiagnostics?.(this.trace);
      this.trace.enter("TRANSPORT_OPEN");
      await forwarder.open(this.clockId, this.options.turnNumber);
      if (generation !== this.generation) { connection.stop(); forwarder.cancel(); return; }
      if (!this.options.eligible()) { this.fail(new BrowserAudioError("SESSION_NOT_ELIGIBLE")); return; }
      this.trace.mark("TRANSPORT_READY");
      this.origin = (this.options.readClock ?? (() => performance.now()))(); this.lastClock = 0;
      this.trace.enter("RESAMPLER_INITIALIZATION");
      this.resampler = new StreamingResampler(connection.sampleRate);
      this.trace.enter("VAD_INITIALIZATION");
      this.vad = new LocalVad();
      this.trace.enter("PCM_FRAME_AGGREGATION");
      this.assembler = new PcmFrameAssembler((bytes, paddedSamples) => {
        this.trace.mark("FIRST_PCM_FRAME"); this.trace.enter("PCM_FRAME_PRODUCTION");
        const metadata: PcmFrameMetadata = { sessionId: this.options.sessionId, turnNumber: this.options.turnNumber, audioClockId: this.clockId,
          sequence: this.diagnostics.frameCount, producedAtMonotonicMs: this.clock(), sampleRateHz: 16000, channels: 1,
          encoding: "PCM_S16LE", byteLength: 1024, paddedSamples };
        this.trace.enter("TRANSPORT_FRAME");
        this.forwarder!.frame(bytes, metadata); this.diagnostics.frameCount++; this.diagnostics.paddedSamples += paddedSamples;
      });
      this.state("CALIBRATING");
      this.deadline = (this.options.setDeadline ?? setTimeout)(() => { void this.finish(); }, 55_000);
      this.trace.enter("AUDIO_CONTEXT_RESUME");
      await connection.start((samples) => { if (generation === this.generation) this.process(samples); }, (error) => { if (generation === this.generation) this.fail(error); });
      if (generation !== this.generation) return;
    } catch (cause) {
      if (generation === this.generation) this.fail(audioFailure(cause, "PCM_PIPELINE_FAILED", this.trace.stage));
    }
  }
  private process(samples: Float32Array): void {
    try {
      if (!this.options.eligible()) throw new BrowserAudioError("SESSION_NOT_ELIGIBLE");
      this.trace.enter("LOCAL_TIMING");
      const now = this.clock();
      if (this.lastBlock !== undefined && now - this.lastBlock > 250) throw new BrowserAudioError("TIMING_UNAVAILABLE");
      this.lastBlock = now;
      const level = rms(samples); this.diagnostics.level = level;
      const wasCalibrating = this.vad!.state === "calibrating";
      this.trace.enter("VAD_PROCESSING");
      const boundaries = this.vad!.process(level, samples.length / this.connection!.sampleRate * 1000, now);
      this.trace.mark("VAD_ACTIVE");
      this.diagnostics.noiseFloor = this.vad!.noiseFloor; this.diagnostics.speechOn = this.vad!.speechOn;
      this.diagnostics.speechOff = this.vad!.speechOff; this.diagnostics.vadState = this.vad!.state;
      if (wasCalibrating && this.vad!.state !== "calibrating" && !this.finishing) this.state("LISTENING");
      for (const boundary of boundaries) {
        if (boundary.kind === "start") { this.segment++; this.diagnostics.segmentCount = this.segment; this.diagnostics.latestEndMs = null; this.diagnostics.latestStartMs = boundary.monotonicMs; this.fact("LEARNER_SPEECH_START", boundary.monotonicMs, this.segment); if (!this.finishing) this.state("SPEECH_ACTIVE"); }
        else { this.diagnostics.latestEndMs = boundary.monotonicMs; this.fact("LEARNER_SPEECH_END", boundary.monotonicMs, this.segment); if (!this.finishing) this.state("LISTENING"); }
      }
      if (!wasCalibrating) {
        this.trace.enter("RESAMPLING"); const resampled = this.resampler!.push(samples);
        if (resampled.length) this.trace.mark("RESAMPLER_ACTIVE");
        this.trace.enter("PCM_FRAME_AGGREGATION"); this.assembler!.push(resampled);
      }
      this.diagnostics.queuedFrames = this.forwarder!.queuedFrames; this.notify();
    } catch (cause) { this.fail(audioFailure(cause, "PCM_PIPELINE_FAILED", this.trace.stage)); }
    finally { samples.fill(0); }
  }
  private fact(kind: BrowserAudioFact["kind"], monotonicMs: number, segmentNumber?: number): void {
    if (this.facts.length >= 128) throw new BrowserAudioError("PCM_PIPELINE_FAILED");
    this.facts.push({ sessionId: this.options.sessionId, turnNumber: this.options.turnNumber, kind,
      at: { monotonicMs, audioClockId: this.clockId, source: kind.startsWith("CALLER") ? "CLIENT_AUDIO_CLOCK" : "LOCAL_VAD", precision: "instant" },
      availability: "available", ...(segmentNumber === undefined ? {} : { segmentNumber }) });
  }
  playMockCaller(): void {
    if (!this.connection || this.callerPlayed || this.diagnostics.state !== "LISTENING") return;
    try {
      this.callerPlayed = true;
      this.diagnostics.callerPlayed = true;
      const generation = this.generation;
      const record = (kind: "CALLER_AUDIO_START" | "CALLER_AUDIO_END") => {
        if (generation !== this.generation) return;
        try { this.fact(kind, this.clock()); this.diagnostics.callerPlaying = kind === "CALLER_AUDIO_START"; this.notify(true); }
        catch (cause) { this.fail(audioFailure(cause, "TIMING_UNAVAILABLE", "LOCAL_TIMING")); }
      };
      this.connection.playMockCaller(() => record("CALLER_AUDIO_START"), () => record("CALLER_AUDIO_END"));
    } catch (cause) { this.fail(audioFailure(cause, "PCM_PIPELINE_FAILED", "CALLER_PLAYBACK")); }
  }
  private release(): void {
    this.acquisitionAbort?.abort(); this.acquisitionAbort = undefined;
    if (this.deadline !== undefined) (this.options.clearDeadline ?? clearTimeout)(this.deadline);
    this.deadline = undefined; this.connection?.stop(); this.connection = undefined;
    this.resampler?.clear(); this.assembler?.clear(); this.vad?.clear();
    this.resampler = undefined; this.assembler = undefined; this.vad = undefined;
    this.diagnostics.level = 0; this.diagnostics.callerPlaying = false; this.diagnostics.queuedFrames = 0;
  }
  /** Hard stop releases the mic synchronously, without waiting for backend/provider completion. */
  stop(): void {
    // Completion already released every live resource. Repeated cleanup must preserve its result/status.
    if (this.diagnostics.state === "COMPLETED") return;
    ++this.generation;
    this.finishing = false;
    if (this.diagnostics.state !== "STOPPED") this.state("STOPPING");
    this.release(); this.forwarder?.cancel(); this.forwarder = undefined; this.facts = [];
    this.state("STOPPED");
  }
  async finish(): Promise<void> {
    if (this.finishing || this.diagnostics.state === "COMPLETED") return;
    if (!["LISTENING", "SPEECH_ACTIVE"].includes(this.diagnostics.state)) { this.stop(); return; }
    const forwarder = this.forwarder!;
    this.finishing = true;
    this.state("FINISHING");
    let generation = this.generation;
    try {
      this.trace.enter("CAPTURE_FLUSH");
      await this.connection!.flush();
      if (generation !== this.generation) return;
      if (this.diagnostics.callerPlaying) this.diagnostics.timingValid = false;
      // An unfinished speech segment stays without an end; stopping is not proof of speech end.
      this.trace.enter("RESAMPLING"); const tail = this.resampler!.finish();
      this.trace.enter("PCM_FRAME_AGGREGATION"); this.assembler!.push(tail); this.assembler!.finish();
      const facts: BrowserAudioTimingFacts = { sessionId: this.options.sessionId, turnNumber: this.options.turnNumber,
        audioClockId: this.clockId, timingValid: this.diagnostics.timingValid, events: this.facts };
      generation = ++this.generation; this.release(); this.facts = []; this.notify(true);
      this.trace.enter("TRANSPORT_FINISH"); const summary = await forwarder.finish(facts);
      if (generation !== this.generation) return;
      const completed = { ...summary, observations: summary.observations.map((observation) => Object.freeze({ ...observation })) };
      Object.freeze(completed.observations);
      this.forwarder = undefined; this.finishing = false;
      this.diagnostics.summary = Object.freeze(completed); this.state("COMPLETED");
    } catch (cause) {
      if (generation === this.generation) this.fail(audioFailure(cause, "PCM_PIPELINE_FAILED", this.trace.stage));
    }
  }
  private fail(error: BrowserAudioError): void {
    this.diagnostics.summary = null;
    this.diagnostics.failure = this.trace.failure(error.code, error.detail ?? { stage: this.trace.stage, ...sanitizeAudioException(error) });
    this.diagnostics.timingValid = false;
    if (error.code === "BACKPRESSURE") this.diagnostics.backpressuredFrames++;
    this.stop(); this.diagnostics.error = error;
    this.state(error.code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : error.code === "NO_INPUT_DEVICE" ? "DEVICE_UNAVAILABLE" : "ERROR");
  }
}
