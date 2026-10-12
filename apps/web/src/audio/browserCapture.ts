import { audioFailure, BrowserAudioError } from "./errors.js";
import type { AudioFailureStage, AudioPipelineDiagnostics } from "./diagnostics.js";

export const REQUESTED_AUDIO_CONSTRAINTS = {
  channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
} as const;
export interface AppliedAudioSettings {
  sampleRate?: number; channelCount?: number; echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean;
}
export interface CaptureConnection {
  sampleRate: number; settings: AppliedAudioSettings;
  start(onSamples: (samples: Float32Array) => void, onError: (error: BrowserAudioError) => void): Promise<void>;
  playMockCaller(onStart: () => void, onEnd: () => void): void;
  flush(): Promise<void>;
  stop(): void;
}

export async function acquireBrowserMicrophone(signal: AbortSignal, trace?: AudioPipelineDiagnostics): Promise<CaptureConnection> {
  let stage: AudioFailureStage = "MIC_REQUEST";
  const enter = (next: AudioFailureStage) => { stage = next; trace?.enter(next); };
  enter("MIC_REQUEST");
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new BrowserAudioError("UNSUPPORTED_BROWSER");
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: REQUESTED_AUDIO_CONSTRAINTS, video: false }); }
  catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    throw new BrowserAudioError(name === "NotAllowedError" || name === "SecurityError" ? "PERMISSION_DENIED"
      : name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" ? "NO_INPUT_DEVICE" : "PCM_PIPELINE_FAILED", cause, stage);
  }
  trace?.mark("MIC_ACQUIRED");
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  let caller: AudioBufferSourceNode | undefined;
  let active = false;
  let stopped = false;
  let resolveFlush: (() => void) | undefined;
  const disposers: Array<() => void> = [];
  const stop = () => {
    if (stopped) return;
    stopped = true; active = false;
    resolveFlush?.(); resolveFlush = undefined;
    for (const dispose of disposers) dispose();
    if (caller) { caller.onended = null; try { caller.stop(); } catch { /* Already ended. */ } caller.disconnect(); caller = undefined; }
    if (worklet) { worklet.port.onmessage = null; worklet.port.postMessage("stop"); worklet.port.close(); worklet.disconnect(); }
    source?.disconnect(); mute?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  disposers.push(() => signal.removeEventListener("abort", stop));
  try {
    if (signal.aborted) { stop(); throw new BrowserAudioError("SESSION_NOT_ELIGIBLE"); }
    enter("AUDIO_CONTEXT_CREATION"); context = new AudioContext();
    trace?.context(context.state, context.sampleRate); trace?.mark("AUDIO_CONTEXT_CREATED");
    if (!context.audioWorklet) throw new BrowserAudioError("UNSUPPORTED_BROWSER");
    enter("WORKLET_MODULE_LOAD");
    try { await context.audioWorklet.addModule(new URL("./capture.worklet.js", import.meta.url).href); }
    catch (cause) { throw audioFailure(cause, "WORKLET_LOAD_FAILED", stage); }
    trace?.mark("WORKLET_MODULE_LOADED");
    if (stopped) throw new BrowserAudioError("SESSION_NOT_ELIGIBLE");
    enter("SOURCE_NODE_CREATION"); source = context.createMediaStreamSource(stream); trace?.mark("SOURCE_NODE_CREATED");
    enter("WORKLET_NODE_CREATION");
    worklet = new AudioWorkletNode(context, "local-audio-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { diagnostics: trace?.enabled === true } });
    trace?.mark("WORKLET_NODE_CREATED");
    enter("SILENT_SINK_CREATION");
    mute = context.createGain(); mute.gain.value = 0;
    enter("TRACK_SETTINGS");
    const reported = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
    const settings: AppliedAudioSettings = {};
    for (const key of ["sampleRate", "channelCount"] as const) if (typeof reported[key] === "number") settings[key] = reported[key];
    for (const key of ["echoCancellation", "noiseSuppression", "autoGainControl"] as const) if (typeof reported[key] === "boolean") settings[key] = reported[key];
    const audioContext = context, input = source, processor = worklet, silentOutput = mute;
    return {
      sampleRate: audioContext.sampleRate, settings,
      async start(onSamples, onError) {
        enter("CAPTURE_START");
        try {
        const fatal = (error: BrowserAudioError) => {
          trace?.context(audioContext.state, audioContext.sampleRate);
          if (active) onError(error.detail ? error : audioFailure(error, error.code, stage));
        };
        processor.port.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (!active) return;
          trace?.workletMessage();
          enter("WORKLET_MESSAGE");
          if (!data || typeof data !== "object") { fatal(audioFailure(new TypeError("Invalid worklet message: expected an object."), "PCM_PIPELINE_FAILED", stage)); return; }
          const message = data as { samples?: unknown; error?: unknown; flushed?: unknown; type?: unknown };
          if (message.type === "PROCESSOR_ACTIVE" && trace?.enabled) { trace.mark("PROCESSOR_ACTIVE"); return; }
          if (message.error === "BACKPRESSURE") { fatal(audioFailure(new BrowserAudioError("BACKPRESSURE"), "BACKPRESSURE", "PROCESSOR_CALLBACK")); return; }
          if (!(message.samples instanceof Float32Array) || (message.flushed === true
            ? message.samples.length >= Math.round(audioContext.sampleRate * 0.02)
            : message.samples.length !== Math.round(audioContext.sampleRate * 0.02))) { fatal(audioFailure(new TypeError("Invalid worklet message: expected a native-rate Float32Array block."), "PCM_PIPELINE_FAILED", stage)); return; }
          if (message.samples.length) trace?.mark("FIRST_AUDIO_BLOCK_RECEIVED");
          try { if (message.samples.length) onSamples(message.samples); }
          catch (cause) { fatal(audioFailure(cause, "PCM_PIPELINE_FAILED", stage)); }
          finally {
            message.samples.fill(0);
            if (message.flushed === true) { resolveFlush?.(); resolveFlush = undefined; }
            else if (active) {
              try { processor.port.postMessage("ack"); }
              catch (cause) { fatal(audioFailure(cause, "PCM_PIPELINE_FAILED", "WORKLET_MESSAGE")); }
            }
          }
        };
        const onProcessorError = (event: Event) => fatal(audioFailure(event instanceof ErrorEvent && event.error instanceof Error
          ? event.error : new Error(event instanceof ErrorEvent && event.message ? event.message : "AudioWorklet processorerror event (browser supplied no exception detail)."), "PCM_PIPELINE_FAILED", "PROCESSOR_CALLBACK"));
        const onTrackEnded = () => fatal(audioFailure(new BrowserAudioError("TRACK_ENDED"), "TRACK_ENDED", "TRACK_LIFECYCLE"));
        const onVisibility = () => { if (document.hidden) fatal(audioFailure(new BrowserAudioError("TIMING_UNAVAILABLE"), "TIMING_UNAVAILABLE", "PAGE_VISIBILITY")); };
        const onContext = () => { trace?.context(audioContext.state, audioContext.sampleRate); if (audioContext.state !== "running") fatal(audioFailure(new BrowserAudioError("TIMING_UNAVAILABLE"), "TIMING_UNAVAILABLE", "AUDIO_CONTEXT_RESUME")); };
        processor.addEventListener("processorerror", onProcessorError);
        document.addEventListener("visibilitychange", onVisibility);
        for (const track of stream.getAudioTracks()) track.addEventListener("ended", onTrackEnded);
        disposers.push(() => processor.removeEventListener("processorerror", onProcessorError), () => document.removeEventListener("visibilitychange", onVisibility),
          ...stream.getAudioTracks().map((track) => () => track.removeEventListener("ended", onTrackEnded)), () => audioContext.removeEventListener("statechange", onContext));
        if (stream.getAudioTracks().some((track) => track.readyState === "ended")) throw new BrowserAudioError("TRACK_ENDED");
        enter("AUDIO_CONTEXT_RESUME");
        try { await audioContext.resume(); } catch (cause) { throw audioFailure(cause, "AUDIO_CONTEXT_FAILED", stage); }
        trace?.context(audioContext.state, audioContext.sampleRate);
        if (stopped || document.hidden || audioContext.state !== "running") throw new BrowserAudioError("TIMING_UNAVAILABLE");
        active = true;
        audioContext.addEventListener("statechange", onContext);
        enter("AUDIO_GRAPH_CONNECTION");
        try { input.connect(processor); processor.connect(silentOutput); silentOutput.connect(audioContext.destination); }
        catch (cause) { throw audioFailure(cause, "AUDIO_CONTEXT_FAILED", stage); }
        trace?.mark("AUDIO_GRAPH_CONNECTED");
        } catch (cause) {
          trace?.context(audioContext.state, audioContext.sampleRate);
          throw audioFailure(cause, "AUDIO_CONTEXT_FAILED", stage);
        }
      },
      playMockCaller(onStart, onEnd) {
        enter("CALLER_PLAYBACK");
        if (!active || caller || audioContext.state !== "running") throw new BrowserAudioError("AUDIO_CONTEXT_FAILED");
        // Nonlinguistic local cue only. Draft scripts and non-playable provider responses stay untouched.
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 3, audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / audioContext.sampleRate) * 0.08;
        const playback = audioContext.createBufferSource(); caller = playback; playback.buffer = buffer;
        playback.connect(audioContext.destination);
        playback.onended = () => { playback.disconnect(); caller = undefined; if (active) onEnd(); };
        onStart(); playback.start();
      },
      flush() {
        enter("CAPTURE_FLUSH");
        if (!active) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { resolveFlush = undefined; reject(new BrowserAudioError("TIMING_UNAVAILABLE")); }, 100);
          resolveFlush = () => { clearTimeout(timer); resolve(); };
          processor.port.postMessage("flush");
        });
      },
      stop,
    };
  } catch (cause) {
    if (context) trace?.context(context.state, context.sampleRate);
    stop(); throw audioFailure(cause, "AUDIO_CONTEXT_FAILED", stage);
  }
}
