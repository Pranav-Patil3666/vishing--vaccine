import { SpeechSynthesisRequestSchema, type ApprovedCallerResponse, type SpeechSynthesisRequest } from "@vaccine/contracts";
import { isScenarioRuntimeEligible, type ScenarioDocument } from "@vaccine/scenario-schema";
import { ApprovedResponseResolver, toSpeechSynthesisRequest } from "../adaptivePolicy.js";
import { ApplicationError } from "../errors.js";

/** Server-authoritative content lookup. Browser text, voice and approval claims are never accepted. */
export class ApprovedCallerCatalog {
  constructor(private readonly scenarios: ReadonlyMap<string, ScenarioDocument>, readonly voice: string) {}
  resolveId(scenarioId: string, version: string, responseId: string): ApprovedCallerResponse {
    const scenario = this.scenarios.get(scenarioId), source = scenario?.responses[responseId];
    if (!scenario || scenario.scenario_id !== "S-01" || scenario.version !== version || scenario.language !== "hi-IN"
      || !isScenarioRuntimeEligible(scenario) || !scenario.adaptive_policy || !source || source.safety_status === "draft") {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Approved runtime caller content is unavailable.");
    }
    const template = source.safety_status === "system_safe_template";
    const response: ApprovedCallerResponse = { scenarioId, scenarioVersion: version, responseId, text: source.text,
      language: scenario.language, voice: scenario.voice_id ?? "mock-only", safetyStatus: source.safety_status,
      scenarioReviewStatus: template ? "not_applicable" : "approved",
      approvalReference: template ? `system-template:${responseId}` : `${scenarioId}@${version}:${responseId}` };
    const tactic = scenario.adaptive_policy.tactics.find((value) => value.response_ids.includes(responseId));
    const resolved = new ApprovedResponseResolver().resolve({ scenario, language: scenario.language, action: {
      tacticId: tactic?.tactic_id ?? null, tacticCategory: tactic?.category ?? null, pressureLevel: tactic?.pressure_level ?? 0,
      nextPressureLevel: tactic?.pressure_level ?? 0, responseId, response, terminalState: null, decisionCode: "SELECTED_TACTIC", reason: "selected",
    } });
    // Explicit backend delivery profile; does not modify the scenario's legacy mock-only voice metadata.
    return { ...resolved, voice: this.voice };
  }
  resolve(reference: SpeechSynthesisRequest): ApprovedCallerResponse {
    const parsed = SpeechSynthesisRequestSchema.safeParse(reference);
    if (!parsed.success) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Invalid approved caller reference.");
    const approved = this.resolveId(parsed.data.scenarioId, parsed.data.scenarioVersion, parsed.data.responseId);
    const expected = toSpeechSynthesisRequest(approved);
    if (Object.entries(expected).some(([key, value]) => parsed.data[key as keyof SpeechSynthesisRequest] !== value)) {
      throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Caller reference does not match current approval and voice configuration.");
    }
    return approved;
  }
}
