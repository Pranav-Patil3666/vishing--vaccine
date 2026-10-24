import type { ApprovedCallerResponse, SpeechSynthesizer, RuntimeCreditReservation } from "@vaccine/contracts";
import { toSpeechSynthesisRequest } from "../adaptivePolicy.js";
import { createTtsCacheKey } from "../cache/cacheKey.js";
import { ApplicationError, withTechnical } from "../errors.js";
import type { ApprovedCallerCatalog } from "./catalog.js";
import type { CallerAudioCache } from "./cache.js";
import { finalizeCallerWav, inspectCallerWav } from "./wav.js";

export interface CallerVoiceProfile { provider: string; model: string; voice: string; language: string; speed: number; audioConfig: Readonly<Record<string, string | number>>; }
export function callerAudioKey(response: ApprovedCallerResponse, profile: CallerVoiceProfile): string {
  return createTtsCacheKey({ responseId: response.responseId, text: response.text, language: profile.language, voice: profile.voice,
    provider: profile.provider, model: profile.model, configurationVersion: "rest-v1-wav-lengths-v1", audioConfig: { ...profile.audioConfig, speed: profile.speed } });
}
export interface CallerAudioValue {
  bytes: Uint8Array; mediaType: "audio/wav"; durationMs: number; byteLength: number; sampleRateHz: 48000;
  cacheKey: string; cacheHit: boolean; synthesisMs: number | null; cacheLookupMs: number; providerAttempts: number;
}
/** Cache first, one gated provider call per miss, shared in-flight work, no learner input. */
export class CallerAudioService {
  private readonly pending = new Map<string, Promise<CallerAudioValue>>();
  constructor(readonly catalog: ApprovedCallerCatalog, readonly profile: CallerVoiceProfile, readonly cache: CallerAudioCache,
    private readonly synthesizer: SpeechSynthesizer, private readonly reserve: (sessionId: string) => RuntimeCreditReservation | void) {}
  async get(scenarioId: string, version: string, responseId: string, sessionId: string, signal: AbortSignal): Promise<CallerAudioValue> {
    let approved: ApprovedCallerResponse;
    try { approved = this.catalog.resolveId(scenarioId, version, responseId); }
    catch (error) { throw withTechnical(error, "CALLER_AUDIO_RESOLUTION", false); }
    const key = callerAudioKey(approved, this.profile);
    signal.throwIfAborted(); const started = performance.now();
    let cached: Uint8Array | undefined;
    try { cached = await this.cache.get(key); }
    catch { throw withTechnical(new ApplicationError("TTS_PROVIDER_FAILED", "Caller cache lookup failed."), "TTS_CACHE", false); }
    signal.throwIfAborted(); const cacheLookupMs = performance.now() - started;
    if (cached) {
      try { return this.value(cached, key, true, null, cacheLookupMs); }
      catch { throw withTechnical(new ApplicationError("TTS_PROVIDER_FAILED", "Cached caller audio is invalid."), "TTS_CACHE", false, "HIT"); }
    }
    const existing = this.pending.get(key); if (existing) return existing;
    const work = Promise.resolve().then(async () => {
      let attempted = false;
      const beforeRequest = () => {
        signal.throwIfAborted(); if (attempted) return;
        try { const reservation = this.reserve(sessionId); reservation?.attempted(); attempted = true; }
        catch (error) { throw withTechnical(error, "TTS_CREDIT_GUARD", false, "MISS"); }
      };
      signal.throwIfAborted(); const start = performance.now();
      let bytes: Uint8Array;
      try {
        if (!this.synthesizer.reportsProviderRequestBoundary) beforeRequest();
        const audio = await this.synthesizer.synthesize(toSpeechSynthesisRequest(approved), { signal, beforeRequest });
        signal.throwIfAborted();
        if (!attempted) throw new ApplicationError("TTS_PROVIDER_FAILED", "Caller provider did not report its request boundary.");
        if (audio.mediaType !== "audio/wav") throw new ApplicationError("TTS_PROVIDER_FAILED", "Unsupported caller media type.");
        bytes = finalizeCallerWav(audio.bytes);
      } catch (error) {
        throw withTechnical(error instanceof ApplicationError ? error : new ApplicationError(signal.aborted ? "TTS_CANCELLED" : "TTS_PROVIDER_FAILED", "Caller synthesis failed. No automatic retry."), "TTS_PROVIDER", attempted, "MISS");
      }
      const synthesisMs = performance.now() - start;
      // A failed cache write is a typed failure, not permission to synthesize again automatically.
      try { await this.cache.set(key, bytes); }
      catch { throw withTechnical(new ApplicationError("TTS_PROVIDER_FAILED", "Caller cache write failed. No automatic synthesis retry."), "TTS_CACHE", attempted, "MISS"); }
      return this.value(bytes, key, false, synthesisMs, cacheLookupMs);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work); return work;
  }
  private value(bytes: Uint8Array, key: string, hit: boolean, synthesisMs: number | null, cacheLookupMs: number): CallerAudioValue {
    const info = inspectCallerWav(bytes);
    return { bytes, mediaType: "audio/wav", durationMs: info.durationMs, byteLength: bytes.length, sampleRateHz: 48000,
      cacheKey: key, cacheHit: hit, synthesisMs, cacheLookupMs, providerAttempts: hit ? 0 : 1 };
  }
}
