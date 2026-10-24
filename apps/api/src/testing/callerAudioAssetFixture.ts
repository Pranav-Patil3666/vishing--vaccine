import type { CallerAudioAsset } from "@vaccine/contracts";
export function callerAudioAssetFixture(sessionId = "session", turnNumber = 0, responseId = "system.opening"): CallerAudioAsset {
  return { sessionId, turnNumber, responseId, audioUrl: `/api/sessions/${sessionId}/caller-audio/00000000-0000-4000-8000-000000000001`,
    mediaType: "audio/wav", byteLength: 1004, durationMs: 10, cacheKey: `tts-${"a".repeat(64)}`, cacheHit: false,
    provider: "offline-fixture", model: "offline-model", voice: "offline-voice", language: "hi-IN", sampleRateHz: 48000,
    synthesisMs: 20, cacheLookupMs: 1, providerAttempts: 1 };
}
