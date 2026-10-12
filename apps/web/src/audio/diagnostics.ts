import type { BrowserAudioErrorCode } from "@vaccine/contracts";

export type AudioFailureStage = "MIC_REQUEST" | "AUDIO_CONTEXT_CREATION" | "WORKLET_MODULE_LOAD"
  | "SOURCE_NODE_CREATION" | "WORKLET_NODE_CREATION" | "SILENT_SINK_CREATION" | "TRACK_SETTINGS" | "CAPTURE_START"
  | "AUDIO_CONTEXT_RESUME" | "AUDIO_GRAPH_CONNECTION" | "TRACK_LIFECYCLE" | "PAGE_VISIBILITY"
  | "PROCESSOR_CALLBACK" | "WORKLET_MESSAGE" | "RESAMPLER_INITIALIZATION" | "VAD_INITIALIZATION"
  | "LOCAL_TIMING" | "VAD_PROCESSING" | "RESAMPLING" | "PCM_FRAME_AGGREGATION" | "PCM_FRAME_PRODUCTION"
  | "TRANSPORT_CREATION" | "TRANSPORT_OPEN" | "TRANSPORT_FRAME" | "TRANSPORT_FINISH" | "CALLER_PLAYBACK" | "CAPTURE_FLUSH";
export type AudioPipelineStage = "MIC_ACQUIRED" | "AUDIO_CONTEXT_CREATED" | "WORKLET_MODULE_LOADED"
  | "WORKLET_NODE_CREATED" | "SOURCE_NODE_CREATED" | "AUDIO_GRAPH_CONNECTED" | "PROCESSOR_ACTIVE"
  | "FIRST_AUDIO_BLOCK_RECEIVED" | "RESAMPLER_ACTIVE" | "VAD_ACTIVE" | "FIRST_PCM_FRAME"
  | "TRANSPORT_READY" | "FIRST_FRAME_FORWARDED";
export interface AudioExceptionDetail {
  stage: AudioFailureStage;
  exceptionName: string;
  exceptionMessage: string;
}
export interface AudioPipelineSnapshot {
  lastSuccessfulStage: AudioPipelineStage | null;
  stages: AudioPipelineStage[];
  audioContextState: AudioContextState | "unavailable";
  sourceSampleRate: number | null;
  workletModuleLoaded: boolean; workletNodeConstructed: boolean; sourceNodeConstructed: boolean;
  graphConnected: boolean; firstProcessorCallbackObserved: boolean; firstWorkletMessageReceived: boolean;
  firstResampledBlockProduced: boolean; firstVadBlockConsumed: boolean; firstPcmFrameProduced: boolean; transportOpened: boolean;
}
export interface AudioFailureDiagnostic extends AudioExceptionDetail, AudioPipelineSnapshot {
  category: "AUDIO_CAPTURE_FAILED" | "AUDIO_PROCESSING_FAILED" | "AUDIO_TRANSPORT_FAILED";
  code: BrowserAudioErrorCode;
}

/** Strict allowlist: arbitrary error text can contain credentials, device labels or payloads.
 * Keep the original technical name and known safe message; withhold all other text/stack. */
export function sanitizeAudioException(cause: unknown): Pick<AudioExceptionDetail, "exceptionName" | "exceptionMessage"> {
  let name = "Error", message = "Exception message withheld (unrecognized technical text).";
  try {
    if (cause instanceof Error) {
      if (/^(?:Error|TypeError|RangeError|SyntaxError|ZodError|BrowserAudioError|AbortError|NotAllowedError|SecurityError|NotFoundError|NotReadableError|OverconstrainedError|InvalidStateError|NotSupportedError|IndexSizeError|DataCloneError|NetworkError)$/u.test(cause.name)) name = cause.name;
      const text = cause.message;
      if (text === "Illegal invocation") return { exceptionName: name, exceptionMessage: text };
      if (/^(?:Failed to fetch|fetch failed|Load failed|Invalid audio channels\.|Unsupported sample rate\.|Invalid VAD (?:configuration|input)\.|Invalid worklet message: expected (?:an object|a native-rate Float32Array block)\.|AudioWorklet processorerror event \(browser supplied no exception detail\)\.|Audio (?:start|frame|finish) request failed \(HTTP [1-5][0-9]{2}\)\.)$/u.test(text)) message = text;
      else if (/^Cannot read properties of (?:undefined|null) \(reading '(?:sampleRate|state|push|frame|connect|port|samples|buffer|length|randomUUID)'\)$/u.test(text)) message = text;
      else if (text.startsWith("Failed to execute '")) {
        const match = /^Failed to execute '(connect|resume|postMessage|addModule|createMediaStreamSource|createGain)' on '(AudioNode|AudioContext|BaseAudioContext|MessagePort|Worklet)'/u.exec(text);
        if (match) message = `${match[0]}: browser detail withheld.`;
      }
    }
  } catch { /* Do not inspect arbitrary getters or serialize an exception object. */ }
  return { exceptionName: name, exceptionMessage: message };
}

/** One attempt, bounded first-occurrence markers, metadata only. Disabled outside development. */
export class AudioPipelineDiagnostics {
  stage: AudioFailureStage = "MIC_REQUEST";
  private stages: AudioPipelineStage[] = [];
  private contextState: AudioContextState | "unavailable" = "unavailable";
  private rate: number | null = null;
  private receivedMessage = false;
  private reported = false;
  constructor(readonly enabled: boolean, private readonly report?: (diagnostic: AudioFailureDiagnostic) => void) {}
  enter(stage: AudioFailureStage): void { if (this.enabled) this.stage = stage; }
  mark(stage: AudioPipelineStage): void { if (this.enabled && !this.stages.includes(stage)) this.stages.push(stage); }
  workletMessage(): void { if (this.enabled) this.receivedMessage = true; }
  context(state: AudioContextState, sampleRate: number): void {
    if (this.enabled) { this.contextState = state; this.rate = Number.isFinite(sampleRate) ? sampleRate : null; }
  }
  snapshot(): AudioPipelineSnapshot {
    const has = (stage: AudioPipelineStage) => this.stages.includes(stage);
    return { lastSuccessfulStage: this.stages.at(-1) ?? null, stages: [...this.stages], audioContextState: this.contextState, sourceSampleRate: this.rate,
      workletModuleLoaded: has("WORKLET_MODULE_LOADED"), workletNodeConstructed: has("WORKLET_NODE_CREATED"), sourceNodeConstructed: has("SOURCE_NODE_CREATED"),
      graphConnected: has("AUDIO_GRAPH_CONNECTED"), firstProcessorCallbackObserved: has("PROCESSOR_ACTIVE"), firstWorkletMessageReceived: this.receivedMessage,
      firstResampledBlockProduced: has("RESAMPLER_ACTIVE"), firstVadBlockConsumed: has("VAD_ACTIVE"), firstPcmFrameProduced: has("FIRST_PCM_FRAME"), transportOpened: has("TRANSPORT_READY") };
  }
  failure(code: BrowserAudioErrorCode, detail: AudioExceptionDetail): AudioFailureDiagnostic | null {
    if (!this.enabled) return null;
    const category = detail.stage.startsWith("TRANSPORT_") ? "AUDIO_TRANSPORT_FAILED"
      : ["LOCAL_TIMING", "VAD_INITIALIZATION", "VAD_PROCESSING", "RESAMPLER_INITIALIZATION", "RESAMPLING", "PCM_FRAME_AGGREGATION", "PCM_FRAME_PRODUCTION"].includes(detail.stage)
        ? "AUDIO_PROCESSING_FAILED" : "AUDIO_CAPTURE_FAILED";
    const diagnostic: AudioFailureDiagnostic = { ...this.snapshot(), ...detail, category, code };
    if (!this.reported) { this.reported = true; this.report?.(diagnostic); }
    return diagnostic;
  }
}
