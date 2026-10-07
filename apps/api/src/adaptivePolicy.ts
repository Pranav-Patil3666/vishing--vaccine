import {
  ApprovedCallerResponseSchema,
  SpeechSynthesisRequestSchema,
  type ApprovedCallerResponse,
  type BehaviorLabel,
  type PolicyDecisionCode,
  type SessionTerminalState,
  type SpeechSynthesisRequest,
  type TacticCategory,
} from "@vaccine/contracts";
import { isScenarioRuntimeEligible, type ScenarioDocument } from "@vaccine/scenario-schema";

export interface AdaptivePolicyInput {
  scenario: ScenarioDocument;
  behavior: BehaviorLabel;
  turnNumber: number;
  currentPressureLevel: number;
  previousTacticIds: readonly string[];
  previousResponseIds?: readonly string[];
  learnerText: string;
  learnerEnded?: boolean;
  safeWordDetected?: boolean;
  runtimeAllowed?: boolean;
}

export interface AdaptivePolicyAction {
  tacticId: string | null;
  tacticCategory: TacticCategory | null;
  pressureLevel: number;
  nextPressureLevel: number;
  responseId: string;
  response: ApprovedCallerResponse;
  terminalState: SessionTerminalState | null;
  decisionCode: PolicyDecisionCode;
  reason: "safe_word" | "learner_ended" | "verified_independently" | "dummy_secret_disclosed" | "max_turns" | "selected" | "no_approved_tactic";
}

function normalizeSafeWordText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
}

/** Matches the configured phrase as a whole token sequence anywhere in the utterance. */
export function containsSafeWord(learnerText: string, safeWord: string): boolean {
  const utterance = ` ${normalizeSafeWordText(learnerText)} `;
  const phrase = normalizeSafeWordText(safeWord);
  return phrase.length > 0 && utterance.includes(` ${phrase} `);
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

/** Stateless policy wrapper makes deterministic selection explicit at the orchestration boundary. */
export class AdaptivePolicyEngine {
  decide(input: AdaptivePolicyInput): AdaptivePolicyAction {
    return selectAdaptiveAction(input);
  }
}

/** Only resolves content already referenced by the policy and already marked safe in scenario data. */
export class ApprovedResponseResolver {
  resolve(input: {
    scenario: ScenarioDocument;
    language: string;
    action: AdaptivePolicyAction;
  }): ApprovedCallerResponse {
    const { scenario, language, action } = input;
    if (!Number.isInteger(action.pressureLevel) || action.pressureLevel < 0 || action.pressureLevel > 5) {
      throw new Error("Policy pressure is outside the supported range.");
    }
    if (scenario.adaptive_policy && action.pressureLevel > scenario.adaptive_policy.max_pressure_level) {
      throw new Error("Policy pressure exceeds the scenario maximum.");
    }
    if (action.tacticId !== null) {
      const tactic = scenario.adaptive_policy?.tactics.find((candidate) => candidate.tactic_id === action.tacticId);
      if (!tactic || tactic.category !== action.tacticCategory || tactic.pressure_level !== action.pressureLevel
        || !tactic.response_ids.includes(action.responseId)) {
        throw new Error("Policy response is not attached to the selected tactic.");
      }
      if (!isScenarioRuntimeEligible(scenario)) throw new Error("Only runtime-eligible scenarios can resolve adaptive responses.");
      if (scenario.language !== language) throw new Error("Response language does not match the approved scenario language.");
    }
    if (action.response.responseId !== action.responseId) throw new Error("Policy response identity is inconsistent.");
    const source = scenario.responses[action.responseId];
    if (!source || source.safety_status === "draft") throw new Error("Approved response is unavailable.");
    if (source.safety_status === "reviewed_safe" && (!isScenarioRuntimeEligible(scenario) || scenario.language !== language)) {
      throw new Error("Reviewed response is unavailable for this runtime language.");
    }
    const resolved = approvedResponse(scenario, action.responseId, language);
    if (!resolved) throw new Error("Approved response is unavailable.");
    return resolved;
  }
}

/** Deterministic policy over runtime-eligible scenario IDs. It never generates caller speech text. */
export function selectAdaptiveAction(input: AdaptivePolicyInput): AdaptivePolicyAction {
  const policy = input.scenario.adaptive_policy;
  const eligible = isScenarioRuntimeEligible(input.scenario) && input.runtimeAllowed !== false;
  const fallback = approvedResponse(input.scenario, "system.safe-fallback", input.scenario.language ?? "pending-verification");
  if (!fallback) throw new Error("Scenario is missing a valid system-safe fallback response.");
  const safeEnding = policy?.terminal_states.some((state) => state === "SAFE_WORD" || state === "SAFE_VERIFIED")
    ? approvedResponse(input.scenario, input.scenario.safety_metadata?.safe_ending_response_id ?? "system.safe-fallback", input.scenario.language ?? "pending-verification") ?? fallback
    : fallback;
  const terminal = (
    state: SessionTerminalState,
    reason: AdaptivePolicyAction["reason"],
    decisionCode: PolicyDecisionCode,
    response = safeEnding,
  ): AdaptivePolicyAction => {
    const terminalPressure = Math.max(0, Math.min(input.currentPressureLevel, policy?.max_pressure_level ?? input.scenario.adaptive_policy?.max_pressure_level ?? 0, 5));
    return {
      tacticId: null,
      tacticCategory: null,
      pressureLevel: terminalPressure,
      nextPressureLevel: terminalPressure,
      responseId: response.responseId,
      response,
      terminalState: state,
      decisionCode,
      reason,
    };
  };

  if (input.safeWordDetected || containsSafeWord(input.learnerText, policy?.safe_word ?? "stop simulation")) {
    return terminal("SAFE_WORD", "safe_word", "SAFE_WORD");
  }
  if (input.learnerEnded) return terminal("LEARNER_ENDED", "learner_ended", "LEARNER_ENDED");
  if (!policy || !eligible) {
    return {
      tacticId: null,
      tacticCategory: null,
      pressureLevel: Math.max(0, Math.min(input.currentPressureLevel, 5)),
      nextPressureLevel: Math.max(0, Math.min(input.currentPressureLevel, 5)),
      responseId: fallback.responseId,
      response: fallback,
      terminalState: null,
      decisionCode: "DRAFT_SAFE_FALLBACK",
      reason: "no_approved_tactic",
    };
  }
  if (input.behavior === "VERIFIED_INDEPENDENTLY") return terminal("SAFE_VERIFIED", "verified_independently", "SAFE_VERIFIED");
  if (input.behavior === "DISCLOSED_DUMMY_SECRET") return terminal("DUMMY_SECRET_DISCLOSED", "dummy_secret_disclosed", "DUMMY_SECRET_DISCLOSED");
  if (input.turnNumber >= policy.max_turns) return terminal("MAX_TURNS", "max_turns", "MAX_TURNS");

  const escalating = policy.escalation_behaviors.includes(input.behavior);
  const targetPressure = Math.min(policy.max_pressure_level, Math.max(0, input.currentPressureLevel + (escalating ? 1 : 0)));
  const previouslyUsedTactics = new Set(input.previousTacticIds);
  const previouslyUsedResponses = new Set(input.previousResponseIds ?? []);
  const eligibleTactics = policy.tactics
    .filter((tactic) => tactic.pressure_level <= policy.max_pressure_level && !previouslyUsedTactics.has(tactic.tactic_id))
    .filter((tactic) => tactic.behavior_targets.includes(input.behavior) || tactic.behavior_targets.includes("UNKNOWN"))
    .sort((left, right) => left.pressure_level - right.pressure_level || left.category.localeCompare(right.category) || left.tactic_id.localeCompare(right.tactic_id));
  const candidate = eligibleTactics.find((tactic) => tactic.pressure_level >= targetPressure)
    ?? eligibleTactics.find((tactic) => tactic.pressure_level <= input.currentPressureLevel);
  if (!candidate) return terminal("SAFE_FALLBACK", "no_approved_tactic", "NO_APPROVED_TACTIC", fallback);

  const responseId = candidate.response_ids.find((id) => !previouslyUsedResponses.has(id)
    && approvedResponse(input.scenario, id, input.scenario.language ?? "pending-verification"));
  const response = responseId ? approvedResponse(input.scenario, responseId, input.scenario.language ?? "pending-verification") : undefined;
  if (!response || response.safetyStatus !== "reviewed_safe") return terminal("SAFE_FALLBACK", "no_approved_tactic", "NO_APPROVED_TACTIC", fallback);
  return {
    tacticId: candidate.tactic_id,
    tacticCategory: candidate.category,
    pressureLevel: candidate.pressure_level,
    nextPressureLevel: candidate.pressure_level,
    responseId: responseId!,
    response,
    terminalState: null,
    decisionCode: "SELECTED_TACTIC",
    reason: "selected",
  };
}

function approvedResponse(scenario: ScenarioDocument, responseId: string, language: string): ApprovedCallerResponse | undefined {
  const source = scenario.responses[responseId];
  if (!source || source.safety_status === "draft") return undefined;
  const systemTemplate = source.safety_status === "system_safe_template";
  if (!systemTemplate && (!isScenarioRuntimeEligible(scenario) || scenario.language !== language)) return undefined;
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
