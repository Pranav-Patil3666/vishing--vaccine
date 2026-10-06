import type { SpeechRecognitionRequest, SpeechRecognizer, TranscriptEvent } from "@vaccine/contracts";

export class MockPrismaRecognizer implements SpeechRecognizer {
  constructor(private readonly transcripts: ReadonlyMap<string, string> = new Map()) {}

  async transcribe(request: SpeechRecognitionRequest): Promise<TranscriptEvent> {
    const key = `${request.sessionId}:${request.turnNumber}`;
    const mockText = request.input.mediaType === "text/mock"
      ? new TextDecoder().decode(request.input.bytes)
      : this.transcripts.get(key) ?? "";
    return {
      eventId: `mock-transcript-${request.sessionId}-${request.turnNumber}`,
      sessionId: request.sessionId,
      turnNumber: request.turnNumber,
      text: mockText,
      language: request.language,
      normalizationStatus: "unchanged",
    };
  }
}
