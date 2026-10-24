import type { BrowserAudioErrorCode, TechnicalFailure } from "@vaccine/contracts";
import { sanitizeAudioException, type AudioExceptionDetail, type AudioFailureStage } from "./diagnostics.js";
const messages: Record<BrowserAudioErrorCode, string> = {
  CREDIT_LIMIT_REACHED: "The configured local credit allocation is exhausted. Capture stopped without another provider attempt.",
  PERMISSION_DENIED: "Microphone permission was denied. Allow microphone access in browser settings, then retry.",
  NO_INPUT_DEVICE: "No available microphone was found. Connect an input device, then retry.",
  UNSUPPORTED_BROWSER: "Microphone diagnostics require a secure page with Web Audio and AudioWorklet support.",
  AUDIO_CONTEXT_FAILED: "The browser audio context could not run. Prepare the microphone again.",
  WORKLET_LOAD_FAILED: "The audio processor could not be loaded. Reload the page and retry.",
  TRACK_ENDED: "Microphone access ended. Check the device and prepare it again.",
  PCM_PIPELINE_FAILED: "Audio processing or forwarding failed. The microphone has been stopped.",
  BACKPRESSURE: "Audio forwarding could not keep up. Capture stopped instead of accumulating delayed audio.",
  SESSION_NOT_ELIGIBLE: "A current consented development session is required before microphone capture.",
  TIMING_UNAVAILABLE: "The page or audio context was suspended. Timing is unavailable; prepare the microphone again.",
  CALLER_AUDIO_FAILED: "Caller audio could not load, decode or play. Capture stopped; no normal playback end was recorded.",
};
export class BrowserAudioError extends Error {
  readonly detail?: AudioExceptionDetail;
  constructor(readonly code: BrowserAudioErrorCode, cause?: unknown, stage?: AudioFailureStage, readonly technical?: TechnicalFailure) {
    super(messages[code]); this.name = "BrowserAudioError";
    // Never attach a raw cause/stack/payload to the Error passed to React.
    if (stage) this.detail = { stage, ...sanitizeAudioException(cause) };
  }
}

export function audioFailure(cause: unknown, fallback: BrowserAudioErrorCode, stage: AudioFailureStage): BrowserAudioError {
  if (cause instanceof BrowserAudioError && cause.detail) return cause;
  return new BrowserAudioError(cause instanceof BrowserAudioError ? cause.code : fallback, cause, stage, cause instanceof BrowserAudioError ? cause.technical : undefined);
}
