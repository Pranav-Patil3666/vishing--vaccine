import type { TechnicalFailure } from "@vaccine/contracts";
import type { CaptureConnection } from "./browserCapture.js";
import { BrowserAudioError } from "./errors.js";
import { LocalVad } from "./vad.js";
import { rms } from "./pcm.js";

/** One granted stream; bounded learner leases. Outside calibration/learner windows samples are discarded. */
export class ReusableMicrophone {
  private samples: ((value: Float32Array) => void) | undefined;
  private started = false;
  private stopped = false;
  private calibrationCancel: (() => void) | undefined;
  private mode: "DISCARD" | "CALIBRATING" | "ARMED" | "CAPTURING" | "STOPPED" = "DISCARD";
  private turnNumber = 0;
  private lastCalibratedTurn = 0;
  private calibrationCount = 0;
  private epoch = 0;
  constructor(private readonly driver: CaptureConnection, private readonly readClock: () => number) {}
  snapshot() { return { mode: this.mode, turnNumber: this.turnNumber, calibrationCount: this.calibrationCount, health: this.driver.health?.() ?? null }; }
  private failure(causeCode: TechnicalFailure["causeCode"], stage: TechnicalFailure["stage"] = "CALIBRATION"): BrowserAudioError {
    return new BrowserAudioError(causeCode === "MEDIA_STREAM_ENDED" ? "TRACK_ENDED" : "TIMING_UNAVAILABLE", undefined, undefined,
      { stage, causeCode, providerAttempted: false });
  }
  private healthFailure(stage: TechnicalFailure["stage"]): BrowserAudioError | undefined {
    const health = this.driver.health?.();
    if (this.stopped || !this.started) return this.failure("INVALID_TURN_STATE", stage);
    if (!health) return; // Legacy test/capture drivers may not report hardware facts; the browser driver does.
    if (!health.streamActive || !health.audioTrackCount || !health.tracksLive) return this.failure("MEDIA_STREAM_ENDED", stage);
    if (!health.tracksEnabled) return this.failure("MICROPHONE_DISABLED", stage);
    if (health.audioContextState !== "running") return this.failure(health.audioContextState === "closed" ? "AUDIO_CONTEXT_CLOSED" : "AUDIO_CONTEXT_SUSPENDED", stage);
    if (health.workletState !== "running") return this.failure("WORKLET_UNAVAILABLE", stage);
  }
  async start(onError: (error: BrowserAudioError) => void): Promise<void> {
    if (this.started || this.stopped) throw this.failure("INVALID_TURN_STATE", "MICROPHONE_PREPARATION");
    this.started = true;
    await this.driver.start((samples) => {
      try { this.samples?.(samples); }
      catch { onError(new BrowserAudioError("TIMING_UNAVAILABLE")); }
      finally { samples.fill(0); }
    }, (error) => onError(this.healthFailure(this.mode === "CALIBRATING" ? "CALIBRATION" : "MICROPHONE_PREPARATION") ?? error));
    const failure = this.healthFailure("MICROPHONE_PREPARATION"); if (failure) throw failure;
  }
  calibrate(signal: AbortSignal, turnNumber: number): Promise<LocalVad> {
    const failure = this.healthFailure("CALIBRATION"); if (failure) return Promise.reject(failure);
    if (this.mode !== "DISCARD") return Promise.reject(this.failure(this.mode === "CALIBRATING" ? "CALIBRATION_REENTRANT" : "INVALID_TURN_STATE"));
    if (signal.aborted || !Number.isInteger(turnNumber) || turnNumber !== this.lastCalibratedTurn + 1) return Promise.reject(this.failure("INVALID_TURN_STATE"));
    this.mode = "CALIBRATING"; this.turnNumber = turnNumber; this.calibrationCount++;
    const epoch = ++this.epoch;
    const vad = new LocalVad();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: BrowserAudioError) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal.removeEventListener("abort", cancel);
        if (epoch === this.epoch) { this.samples = undefined; this.calibrationCancel = undefined; this.mode = this.stopped ? "STOPPED" : error ? "DISCARD" : "ARMED"; }
        if (error) { vad.clear(); reject(error); } else { this.lastCalibratedTurn = turnNumber; resolve(vad); }
      };
      const cancel = () => finish(this.failure("INVALID_TURN_STATE"));
      const timer = setTimeout(() => finish(this.healthFailure("CALIBRATION") ?? this.failure("CALIBRATION_TIMEOUT")), 2500);
      this.calibrationCancel = cancel; signal.addEventListener("abort", cancel, { once: true });
      // Drain/discard queued caller/previous-turn samples before installing this new VAD window.
      void (async () => {
        await this.driver.flush({ keepAlive: true });
        if (settled || epoch !== this.epoch) return;
        const failure = this.healthFailure("CALIBRATION"); if (failure) { finish(failure); return; }
        this.samples = (samples) => {
          try { vad.process(rms(samples), samples.length / this.driver.sampleRate * 1000, this.readClock()); if (vad.state !== "calibrating") finish(); }
          catch { finish(this.failure("CALIBRATION_INVALID_INPUT")); }
        };
      })().catch(() => finish(this.healthFailure("CALIBRATION") ?? this.failure("WORKLET_UNAVAILABLE")));
    });
  }
  lease(turnNumber: number): CaptureConnection {
    const failure = this.healthFailure("CALIBRATION"); if (failure) throw failure;
    if (this.mode !== "ARMED" || turnNumber !== this.turnNumber) throw this.failure("INVALID_TURN_STATE");
    this.mode = "CAPTURING";
    const epoch = this.epoch;
    let subscriber: ((samples: Float32Array) => void) | undefined;
    const detach = () => { if (epoch === this.epoch && this.mode === "CAPTURING") { this.samples = undefined; this.mode = "DISCARD"; } subscriber = undefined; };
    return { sampleRate: this.driver.sampleRate, settings: this.driver.settings,
      start: async (onSamples) => {
        const failure = this.healthFailure("CALIBRATION"); if (failure) throw failure;
        if (epoch !== this.epoch || this.mode !== "CAPTURING" || subscriber) throw this.failure("INVALID_TURN_STATE");
        subscriber = onSamples; this.samples = subscriber;
      },
      playMockCaller: () => { throw new BrowserAudioError("CALLER_AUDIO_FAILED"); },
      flush: async () => {
        if (epoch !== this.epoch || this.mode !== "CAPTURING") throw this.failure("INVALID_TURN_STATE");
        try { await this.driver.flush({ keepAlive: true }); } finally { detach(); }
      },
      stop: detach };
  }
  stop(): void { if (this.stopped) return; this.stopped = true; this.calibrationCancel?.(); ++this.epoch; this.mode = "STOPPED"; this.samples = undefined; this.driver.stop(); }
}
