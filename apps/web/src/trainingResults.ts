import type { BehaviorLabel, SafeSession, SessionTerminalState, TacticCategory } from "@vaccine/contracts";

export const sessionHistoryKey = "vv.session-history";
export const activeSessionKey = "vv.active-session-id";
export const historyLimit = 20;
const sessionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

export function parseSessionIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.flatMap((id: unknown) => typeof id === "string" && sessionIdPattern.test(id) ? [id] : []))]
    .slice(0, historyLimit);
}

export function sessionStatus(session: SafeSession): "In progress" | "Completed" | "Stopped" | "Technical stop" {
  if (session.conversation?.phase === "ERROR" || session.state === "ERROR") return "Technical stop";
  if (session.conversation?.phase === "STOPPED" || session.state === "ENDED_BY_LEARNER") return "Stopped";
  if (session.conversation?.phase === "COMPLETED" || session.state === "COMPLETED") return session.terminalState === "SAFE_WORD" ? "Stopped" : "Completed";
  return "In progress";
}

export function sessionMode(session: SafeSession) {
  return session.runtimeMode === "REAL_CONVERSATION" ? "Live voice"
    : session.runtimeMode === "REAL_STT" ? "Voice transcription practice" : "Offline demonstration";
}

export const outcomeLabels: Record<SessionTerminalState, string> = {
  SAFE_VERIFIED: "Independent verification",
  DUMMY_SECRET_DISCLOSED: "Practice token disclosed",
  SAFE_FALLBACK: "Safe fallback",
  MAX_TURNS: "Turn limit reached",
  SAFE_WORD: "Safe word used",
  LEARNER_ENDED: "Stopped by learner",
  SCENARIO_COMPLETED: "Scenario completed",
};

export function sessionOutcome(session: SafeSession) {
  if (sessionStatus(session) === "In progress") return "In progress";
  return session.terminalState ? outcomeLabels[session.terminalState] : sessionStatus(session);
}

export const behaviorFeedback: Record<BehaviorLabel, { label: string; evidence: string; coaching: "strength" | "practice" | "observation" }> = {
  REFUSED: { label: "Refused a request", evidence: "Your response expressed a refusal.", coaching: "strength" },
  STALLED: { label: "Asked for time", evidence: "Your response delayed a decision. Use that pause to check through a known channel.", coaching: "practice" },
  VERIFIED_INDEPENDENTLY: { label: "Chose independent verification", evidence: "Your response indicated independent verification. The session cannot confirm an external check.", coaching: "strength" },
  COMPLIED: { label: "Agreed to a request", evidence: "Your response expressed agreement. Pause before acting on an unexpected request.", coaching: "practice" },
  DISCLOSED_DUMMY_SECRET: { label: "Disclosed a practice token", evidence: "The session detected a synthetic training token. Keep tokens and credentials private on unexpected calls.", coaching: "practice" },
  UNKNOWN: { label: "Unclear response", evidence: "The committed event does not establish a specific decision.", coaching: "observation" },
};

export const tacticLabels: Record<TacticCategory, string> = {
  URGENCY: "Urgency",
  AUTHORITY: "Claimed authority",
  ISOLATION: "Isolation",
  FEAR_CONSEQUENCE: "Fear of consequences",
  REWARD_FAKE_HELP: "Reward or fake help",
};

export function sessionStartedAt(session: SafeSession): string | undefined {
  return session.metrics.find((metric) => metric.operation === "session_creation")?.startedAt;
}

export function uniqueRecentSessions(sessions: readonly SafeSession[]): SafeSession[] {
  const unique = [...new Map(sessions.map((session) => [session.sessionId, session])).values()];
  const timestamp = (session: SafeSession) => Date.parse(sessionStartedAt(session) ?? "") || 0;
  return unique.sort((left, right) => timestamp(right) - timestamp(left) || left.sessionId.localeCompare(right.sessionId));
}

export function summarizeSessions(sessions: readonly SafeSession[]) {
  const records = uniqueRecentSessions(sessions);
  const completed = records.filter((record) => sessionStatus(record) === "Completed").length;
  const stopped = records.filter((record) => sessionStatus(record) === "Stopped").length;
  const verification = records.filter((record) => sessionStatus(record) !== "In progress" && record.terminalState === "SAFE_VERIFIED").length;
  const disclosure = records.filter((record) => sessionStatus(record) !== "In progress" && record.terminalState === "DUMMY_SECRET_DISCLOSED").length;
  const outcomes = new Map<string, number>();
  const behaviors = new Map<BehaviorLabel, number>();
  const tactics = new Map<TacticCategory, number>();
  for (const record of records) {
    for (const event of record.timelineEvents) {
      if (event.terminalState !== "SAFE_WORD") behaviors.set(event.behavior.label, (behaviors.get(event.behavior.label) ?? 0) + 1);
      if (event.callerTacticCategory) tactics.set(event.callerTacticCategory, (tactics.get(event.callerTacticCategory) ?? 0) + 1);
    }
    const status = sessionStatus(record);
    if (status === "In progress") continue;
    const label = status === "Stopped" && record.terminalState !== "SAFE_WORD" ? "Stopped"
      : status === "Technical stop" ? status : sessionOutcome(record);
    outcomes.set(label, (outcomes.get(label) ?? 0) + 1);
  }
  return { total: records.length, completed, stopped, verification, disclosure,
    ended: [...outcomes.values()].reduce((sum, count) => sum + count, 0), outcomes: [...outcomes], behaviors: [...behaviors], tactics: [...tactics] };
}
