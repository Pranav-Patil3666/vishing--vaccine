import { createHash } from "node:crypto";

export interface CacheKeyInput {
  responseId: string;
  text: string;
  language: string;
  voice: string;
  configurationVersion?: string;
  provider?: string;
  model?: string;
  audioConfig?: Readonly<Record<string, string | number>>;
}

export function createTtsCacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify({
    text: input.text.normalize("NFKC"),
    language: input.language,
    voice: input.voice,
    configurationVersion: input.configurationVersion ?? "",
    provider: input.provider ?? "mock",
    model: input.model ?? "mock",
    audioConfig: Object.fromEntries(Object.entries(input.audioConfig ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  });
  return `tts-${createHash("sha256").update(canonical).digest("hex")}`;
}
