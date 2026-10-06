import {
  BehaviorLabelSchema,
  RedFlagIdSchema,
  SessionTerminalStateSchema,
  SYSTEM_SAFE_FALLBACK_RESPONSE_ID,
  TriggerRuleSchema,
} from "@vaccine/contracts";
import { z } from "zod";

const responseSchema = z.object({
  text: z.string().min(1),
  safety_status: z.enum(["draft", "system_safe_template", "reviewed_safe"]),
}).strict();

const tacticSchema = z.object({
  tactic_id: z.string().min(1),
  pressure_level: z.number().int().min(0).max(5),
  behavior_targets: z.array(BehaviorLabelSchema).min(1),
  response_ids: z.array(z.string().min(1)).min(1),
}).strict();

const adaptivePolicySchema = z.object({
  max_pressure_level: z.number().int().min(0).max(5),
  max_turns: z.number().int().min(1).max(30),
  safe_word: z.string().min(1).max(80),
  escalation_behaviors: z.array(BehaviorLabelSchema).min(1),
  terminal_states: z.array(SessionTerminalStateSchema).min(1),
  tactics: z.array(tacticSchema).min(1),
}).strict();

const safetyMetadataSchema = z.object({
  visible_simulation_label: z.literal(true),
  ai_voice_disclosure_required: z.literal(true),
  consent_before_recording: z.literal(true),
  audio_retention: z.literal("none_by_default"),
  dummy_data_mode: z.literal("synthetic_only"),
  safe_ending_response_id: z.string().min(1),
}).strict();

const scenarioNodeSchema = z.object({
  id: z.string().min(1),
  parent_node_id: z.string().nullable(),
  trigger_rules: z.array(TriggerRuleSchema),
  response_id: z.string().min(1),
  learner_expected_behavior: z.array(z.string().min(1)),
  next_node_id: z.string().nullable(),
  safe_fallback_response_id: z.string().min(1),
  debrief_tags: z.array(RedFlagIdSchema),
  safety_constraints: z.array(z.string().min(1)),
  branch_status: z.enum(["draft", "approved"]),
}).strict();

export const ScenarioDocumentSchema = z.object({
  scenario_id: z.string().regex(/^S-\d{2}$/),
  version: z.string().min(1),
  language: z.string().min(1).nullable(),
  voice_id: z.string().min(1).nullable(),
  fictional_organization: z.object({
    name: z.string().min(1),
    training_only: z.literal(true),
  }).strict(),
  simulation: z.literal(true),
  opening_line: z.string().min(1),
  learning_objectives: z.array(z.string().min(1)).min(1),
  red_flag_ids: z.array(RedFlagIdSchema).min(1),
  responses: z.record(z.string().min(1), responseSchema),
  nodes: z.array(scenarioNodeSchema).min(1),
  adaptive_policy: adaptivePolicySchema.optional(),
  safety_metadata: safetyMetadataSchema.optional(),
  safety_constraints: z.array(z.string().min(1)).min(1),
  review_status: z.enum(["draft", "in_review", "approved", "rejected"]),
  reviewed_by: z.string().min(1).nullable(),
  reviewed_at: z.string().datetime().nullable(),
}).strict().superRefine((scenario, context) => {
  const nodeIds = new Set<string>();
  const responseIds = new Set(Object.keys(scenario.responses));
  let rootCount = 0;

  const systemFallback = scenario.responses[SYSTEM_SAFE_FALLBACK_RESPONSE_ID];
  if (!systemFallback || systemFallback.safety_status === "draft") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["responses", SYSTEM_SAFE_FALLBACK_RESPONSE_ID], message: "The system-safe fallback response is required and cannot be draft content." });
  }

  for (const [index, node] of scenario.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "id"], message: `Duplicate node ID: ${node.id}` });
    }
    nodeIds.add(node.id);
    if (node.parent_node_id === null) rootCount += 1;
    if (!responseIds.has(node.response_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "response_id"], message: "Response ID does not exist." });
    }
    if (!responseIds.has(node.safe_fallback_response_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "safe_fallback_response_id"], message: "Safe fallback response ID does not exist." });
    } else {
      const fallback = scenario.responses[node.safe_fallback_response_id];
      if (fallback && fallback.safety_status === "draft") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "safe_fallback_response_id"], message: "Fallback must point to a safe-template or reviewed-safe response." });
      }
    }
    if (node.next_node_id !== null && !scenario.nodes.some((candidate) => candidate.id === node.next_node_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "next_node_id"], message: `Unknown next_node_id: ${node.next_node_id}` });
    }
    if (node.parent_node_id !== null && !scenario.nodes.some((candidate) => candidate.id === node.parent_node_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "parent_node_id"], message: `Unknown parent_node_id: ${node.parent_node_id}` });
    }
    if (node.parent_node_id === null && node.trigger_rules.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "trigger_rules"], message: "The root node cannot have learner trigger rules." });
    }
    if (node.parent_node_id !== null && node.trigger_rules.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "trigger_rules"], message: "A routed node must define at least one trigger rule." });
    }
    for (const [ruleIndex, rule] of node.trigger_rules.entries()) {
      if (rule.type === "regex" && !isConservativeRegex(rule.pattern, rule.flags ?? "")) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "trigger_rules", ruleIndex], message: "Regex uses unsupported or potentially unsafe syntax." });
      }
    }
    if (node.learner_expected_behavior.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "learner_expected_behavior"], message: "Expected learner behavior is required." });
    }
    if (node.debrief_tags.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "debrief_tags"], message: "At least one roadmap red-flag ID is required." });
    }
    if (node.safety_constraints.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "safety_constraints"], message: "At least one node safety constraint is required." });
    }
  }

  if (scenario.adaptive_policy) {
    const tacticIds = new Set<string>();
    const policy = scenario.adaptive_policy;
    if (!scenario.safety_metadata) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety_metadata"], message: "Adaptive scenarios require explicit simulation, consent, voice-disclosure, retention, synthetic-data, and safe-ending metadata." });
    }
    if (!policy.terminal_states.includes("SAFE_WORD") || !policy.terminal_states.includes("LEARNER_ENDED")) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["adaptive_policy", "terminal_states"], message: "Adaptive scenarios must support both safe-word and learner-ended terminal states." });
    }
    for (const [index, tactic] of policy.tactics.entries()) {
      if (tacticIds.has(tactic.tactic_id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["adaptive_policy", "tactics", index, "tactic_id"], message: `Duplicate tactic ID: ${tactic.tactic_id}` });
      }
      tacticIds.add(tactic.tactic_id);
      if (tactic.pressure_level > policy.max_pressure_level) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["adaptive_policy", "tactics", index, "pressure_level"], message: "Tactic pressure cannot exceed the configured maximum." });
      }
      for (const [responseIndex, responseId] of tactic.response_ids.entries()) {
        const response = scenario.responses[responseId];
        if (!response) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["adaptive_policy", "tactics", index, "response_ids", responseIndex], message: `Unknown approved response ID: ${responseId}` });
        } else if (scenario.review_status === "approved" && response.safety_status !== "reviewed_safe") {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["adaptive_policy", "tactics", index, "response_ids", responseIndex], message: "Released tactics must refer only to reviewed-safe scenario responses." });
        }
      }
    }
  }

  if (scenario.safety_metadata) {
    if (!responseIds.has(scenario.safety_metadata.safe_ending_response_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety_metadata", "safe_ending_response_id"], message: "Safe ending response ID does not exist." });
    } else if (scenario.responses[scenario.safety_metadata.safe_ending_response_id]?.safety_status === "draft") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["safety_metadata", "safe_ending_response_id"], message: "Safe ending response must be a system-safe template or reviewed-safe response." });
    }
  }

  if (rootCount !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "A scenario must have exactly one root node." });
  }

  if ((scenario.reviewed_by === null) !== (scenario.reviewed_at === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewed_by"], message: "Reviewer and review date must either both be present or both be null." });
  }

  if (scenario.review_status === "approved") {
    if (scenario.language === null || scenario.voice_id === null || scenario.reviewed_by === null || scenario.reviewed_at === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["review_status"], message: "Approved scenarios require verified language, voice, reviewer, and review date." });
    }
    for (const [index, node] of scenario.nodes.entries()) {
      if (node.branch_status !== "approved") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "branch_status"], message: "Every released node must be approved." });
      }
    }
    for (const [responseId, response] of Object.entries(scenario.responses)) {
      if (response.safety_status === "draft") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["responses", responseId, "safety_status"], message: "Approved scenarios cannot contain draft responses." });
      }
    }
  }
});

export type ScenarioDocument = z.infer<typeof ScenarioDocumentSchema>;
export type ScenarioNode = ScenarioDocument["nodes"][number];
export type ScenarioBranch = Omit<ScenarioNode, "id" | "parent_node_id" | "safe_fallback_response_id" | "learner_expected_behavior" | "safety_constraints" | "debrief_tags"> & {
  id: string;
  source_node_id: string;
};

export function isConservativeRegex(pattern: string, flags = ""): boolean {
  if (pattern.length > 160 || /[^iu]/.test(flags) || new Set(flags).size !== flags.length) return false;
  if (/\\[1-9]|\(\?[=!<]|\(\?>/.test(pattern)) return false;
  if (/\([^)]*[+*{][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

export function validateScenarioDocument(input: unknown): ScenarioDocument {
  return ScenarioDocumentSchema.parse(input);
}

export function validateScenarioForRelease(input: unknown): ScenarioDocument {
  const scenario = validateScenarioDocument(input);
  if (scenario.review_status !== "approved") {
    throw new Error("Scenario is not approved for release.");
  }
  return scenario;
}
