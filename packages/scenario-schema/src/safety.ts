import { ScenarioDocumentSchema } from "./scenario.js";

export interface ScenarioSafetyOptions {
  knownRealOrganizations: readonly string[];
  forbiddenOperationalPhrases: readonly string[];
}

export interface ScenarioSafetyIssue {
  code: string;
  message: string;
}

export interface ScenarioSafetyResult {
  passed: boolean;
  coverage: "configured-list-only" | "incomplete";
  issues: ScenarioSafetyIssue[];
}

const credentialPatterns: readonly RegExp[] = [
  /\bDUMMY-(?!\d{4}(?![\p{L}\p{N}-]))[\p{L}\p{N}-]+\b/iu,
  /\b(?:otp|one[- ]time\s+password|pin|cvv|cvc|card\s+number|account\s+number)\s*(?:is\s+|[:#=-]\s*)?\d{3,19}\b/i,
  /\b\d{6,19}\b/,
  /\b[A-Z]{5}\d{4}[A-Z]\b/i,
  /(?<!\d)(?:\d[ -]?){9,18}\d(?!\d)/,
  /\b(?:\+?\d{1,3}[ -]?)?(?:\d[ -]?){10}(?!\d)/,
];

const operationalInstructionPatterns: readonly RegExp[] = [
  /\b(?:bypass|evade|disable)\b.{0,60}\b(?:security|fraud|verification|detection|control)s?\b/i,
  /\b(?:install|open|grant)\b.{0,60}\bremote\s+access\b/i,
  /\b(?:send|share|tell|read(?:\s+out)?)\b.{0,40}\b(?:otp|pin|password)\b/i,
];

export function validateScenarioSafety(input: unknown, options?: Partial<ScenarioSafetyOptions>): ScenarioSafetyResult {
  const issues: ScenarioSafetyIssue[] = [];
  const parsed = ScenarioDocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ code: "scenario_schema_invalid", message: `${issue.path.join(".")}: ${issue.message}` });
    }
    return { passed: false, coverage: "incomplete", issues };
  }

  const scenario = parsed.data;
  if (!options?.knownRealOrganizations || options.knownRealOrganizations.length === 0) {
    issues.push({ code: "real_organization_list_not_configured", message: "A reviewer-provided real-organization reference list is required for a release safety pass." });
  }
  if (!options?.forbiddenOperationalPhrases || options.forbiddenOperationalPhrases.length === 0) {
    issues.push({ code: "operational_phrase_list_not_configured", message: "A reviewer-provided forbidden-phrase list is required for a release safety pass." });
  }

  const content = JSON.stringify(scenario);
  for (const name of options?.knownRealOrganizations ?? []) {
    if (name.trim() && includesWholePhrase(content, name)) {
      issues.push({ code: "real_organization_detected", message: "Content contains an organization in the configured real-organization list." });
    }
  }

  for (const pattern of credentialPatterns) {
    if (pattern.test(content)) {
      issues.push({ code: "credential_pattern_detected", message: "Content contains a credential-like or real-looking financial identifier." });
      break;
    }
  }
  for (const pattern of operationalInstructionPatterns) {
    if (pattern.test(content)) {
      issues.push({ code: "operational_instruction_detected", message: "Content contains a pattern associated with operational scam instructions." });
      break;
    }
  }
  for (const phrase of options?.forbiddenOperationalPhrases ?? []) {
    if (phrase.trim() && includesWholePhrase(content, phrase)) {
      issues.push({ code: "forbidden_phrase_detected", message: "Content contains a configured forbidden operational phrase." });
      break;
    }
  }

  if (scenario.learning_objectives.length === 0) {
    issues.push({ code: "learning_objective_missing", message: "At least one learning objective is required." });
  }
  if (scenario.red_flag_ids.length === 0 || scenario.nodes.some((node) => node.debrief_tags.length === 0)) {
    issues.push({ code: "red_flag_mapping_missing", message: "Every scenario node must map to at least one approved red-flag ID." });
  }
  if (scenario.nodes.some((node) => !scenario.responses[node.safe_fallback_response_id])) {
    issues.push({ code: "safe_fallback_missing", message: "Every node must refer to an existing safe fallback response." });
  }

  return {
    passed: issues.length === 0,
    coverage: options?.knownRealOrganizations?.length && options.forbiddenOperationalPhrases?.length ? "configured-list-only" : "incomplete",
    issues,
  };
}

function includesWholePhrase(content: string, phrase: string): boolean {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(content);
  } catch {
    return content.toLocaleLowerCase().includes(phrase.trim().toLocaleLowerCase());
  }
}
