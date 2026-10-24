import type {
  AudioResult,
  DraftTree,
  ScenarioBrief,
  SpeechRecognitionRequest,
  SpeechSynthesisRequest,
  TranscriptEvent,
} from "./domain.js";
import type { ApprovedCallerResponse, ApprovedCallerResponseReference } from "./pressure.js";

export interface ApprovedResponseResolver {
  resolve(reference: ApprovedCallerResponseReference): ApprovedCallerResponse | undefined;
}

export interface SpeechRecognizer {
  transcribe(request: SpeechRecognitionRequest): Promise<TranscriptEvent>;
  openStream?(request: StreamingRecognitionRequest): StreamingRecognitionSession;
}

export interface StreamingRecognitionRequest {
  sessionId: string;
  turnNumber: number;
  language: string;
}
export interface StreamingRecognitionSession {
  /** Ready means the provider accepted the configuration, not merely an open socket. */
  readonly ready: Promise<void>;
  sendFrame(frame: Uint8Array): Promise<void>;
  finish(): Promise<TranscriptEvent>;
  cancel(): void;
}

export interface SpeechSynthesizer {
  /** Implementers reporting this boundary invoke beforeRequest after local validation, immediately before transport. */
  readonly reportsProviderRequestBoundary?: boolean;
  synthesize(request: SpeechSynthesisRequest, options?: { signal?: AbortSignal; beforeRequest?: () => void }): Promise<AudioResult>;
}

export interface Reasoner {
  generateScenario(brief: ScenarioBrief): Promise<DraftTree>;
}
