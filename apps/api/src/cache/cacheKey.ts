import { createHash } from "node:crypto";

export interface CacheKeyInput {
  responseId: string;
  text: string;
  language: string;
  voice: string;
  configurationVersion?: string;
}

export function createTtsCacheKey(input: CacheKeyInput): string {
  const canonical = JSON.stringify({
    responseId: input.responseId,
    text: input.text.normalize("NFKC"),
    language: input.language,
    voice: input.voice,
    configurationVersion: input.configurationVersion ?? "",
  });
  return `tts-${createHash("sha256").update(canonical).digest("hex")}`;
}
