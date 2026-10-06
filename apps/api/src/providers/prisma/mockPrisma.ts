import type { SpeechRecognitionRequest, SpeechRecognizer, TranscriptEvent } from "@vaccine/contracts";

export class MockPrismaRecognizer implements SpeechRecognizer {
  constructor(private readonly transcripts: ReadonlyMap<string, string> = new Map()) {}

  async transcribe(request: SpeechRecognitionRequest): Promise<TranscriptEvent> {
    const key = `${request.sessionId}:${request.turnNumber}`;
    return {
      eventId: `mock-transcript-${request.turnNumber}`,
      sessionId: request.sessionId,
      turnNumber: request.turnNumber,
      text: this.transcripts.get(key) ?? "",
      language: request.language,
      normalizationStatus: "unchanged",
    };
  }
}
