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
}

export interface SpeechSynthesizer {
  synthesize(request: SpeechSynthesisRequest): Promise<AudioResult>;
}

export interface Reasoner {
  generateScenario(brief: ScenarioBrief): Promise<DraftTree>;
}
