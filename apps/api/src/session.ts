import type { ConsentState, SessionLifecycleState, SessionState } from "@vaccine/contracts";

export interface NewSessionInput {
  sessionId: string;
  scenarioId: string;
  scenarioVersion: string;
  language: string;
  startingNodeId: string;
  consentVersion?: string;
  mode?: "safe" | "demo";
  maxPressureLevel?: number;
  maxTurns?: number;
}

export function createSessionState(input: NewSessionInput): SessionState {
  return {
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    language: input.language,
    currentNodeId: input.startingNodeId,
    turnNumber: 0,
    state: "CONSENT_REQUIRED",
    consentRequired: true,
    recordingEnabled: false,
    consentVersion: input.consentVersion ?? "training-consent-v1",
    consent: { status: "not-requested", purpose: "microphone-transcription" },
    observedEvents: [],
    currentTacticId: null,
    currentPressureLevel: 0,
    previousTacticIds: [],
    maxPressureLevel: input.maxPressureLevel ?? 5,
    maxTurns: input.maxTurns ?? 12,
    safeWordState: "armed",
    behaviorHistory: [],
    baselineSpeechRateWpm: null,
    baselineSpeechRateSampleCount: 0,
    timelineEvents: [],
    terminalState: null,
    mode: input.mode ?? "demo",
    cache: { hits: 0, misses: 0 },
    metrics: [],
  };
}

export function transitionConsent(state: SessionState, status: ConsentState["status"], changedAt: Date): SessionState {
  const allowed: Record<ConsentState["status"], readonly ConsentState["status"][]> = {
    "not-requested": ["granted", "denied"],
    granted: ["withdrawn"],
    denied: ["not-requested"],
    withdrawn: ["not-requested"],
  };
  if (!allowed[state.consent.status].includes(status)) {
    throw new Error(`Consent transition ${state.consent.status} → ${status} is not allowed.`);
  }
  const granted = status === "granted";
  return {
    ...state,
    state: granted ? "READY" : state.state,
    recordingEnabled: granted && !isTerminal(state.state),
    consent: {
      status,
      purpose: "microphone-transcription",
      updatedAt: changedAt.toISOString(),
      version: state.consentVersion,
    },
  };
}

const transitions: Readonly<Record<SessionLifecycleState, readonly SessionLifecycleState[]>> = {
  CREATED: ["CONSENT_REQUIRED", "ENDED_BY_LEARNER"],
  CONSENT_REQUIRED: ["READY", "ENDED_BY_LEARNER"],
  READY: ["CALLER_SPEAKING", "ENDED_BY_LEARNER"],
  CALLER_SPEAKING: ["LISTENING", "ENDED_BY_LEARNER", "ERROR"],
  LISTENING: ["TRANSCRIBING", "ENDED_BY_LEARNER", "ERROR"],
  TRANSCRIBING: ["ROUTING", "FALLBACK", "ERROR", "ENDED_BY_LEARNER"],
  ROUTING: ["GENERATING_RESPONSE", "FALLBACK", "ERROR", "ENDED_BY_LEARNER"],
  GENERATING_RESPONSE: ["PLAYING_RESPONSE", "FALLBACK", "ERROR", "ENDED_BY_LEARNER"],
  PLAYING_RESPONSE: ["LISTENING", "COMPLETED", "ENDED_BY_LEARNER", "FALLBACK", "ERROR"],
  COMPLETED: [],
  ENDED_BY_LEARNER: [],
  FALLBACK: ["LISTENING", "TRANSCRIBING", "ENDED_BY_LEARNER", "ERROR"],
  ERROR: ["READY", "LISTENING", "ENDED_BY_LEARNER"],
};

export function transitionSession(state: SessionState, next: SessionLifecycleState): SessionState {
  if (!transitions[state.state].includes(next)) {
    throw new Error(`Session transition ${state.state} → ${next} is not allowed.`);
  }
  if (next === "READY" && state.consent.status !== "granted") {
    throw new Error("Explicit consent is required before the session can become ready.");
  }
  return { ...state, state: next, recordingEnabled: state.consent.status === "granted" && !isTerminal(next) };
}

export function restoreSessionState(snapshot: SessionState): SessionState {
  // Replayed state must re-enter consent; stale serialized consent cannot turn recording on.
  return {
    ...snapshot,
    state: "CONSENT_REQUIRED",
    recordingEnabled: false,
    consent: { status: "not-requested", purpose: "microphone-transcription" },
  };
}

export function endSession(state: SessionState, endedAt: Date): SessionState {
  if (state.state === "COMPLETED" || state.state === "ENDED_BY_LEARNER") return state;
  return {
    ...state,
    state: "ENDED_BY_LEARNER",
    recordingEnabled: false,
    consent: { ...state.consent, status: "withdrawn", updatedAt: endedAt.toISOString() },
    terminalState: "LEARNER_ENDED",
  };
}

function isTerminal(state: SessionLifecycleState): boolean {
  return state === "COMPLETED" || state === "ENDED_BY_LEARNER";
}
