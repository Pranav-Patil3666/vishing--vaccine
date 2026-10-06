import type { AudioResult, SpeechSynthesizer, SpeechSynthesisRequest } from "@vaccine/contracts";

export class MockTimbreSynthesizer implements SpeechSynthesizer {
  async synthesize(_request: SpeechSynthesisRequest): Promise<AudioResult> {
    return {
      bytes: new Uint8Array(),
      mediaType: "application/x-vaccine-mock-audio",
      cache: { key: "mock-audio-not-playable", hit: false },
    };
  }
}
