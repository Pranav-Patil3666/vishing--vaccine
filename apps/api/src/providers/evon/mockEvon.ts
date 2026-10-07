import type { DraftTree, Reasoner, ScenarioBrief } from "@vaccine/contracts";
import { DraftScenarioPackageSchema, ScenarioDocumentSchema, generateSyntheticBehaviorTrainingExamples, type DraftScenarioPackage } from "@vaccine/scenario-schema";

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

/** Deterministic offline authoring fixture; it never calls Evon and every result remains DRAFT. */
export class MockEvonAuthoringAdapter {
  async generateDraftScenarioPackage(brief: ScenarioBrief): Promise<DraftScenarioPackage> {
    const scenarioId = /^S-\d{2}$/u.test(brief.scenarioId) ? brief.scenarioId : "S-90";
    const responseDefinitions = [
      { responseId: "candidate-urgency", category: "URGENCY" as const, text: "This is a training simulation. Pause and verify the request through a known official channel." },
      { responseId: "candidate-authority", category: "AUTHORITY" as const, text: "This fictional caller cannot verify identity. Use a contact method you already trust." },
      { responseId: "candidate-isolation", category: "ISOLATION" as const, text: "You may pause the simulation and ask a trusted colleague to review the request." },
      { responseId: "candidate-fear", category: "FEAR_CONSEQUENCE" as const, text: "Do not act on a stated consequence until you independently verify it." },
      { responseId: "candidate-reward", category: "REWARD_FAKE_HELP" as const, text: "Do not share information to claim a practice reward; verify through a known channel." },
    ];
    const scenario = {
      scenario_id: scenarioId,
      version: "0.1.0-draft",
      lifecycle_status: "DRAFT",
      language: null,
      voice_id: null,
      fictional_organization: { name: "Fictional Practice Desk", training_only: true },
      simulation: true,
      opening_line: "This is a training simulation using fictional content.",
      learning_objectives: [brief.learningObjective],
      red_flag_ids: brief.redFlags.length ? brief.redFlags : ["RF-01"],
      responses: {
        ...Object.fromEntries(responseDefinitions.map(({ responseId, text }) => [responseId, { text, safety_status: "draft" }])),
        "system.safe-fallback": { text: "End this simulation and verify through a known official channel.", safety_status: "system_safe_template" },
      },
      nodes: [{
        id: "start", parent_node_id: null, trigger_rules: [], response_id: "candidate-urgency",
        learner_expected_behavior: ["Pause and verify independently."], next_node_id: null,
        safe_fallback_response_id: "system.safe-fallback", debrief_tags: brief.redFlags.length ? brief.redFlags : ["RF-01"],
        safety_constraints: ["Simulation only; do not request real credentials or actionable identifiers."], branch_status: "draft",
      }],
      adaptive_policy: {
        max_pressure_level: 2,
        max_turns: 6,
        safe_word: "stop simulation",
        escalation_behaviors: ["COMPLIED", "STALLED"],
        terminal_states: ["SAFE_WORD", "LEARNER_ENDED", "SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS", "SCENARIO_COMPLETED"],
        tactics: responseDefinitions.map((definition, index) => ({
          tactic_id: `candidate-${definition.category.toLocaleLowerCase()}`,
          category: definition.category,
          pressure_level: Math.min(2, index === 0 ? 0 : 1),
          prompts_dummy_secret: false,
          behavior_targets: ["UNKNOWN", "REFUSED", "STALLED", "COMPLIED"],
          response_ids: [definition.responseId],
        })),
      },
      safety_metadata: {
        visible_simulation_label: true,
        ai_voice_disclosure_required: true,
        consent_before_recording: true,
        audio_retention: "none_by_default",
        dummy_data_mode: "synthetic_only",
        safe_ending_response_id: "system.safe-fallback",
      },
      safety_constraints: ["Draft content; human review required before any runtime use."],
      review_status: "draft",
      reviewed_by: null,
      reviewed_at: null,
    };
    const parsedScenario = ScenarioDocumentSchema.parse(scenario);
    const examples = generateSyntheticBehaviorTrainingExamples();
    const language = brief.language ?? "en";
    const candidateApprovedResponses = responseDefinitions.map(({ responseId, text }) => ({ responseId, text, language, status: "DRAFT" as const }));
    return DraftScenarioPackageSchema.parse({
      packageId: `mock-evon-${scenarioId}-0.1.0-draft`,
      status: "DRAFT",
      source: "offline_authoring",
      target: "offline_pre_generated",
      scenarioBrief: { ...brief, scenarioId },
      scenario: parsedScenario,
      tacticPool: responseDefinitions.map((definition, index) => ({
        tacticId: `candidate-${definition.category.toLocaleLowerCase()}`,
        category: definition.category,
        pressureLevel: Math.min(2, index === 0 ? 0 : 1),
        responseIds: [definition.responseId],
        status: "DRAFT",
      })),
      candidateApprovedResponses,
      behaviorTrainingExamples: examples,
      debriefTemplateVariants: [
        { templateId: "debrief-en-safe", language: "en", kind: "safe", text: "You used an observable safety behavior; continue verifying independently.", status: "DRAFT" },
        { templateId: "debrief-hi-safe", language: "hi", kind: "safe", text: "आपने सुरक्षा के लिए स्पष्ट कदम लिया; स्वतंत्र रूप से सत्यापन जारी रखें।", status: "DRAFT" },
        { templateId: "debrief-hien-safe", language: "hi-en", kind: "safe", text: "Aapne safe step liya; independently verify karte rahein.", status: "DRAFT" },
      ],
      candidateUtterances: examples,
      importableArtifacts: [{ artifactId: `mock-artifact-${scenarioId}`, format: "scenario-json", scenario: parsedScenario }],
      review: {
        decision: "pending", reviewerId: null, reviewedAt: null,
        checklist: {
          fictionalOrganization: false, syntheticDataOnly: false, noSecurityBypassInstructions: false,
          safeEndingAvailable: false, simulationLabelVisible: false, aiVoiceDisclosureRequired: false,
          consentBeforeRecording: false, noAudioRetentionByDefault: false,
        },
        notes: ["Mock authoring fixture; human review is required."],
      },
      runtimeEligible: false,
    });
  }
}
