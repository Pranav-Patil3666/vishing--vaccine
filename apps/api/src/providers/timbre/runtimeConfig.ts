export const TIMBRE_PROFILE = {
  provider: "gnani-timbre", model: "timbre-v2.5", voice: "Nalini", language: "hi-IN", speed: 1,
  audioConfig: { sample_rate: 48000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" },
} as const;
export const TIMBRE_ENDPOINT = "https://api.vachana.ai/api/v1/tts/inference";
export function readTimbreRuntimeConfig(environment: Record<string, string | undefined>): { apiKey: string; usedUnits: number } | undefined {
  const cost = Number(environment.TTS_COST_UNITS), usedUnits = Number(environment.TIMBRE_USED_UNITS ?? 0);
  if (environment.TIMBRE_RUNTIME_ENABLED !== "true" || !environment.GNANI_API_KEY?.trim()
    || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(usedUnits) || usedUnits < 0) return undefined;
  return { apiKey: environment.GNANI_API_KEY.trim(), usedUnits };
}
