import {
  ApprovedCallerResponseSchema,
  BehaviorLabelSchema,
  PolicyDecisionCodeSchema,
  SessionStateSchema,
  SpeechSynthesisRequestSchema,
  type ApprovedCallerResponse,
  type BehaviorLabel,
  type PolicyDecisionCode,
  type SessionTerminalState,
  type SessionState,
  type SpeechSynthesisRequest,
  type TacticCategory,
} from "@vaccine/contracts";
import { isScenarioRuntimeEligible, ScenarioDocumentSchema, type ScenarioDocument } from "@vaccine/scenario-schema";
import { ApplicationError } from "./errors.js";

const policySessionSchema = SessionStateSchema.pick({ scenarioId: true, scenarioVersion: true, currentNodeId: true,
  turnNumber: true, terminalState: true, state: true, currentTacticId: true, currentResponseId: true }).strict();
export type PolicySessionState = Pick<SessionState, "scenarioId" | "scenarioVersion" | "currentNodeId" | "turnNumber" | "terminalState" | "state" | "currentTacticId" | "currentResponseId">;

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
  /** Existing session facts; omitted only by legacy stateless/developer preview callers. */
  sessionState?: PolicySessionState;
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
    validateRuntimeScenario(scenario);
    if (scenario.language !== null && language !== scenario.language) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Response language does not match the approved scenario language.");
    if (!PolicyDecisionCodeSchema.safeParse(action.decisionCode).success || !ApprovedCallerResponseSchema.safeParse(action.response).success) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy response metadata is invalid.");
    }
    if (![action.pressureLevel, action.nextPressureLevel].every((value) => Number.isInteger(value) && value >= 0 && value <= 5)) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy pressure is outside the supported range.");
    }
    if (scenario.adaptive_policy && Math.max(action.pressureLevel, action.nextPressureLevel) > scenario.adaptive_policy.max_pressure_level) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy pressure exceeds the scenario maximum.");
    }
    if (action.nextPressureLevel !== action.pressureLevel) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy next pressure is inconsistent.");
    if (action.tacticId !== null) {
      const tactic = scenario.adaptive_policy?.tactics.find((candidate) => candidate.tactic_id === action.tacticId);
      if (!tactic || tactic.category !== action.tacticCategory || tactic.pressure_level !== action.pressureLevel
        || !tactic.response_ids.includes(action.responseId)) {
        throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy response is not attached to the selected tactic.");
      }
      if (!isScenarioRuntimeEligible(scenario)) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Only runtime-eligible scenarios can resolve adaptive responses.");
      if (scenario.language !== language) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Response language does not match the approved scenario language.");
    }
    if (action.response.responseId !== action.responseId) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy response identity is inconsistent.");
    const source = scenario.responses[action.responseId];
    if (!source || source.safety_status === "draft") throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Approved response is unavailable.");
    if (source.safety_status === "reviewed_safe" && (!isScenarioRuntimeEligible(scenario) || scenario.language !== language)) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Reviewed response is unavailable for this runtime language.");
    }
    const resolved = approvedResponse(scenario, action.responseId, language);
    if (!resolved) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Approved response is unavailable.");
    if ((Object.keys(resolved) as (keyof ApprovedCallerResponse)[]).some((key) => resolved[key] !== action.response[key])) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy response identity, version or approved content is inconsistent.");
    }
    return resolved;
  }
}

/** Policy outcome validation is separate from reusable approved-asset lookup (including opening audio). */
export function validatePolicyTransition(scenario: ScenarioDocument, action: AdaptivePolicyAction): void {
  new ApprovedResponseResolver().resolve({ scenario, language: scenario.language ?? "pending-verification", action });
  if (!hasApprovedPressure(scenario, action.nextPressureLevel)) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy pressure has no approved scenario content support.");
  const terminalOutcomes: Partial<Record<PolicyDecisionCode, SessionTerminalState>> = {
    SAFE_WORD: "SAFE_WORD", LEARNER_ENDED: "LEARNER_ENDED", SAFE_VERIFIED: "SAFE_VERIFIED",
    DUMMY_SECRET_DISCLOSED: "DUMMY_SECRET_DISCLOSED", MAX_TURNS: "MAX_TURNS", NO_APPROVED_TACTIC: "SAFE_FALLBACK",
  };
  const expectedTerminal = terminalOutcomes[action.decisionCode] ?? null;
  if (action.terminalState !== expectedTerminal || (action.decisionCode === "SELECTED_TACTIC") !== (action.tacticId !== null)
    || (action.tacticId === null && action.tacticCategory !== null)) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy terminal/tactic metadata is inconsistent.");
  if (action.terminalState && action.terminalState !== "SAFE_FALLBACK" && isScenarioRuntimeEligible(scenario)
    && !scenario.adaptive_policy?.terminal_states.includes(action.terminalState)) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy terminal outcome is not declared by the scenario.");
  if (action.tacticId === null) {
    const expectedResponse = ["NO_APPROVED_TACTIC", "DRAFT_SAFE_FALLBACK"].includes(action.decisionCode) ? "system.safe-fallback"
      : scenario.safety_metadata?.safe_ending_response_id ?? "system.safe-fallback";
    if (action.responseId !== expectedResponse) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy terminal response identity is inconsistent.");
  }
}

/** Deterministic policy over runtime-eligible scenario IDs. It never generates caller speech text. */
export function selectAdaptiveAction(input: AdaptivePolicyInput): AdaptivePolicyAction {
  validatePolicyInput(input);
  const action = selectApprovedAction(input);
  validatePolicyTransition(input.scenario, action);
  return action;
}

function selectApprovedAction(input: AdaptivePolicyInput): AdaptivePolicyAction {
  const policy = input.scenario.adaptive_policy;
  const eligible = isScenarioRuntimeEligible(input.scenario) && input.runtimeAllowed !== false;
  const fallback = approvedResponse(input.scenario, "system.safe-fallback", input.scenario.language ?? "pending-verification");
  if (!fallback) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Scenario is missing a valid system-safe fallback response.");
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
  if (!source || source.safety_status === "draft" || !source.text.trim()) return undefined;
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

function validateRuntimeScenario(scenario: ScenarioDocument): void {
  if (isScenarioRuntimeEligible(scenario) && (!ScenarioDocumentSchema.safeParse(scenario).success || Object.values(scenario.responses).some((response) => !response.text.trim()))) {
    throw new ApplicationError("INVALID_SCENARIO", "Runtime policy content is structurally invalid or unapproved.");
  }
}

/** Zero is the initial un-attributed caller state; other levels require approved tactic content. */
function hasApprovedPressure(scenario: ScenarioDocument, pressure: number): boolean {
  return !isScenarioRuntimeEligible(scenario) || !scenario.adaptive_policy || pressure === 0
    || scenario.adaptive_policy.tactics.some((tactic) => tactic.pressure_level === pressure
      && tactic.response_ids.some((id) => scenario.responses[id]?.safety_status === "reviewed_safe"));
}

function validatePolicyInput(input: AdaptivePolicyInput): void {
  if (!input?.scenario || !Array.isArray(input.scenario.nodes) || !input.scenario.responses) throw new ApplicationError("INVALID_SCENARIO", "Policy scenario is unavailable.");
  validateRuntimeScenario(input.scenario);
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
  if (!BehaviorLabelSchema.safeParse(input.behavior).success || !Number.isInteger(input.turnNumber) || input.turnNumber < 1
    || typeof input.learnerText !== "string" || !strings(input.previousTacticIds) || (input.previousResponseIds !== undefined && !strings(input.previousResponseIds))
    || [input.learnerEnded, input.safeWordDetected, input.runtimeAllowed].some((value) => value !== undefined && typeof value !== "boolean")) {
    throw new ApplicationError("INVALID_REQUEST", "Policy behavior, turn or history input is invalid.");
  }
  const policy = input.scenario.adaptive_policy;
  if (!Number.isInteger(input.currentPressureLevel) || input.currentPressureLevel < 0 || input.currentPressureLevel > (policy?.max_pressure_level ?? 5)
    || (policy && input.turnNumber > policy.max_turns)) throw new ApplicationError("INVALID_STATE", "Policy pressure or turn exceeds the scenario bounds.");
  if (!hasApprovedPressure(input.scenario, input.currentPressureLevel)) throw new ApplicationError("INVALID_STATE", "Policy pressure has no approved scenario content support.");
  if (policy && isScenarioRuntimeEligible(input.scenario) && (input.previousTacticIds.some((id) => !policy.tactics.some((tactic) => tactic.tactic_id === id))
    || input.previousResponseIds?.some((id) => !input.scenario.responses[id]))) throw new ApplicationError("INVALID_STATE", "Policy history references unavailable content.");
  if (input.sessionState !== undefined) {
    const parsed = policySessionSchema.safeParse(input.sessionState);
    if (!parsed.success) throw new ApplicationError("INVALID_STATE", "Policy session facts are invalid.");
    const state = parsed.data, node = input.scenario.nodes.find((candidate) => candidate.id === state.currentNodeId);
    if (state.terminalState !== null || ["COMPLETED", "ENDED_BY_LEARNER", "ERROR"].includes(state.state)
      || state.scenarioId !== input.scenario.scenario_id || state.scenarioVersion !== input.scenario.version || state.turnNumber + 1 !== input.turnNumber || !node) {
      throw new ApplicationError("INVALID_STATE", "Policy session is terminal, stale or mismatched.");
    }
    if (policy && isScenarioRuntimeEligible(input.scenario) && input.runtimeAllowed !== false) {
      if (state.turnNumber > 0 && (input.previousTacticIds.at(-1) !== state.currentTacticId || input.previousResponseIds?.at(-1) !== state.currentResponseId)) {
        throw new ApplicationError("INVALID_STATE", "Policy active state does not match its completed-turn history.");
      }
      const active = policy.tactics.find((tactic) => tactic.tactic_id === state.currentTacticId);
      if (state.currentTacticId !== null ? !active || active.pressure_level !== input.currentPressureLevel || !active.response_ids.includes(state.currentResponseId ?? "")
        : input.currentPressureLevel !== 0 || (state.currentResponseId !== null && state.currentResponseId !== node.response_id)) {
        throw new ApplicationError("INVALID_STATE", "Policy active tactic, response or pressure is inconsistent.");
      }
    }
  }
}
