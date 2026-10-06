import type { DraftTree, Reasoner, ScenarioBrief } from "@vaccine/contracts";

export class MockEvonReasoner implements Reasoner {
  async generateScenario(brief: ScenarioBrief): Promise<DraftTree> {
    return {
      scenarioId: brief.scenarioId,
      language: brief.language,
      nodes: [{
        id: "draft-placeholder",
        text: "Draft placeholder for human safety review; no caller script has been generated.",
        suggestedRedFlags: brief.redFlags,
      }],
    };
  }
}
