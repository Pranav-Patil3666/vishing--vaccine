import type { AudioResult, SpeechSynthesisRequest, SpeechSynthesizer } from "@vaccine/contracts";
import type { ApprovedCallerCatalog } from "../../callerAudio/catalog.js";
import { finalizeCallerWav, inspectCallerWav } from "../../callerAudio/wav.js";
import { ApplicationError } from "../../errors.js";
import { TIMBRE_ENDPOINT, TIMBRE_PROFILE } from "./runtimeConfig.js";

/** Participant-verified binary REST WAV transport. No public text input, redirects, logs or retries. */
export class TimbreSpeechSynthesizer implements SpeechSynthesizer {
  readonly reportsProviderRequestBoundary = true;
  constructor(private readonly catalog: ApprovedCallerCatalog, private readonly configuration: { apiKey: string },
    private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 30_000) {}
  async synthesize(reference: SpeechSynthesisRequest, options?: { signal?: AbortSignal; beforeRequest?: () => void }): Promise<AudioResult> {
    const approved = this.catalog.resolve(reference);
    if (!this.configuration.apiKey) throw new ApplicationError("TTS_UNAVAILABLE", "Timbre is not configured.");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      signal.throwIfAborted();
      options?.beforeRequest?.();
      const response = await this.fetcher(TIMBRE_ENDPOINT, { method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json", "X-API-Key-ID": this.configuration.apiKey },
        body: JSON.stringify({ text: approved.text.normalize("NFKC"), model: TIMBRE_PROFILE.model, voice: TIMBRE_PROFILE.voice,
          language: TIMBRE_PROFILE.language, speed: TIMBRE_PROFILE.speed, audio_config: TIMBRE_PROFILE.audioConfig }) });
      if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "audio/wav" || !response.body) {
        await response.body?.cancel(); throw new ApplicationError("TTS_PROVIDER_FAILED", "Timbre did not return supported caller audio.");
      }
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > 8 * 1024 * 1024) throw new Error("Caller audio exceeds limit."); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      signal.throwIfAborted();
      const bytes = finalizeCallerWav(Buffer.concat(chunks));
      return { bytes: Uint8Array.from(bytes), mediaType: "audio/wav", durationMs: inspectCallerWav(bytes).durationMs };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(options?.signal?.aborted ? "TTS_CANCELLED" : timeout.aborted ? "TTS_TIMEOUT" : "TTS_PROVIDER_FAILED", "Caller speech synthesis could not complete. No automatic retry.");
    }
  }
}
