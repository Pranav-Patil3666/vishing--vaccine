import { validateScenarioDocument } from "@vaccine/scenario-schema";

/** OFFLINE TEST ONLY. This fabricated review metadata must never enter content/ or live acceptance. */
export function realVoiceScenarioFixture() {
  return validateScenarioDocument({
    scenario_id: "S-01", version: "offline-test-only", lifecycle_status: "RUNTIME_ELIGIBLE", language: "hi-IN", voice_id: "mock-only",
    fictional_organization: { name: "Fictional Offline Test Circle", training_only: true }, simulation: true,
    opening_line: "Yeh sirf test simulation hai. Official channel se verify karein.", learning_objectives: ["Verify independently."], red_flag_ids: ["RF-01", "RF-02"],
    responses: {
      urgency: { text: "Yeh sirf test simulation hai. Official channel se verify karein.", safety_status: "reviewed_safe" },
      authority: { text: "This offline test encourages independent verification.", safety_status: "reviewed_safe" },
      fear: { text: "This offline test can be ended at any time.", safety_status: "reviewed_safe" },
      "system.safe-fallback": { text: "End this fictional simulation and verify independently.", safety_status: "system_safe_template" },
    },
    nodes: [{ id: "start", parent_node_id: null, trigger_rules: [], response_id: "urgency", learner_expected_behavior: ["Verify independently."], next_node_id: null,
      safe_fallback_response_id: "system.safe-fallback", debrief_tags: ["RF-01", "RF-02"], safety_constraints: ["No personal data."], branch_status: "approved" }],
    adaptive_policy: { max_pressure_level: 5, max_turns: 3, safe_word: "stop simulation", escalation_behaviors: ["COMPLIED", "DISCLOSED_DUMMY_SECRET"],
      terminal_states: ["SAFE_WORD", "LEARNER_ENDED", "SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"], tactics: [
        { tactic_id: "urgency", category: "URGENCY", pressure_level: 5, prompts_dummy_secret: false, behavior_targets: ["UNKNOWN"], response_ids: ["urgency"] },
        { tactic_id: "authority", category: "AUTHORITY", pressure_level: 2, prompts_dummy_secret: false, behavior_targets: ["REFUSED", "STALLED"], response_ids: ["authority"] },
        { tactic_id: "fear", category: "FEAR_CONSEQUENCE", pressure_level: 5, prompts_dummy_secret: false, behavior_targets: ["COMPLIED"], response_ids: ["fear"] },
      ] },
    safety_metadata: { visible_simulation_label: true, ai_voice_disclosure_required: true, consent_before_recording: true,
      audio_retention: "none_by_default", dummy_data_mode: "synthetic_only", safe_ending_response_id: "system.safe-fallback" },
    safety_constraints: ["OFFLINE TEST ONLY."], review_status: "approved", reviewed_by: "offline-test-only", reviewed_at: "2026-10-13T00:00:00.000Z",
  });
}
