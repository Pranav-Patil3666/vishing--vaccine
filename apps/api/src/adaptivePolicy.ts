import { ApprovedCallerResponseSchema, SpeechSynthesisRequestSchema, type ApprovedCallerResponse, type BehaviorLabel, type SessionTerminalState, type SpeechSynthesisRequest } from "@vaccine/contracts";
import type { ScenarioDocument } from "@vaccine/scenario-schema";

export interface AdaptivePolicyInput {
  scenario: ScenarioDocument;
  behavior: BehaviorLabel;
  turnNumber: number;
  currentPressureLevel: number;
  previousTacticIds: readonly string[];
  previousResponseIds?: readonly string[];
  learnerText: string;
  learnerEnded?: boolean;
}

export interface AdaptivePolicyAction {
  tacticId: string | null;
  pressureLevel: number;
  response: ApprovedCallerResponse;
  terminalState: SessionTerminalState | null;
  reason: "safe_word" | "learner_ended" | "verified_independently" | "dummy_secret_disclosed" | "max_turns" | "selected" | "no_approved_tactic";
}

export function containsSafeWord(learnerText: string, safeWord: string): boolean {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
  return normalize(learnerText) === normalize(safeWord);
}

export function toSpeechSynthesisRequest(response: ApprovedCallerResponse): SpeechSynthesisRequest {
  return SpeechSynthesisRequestSchema.parse({
    scenarioId: response.scenarioId,
    scenarioVersion: response.scenarioVersion,
    responseId: response.responseId,
    language: response.language,
    voice: response.voice,
    safetyStatus: response.safetyStatus,
    scenarioReviewStatus: response.scenarioReviewStatus,
    approvalReference: response.approvalReference,
  });
}

/** Deterministic policy over reviewed scenario IDs. It never generates or accepts caller speech text. */
export function selectAdaptiveAction(input: AdaptivePolicyInput): AdaptivePolicyAction {
  const policy = input.scenario.adaptive_policy;
  const fallback = approvedResponse(input.scenario, "system.safe-fallback");
  if (!fallback) throw new Error("Scenario is missing a valid system-safe fallback response.");
  const terminal = (state: SessionTerminalState, reason: AdaptivePolicyAction["reason"]): AdaptivePolicyAction => ({
    tacticId: null,
    pressureLevel: Math.max(0, Math.min(input.currentPressureLevel, policy?.max_pressure_level ?? 0)),
    response: fallback,
    terminalState: policy?.terminal_states.includes(state) ? state : "SAFE_FALLBACK",
    reason,
  });

  if (!policy || input.scenario.review_status !== "approved") return terminal("SAFE_FALLBACK", "no_approved_tactic");
  if (containsSafeWord(input.learnerText, policy.safe_word)) return terminal("SAFE_WORD", "safe_word");
  if (input.learnerEnded) return terminal("LEARNER_ENDED", "learner_ended");
  if (input.behavior === "DISCLOSED_DUMMY_SECRET") return terminal("DUMMY_SECRET_DISCLOSED", "dummy_secret_disclosed");
  if (input.behavior === "VERIFIED_INDEPENDENTLY" && policy.terminal_states.includes("VERIFIED_INDEPENDENTLY")) {
    return terminal("VERIFIED_INDEPENDENTLY", "verified_independently");
  }
  if (input.turnNumber >= policy.max_turns) return terminal("MAX_TURNS", "max_turns");

  const escalating = policy.escalation_behaviors.includes(input.behavior);
  const targetPressure = Math.min(policy.max_pressure_level, Math.max(0, input.currentPressureLevel + (escalating ? 1 : 0)));
  const previouslyUsedTactics = new Set(input.previousTacticIds);
  const previouslyUsedResponses = new Set(input.previousResponseIds ?? []);
  const candidate = policy.tactics
    .filter((tactic) => tactic.pressure_level <= policy.max_pressure_level && !previouslyUsedTactics.has(tactic.tactic_id))
    .filter((tactic) => tactic.behavior_targets.includes(input.behavior) || tactic.behavior_targets.includes("UNKNOWN"))
    .filter((tactic) => tactic.pressure_level >= targetPressure)
    .sort((left, right) => left.pressure_level - right.pressure_level || left.tactic_id.localeCompare(right.tactic_id))
    .find((tactic) => tactic.response_ids.some((responseId) => !previouslyUsedResponses.has(responseId) && approvedResponse(input.scenario, responseId)));

  if (!candidate) return terminal("SAFE_FALLBACK", "no_approved_tactic");
  const responseId = candidate.response_ids.find((id) => !previouslyUsedResponses.has(id) && approvedResponse(input.scenario, id));
  const response = responseId ? approvedResponse(input.scenario, responseId) : undefined;
  if (!response || response.safetyStatus !== "reviewed_safe") return terminal("SAFE_FALLBACK", "no_approved_tactic");
  return {
    tacticId: candidate.tactic_id,
    pressureLevel: candidate.pressure_level,
    response,
    terminalState: null,
    reason: "selected",
  };
}

function approvedResponse(scenario: ScenarioDocument, responseId: string): ApprovedCallerResponse | undefined {
  const source = scenario.responses[responseId];
  if (!source || source.safety_status === "draft") return undefined;
  const systemTemplate = source.safety_status === "system_safe_template";
  if (!systemTemplate && scenario.review_status !== "approved") return undefined;
  return ApprovedCallerResponseSchema.parse({
    scenarioId: scenario.scenario_id,
    scenarioVersion: scenario.version,
    responseId,
    text: source.text,
    language: scenario.language ?? "pending-verification",
    voice: scenario.voice_id ?? "mock-only",
    safetyStatus: systemTemplate ? "system_safe_template" : "reviewed_safe",
    scenarioReviewStatus: systemTemplate ? "not_applicable" : "approved",
    approvalReference: systemTemplate ? `system-template:${responseId}` : `${scenario.scenario_id}@${scenario.version}:${responseId}`,
  });
}
