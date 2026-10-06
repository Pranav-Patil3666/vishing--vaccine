import type { ConsentState, SessionState } from "@vaccine/contracts";

export interface NewSessionInput {
  sessionId: string;
  scenarioId: string;
  scenarioVersion: string;
  language: string;
  startingNodeId: string;
}

export function createSessionState(input: NewSessionInput): SessionState {
  return {
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    language: input.language,
    currentNodeId: input.startingNodeId,
    turnNumber: 0,
    consent: { status: "not-requested", purpose: "microphone-transcription" },
    observedEvents: [],
    mode: "demo",
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
  return {
    ...state,
    consent: {
      status,
      purpose: "microphone-transcription",
      updatedAt: changedAt.toISOString(),
    },
  };
}
