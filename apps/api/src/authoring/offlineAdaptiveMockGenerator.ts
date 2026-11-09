import { DeterministicMockScenarioGenerator, type MockDraftBrief, type ScenarioDraftGenerator } from "@vaccine/scenario-schema";

export class OfflineAdaptiveMockGenerator implements ScenarioDraftGenerator {
  generateDraft(brief: MockDraftBrief) {
    const candidate = new DeterministicMockScenarioGenerator().generateDraft(brief);
    const { details, draft } = candidate;
    const { scenario } = draft;
    details.runtimeProfile = "offline-adaptive-v1";

    // This typed-practice profile uses the same safe line for three distinct terminal outcomes.
    for (const outcome of ["SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"] as const) {
      delete scenario.responses[details.terminalResponses[outcome]];
      details.terminalResponses[outcome] = "system.safe-ending";
    }
    const continuationIds = new Set(scenario.nodes.slice(1).map((node) => node.response_id));
    for (const tactic of scenario.adaptive_policy!.tactics) {
      tactic.behavior_targets = tactic.response_ids.some((id) => continuationIds.has(id))
        ? ["REFUSED", "STALLED", "COMPLIED"] : ["VERIFIED_INDEPENDENTLY"];
    }
    for (const node of scenario.nodes.slice(1)) node.debrief_tags = [...scenario.nodes[0]!.debrief_tags];
    draft.candidateApprovedResponses = draft.candidateApprovedResponses.filter(({ responseId }) => responseId in scenario.responses);
    // The underlying template mirrors the same scenario object in its importable artifact.
    return candidate;
  }
}
