import type { ScenarioBrief } from "@vaccine/contracts";
import { BehaviorTrainingExampleSchema, ScenarioDocumentSchema, validateScenarioSafety, type DraftScenarioPackage, type ScenarioDocument } from "@vaccine/scenario-schema";

export const canonicalTacticIds = ["urgency", "authority", "isolation", "fear", "reward"] as const;
export type CanonicalTacticId = typeof canonicalTacticIds[number];
export type LocalBehavior = "refused" | "stalled" | "verified_independently" | "complied" | "disclosed_dummy_secret";

export interface CallerLine {
  pressureLevel: number;
  intensity: "low" | "medium" | "high";
  text: string;
}

export interface AuthoredTactic {
  id: CanonicalTacticId;
  category: "URGENCY" | "AUTHORITY" | "ISOLATION" | "FEAR_CONSEQUENCE" | "REWARD_FAKE_HELP";
  label: string;
  response: { id: CanonicalTacticId; text: string };
  lines: [CallerLine, CallerLine, CallerLine];
}

export interface DebriefVariant {
  id: LocalBehavior;
  text: string;
}

export interface SafetyCheck {
  id: string;
  label: string;
  status: "PASS" | "WARNING" | "FAIL";
  detail: string;
}

export interface SafetyPreflight {
  checks: SafetyCheck[];
  status: "PASS" | "WARNING" | "FAIL";
  localOnly: true;
}

export interface LocalScenarioDraft {
  scenario: ScenarioDocument;
  brief: ScenarioBrief;
  tactics: AuthoredTactic[];
  trainingExamples: ReturnType<typeof BehaviorTrainingExampleSchema.parse>[];
  debriefVariants: DebriefVariant[];
  safetyPreflight: SafetyPreflight;
}

const tacticDefinitions: ReadonlyArray<Pick<AuthoredTactic, "id" | "category" | "label">> = [
  { id: "urgency", category: "URGENCY", label: "Urgency" },
  { id: "authority", category: "AUTHORITY", label: "Authority impersonation" },
  { id: "isolation", category: "ISOLATION", label: "Secrecy and isolation" },
  { id: "fear", category: "FEAR_CONSEQUENCE", label: "Fear of a consequence" },
  { id: "reward", category: "REWARD_FAKE_HELP", label: "Reward or refund bait" },
];

const callerCopy: Record<CanonicalTacticId, [string, string, string]> = {
  urgency: [
    "Aapko ek pending request ke baare mein update dena tha, jab aap free hon.",
    "Aaj hi is pending request par response chahiye, warna review agle cycle mein jayega.",
    "Aaj response na aaya toh request close ho sakti hai; main status ke liye wait kar raha hoon.",
  ],
  authority: [
    "Main central compliance desk se bol raha hoon, ek request ka status share karna tha.",
    "Compliance team ki taraf se follow-up hai; aaj status close karna hai.",
    "Meri supervisor queue mein case pending dikh rahi hai, is call par status mark karna hoga.",
  ],
  isolation: [
    "Is review ko abhi one-to-one handle kar lete hain.",
    "Filhaal is request ko team chat mein mention na karein; pehle status clear kar lete hain.",
    "Is call ki details abhi kisi aur se discuss mat kijiye; main yahin status note karunga.",
  ],
  fear: [
    "Request pending rahi toh review thoda late ho sakta hai.",
    "Aaj status update na hua toh temporary hold lag sakta hai.",
    "Call ke end tak update na hua toh account access par temporary restriction aa sakti hai.",
  ],
  reward: [
    "Review complete hone par refund status ka update mil jayega.",
    "Aaj request close ho toh refund review mein extra credit consider ho sakta hai.",
    "Is call par review confirm ho jaye toh refund process mein priority note ho sakta hai.",
  ],
};

const behaviorExamples: ReadonlyArray<{ label: Uppercase<LocalBehavior>; utterances: [string, string, string] }> = [
  { label: "REFUSED", utterances: [
    "Main is request ko abhi accept nahi karunga.",
    "Nahi, main is call par koi action nahi lunga.",
    "Main request refuse karta hoon aur call yahin end kar raha hoon.",
  ] },
  { label: "STALLED", utterances: [
    "Ek minute, main pehle details dekh leta hoon.",
    "Thoda ruk jaiye, mujhe request samajhne ke liye waqt chahiye.",
    "Main abhi jawab nahi de raha; pehle ruk kar sochunga.",
  ] },
  { label: "VERIFIED_INDEPENDENTLY", utterances: [
    "Main apne known channel se status check karke bataunga.",
    "Main khud official app khol kar request dekhunga.",
    "Main caller ke diye hue number par wapas call nahi karunga; known contact se confirm karunga.",
  ] },
  { label: "COMPLIED", utterances: [
    "Theek hai, main aapke bataye next step ko maan leta hoon.",
    "Main aapke kehne par request aage badha deta hoon.",
    "Samajh gaya, main abhi aapki instruction follow karta hoon.",
  ] },
  { label: "DISCLOSED_DUMMY_SECRET", utterances: [
    "Demo value DUMMY-4821 share ki.",
    "Maine practice mein DUMMY-0000 dummy value batayi.",
    "Demo ke liye DUMMY-1234 value disclose hui.",
  ] },
];

const debriefCopy: ReadonlyArray<{ id: LocalBehavior; text: string }> = [
  { id: "refused", text: "Aapne {behavior} response diya; reply latency {latency} rahi. Call ke around {timestamp} par request refuse hui." },
  { id: "stalled", text: "Aapne {behavior} response diya; reply latency {latency} rahi. Call ke around {timestamp} par jawab se pehle pause liya." },
  { id: "verified_independently", text: "Aapne {behavior} response diya; reply latency {latency} rahi. Call ke around {timestamp} par independent check ka zikr hua." },
  { id: "complied", text: "Aapne {behavior} response diya; reply latency {latency} rahi. Call ke around {timestamp} par suggested step se sahmati dikhayi." },
  { id: "disclosed_dummy_secret", text: "Aapne {behavior} response diya; reply latency {latency} rahi. Call ke around {timestamp} par demo value share hui." },
];

export const redFlagLabels: Readonly<Record<string, string>> = {
  "RF-01": "Urgency",
  "RF-02": "Authority impersonation",
  "RF-03": "Secrecy",
  "RF-04": "Remote access",
  "RF-05": "OTP/PIN request",
  "RF-06": "UPI/payment credential",
  "RF-07": "Lock/penalty threat",
  "RF-08": "Payment/refund bait",
};

export interface MockEventFacts {
  latency: string;
  timestamp: string;
  behavior: string;
}

export const localMockEventFacts: MockEventFacts = { latency: "612 ms", timestamp: "00:18", behavior: "stalled" };

export function resolveDebriefTemplate(template: string, facts: MockEventFacts): string {
  return template.replace(/\{(latency|timestamp|behavior)\}/gu, (_, key: keyof MockEventFacts) => facts[key]);
}

export function selectPressureLevels(maxPressureLevel: number): [number, number, number] {
  if (!Number.isInteger(maxPressureLevel) || maxPressureLevel < 2 || maxPressureLevel > 5) {
    throw new Error("The mock policy must allow at least three distinct integer pressure levels from 0 to 5.");
  }
  if (maxPressureLevel === 2) return [0, 1, 2];
  if (maxPressureLevel === 3) return [1, 2, 3];
  if (maxPressureLevel === 4) return [2, 3, 4];
  return [1, 3, 5];
}

function createTrainingExamples() {
  return behaviorExamples.flatMap(({ label, utterances }) => utterances.map((utterance, index) => BehaviorTrainingExampleSchema.parse({
    exampleId: `local-${label.toLowerCase()}-${index + 1}`,
    utterance,
    language: "hi-en",
    label,
    split: (["train", "validation", "held_out_test"] as const)[index],
    source: "synthetic",
    redactionReviewed: true,
  })));
}

function createSafetyPreflight(
  scenario: ScenarioDocument,
  tactics: AuthoredTactic[],
  examples: ReturnType<typeof BehaviorTrainingExampleSchema.parse>[],
  variants: DebriefVariant[],
  knownRealOrganizations: readonly string[],
): SafetyPreflight {
  const scanPayload = JSON.stringify({
    opening: scenario.opening_line,
    tactics: tactics.flatMap((tactic) => tactic.lines.map((line) => line.text)),
    examples: examples.map((example) => example.utterance),
    debrief: variants.map((variant) => variant.text),
  });
  const scanScenario = { ...scenario, safety_constraints: [...scenario.safety_constraints, scanPayload] };
  const configuredPhrases = ["disable identity verification", "bypass fraud detection"];
  const scenarioSafety = validateScenarioSafety(scanScenario, {
    knownRealOrganizations,
    forbiddenOperationalPhrases: configuredPhrases,
  });
  const safeMaskedContent = `${JSON.stringify(scanScenario)} ${scanPayload}`.replace(/\bDUMMY-\d{4}\b/giu, "DUMMY-XXXX");
  const hasInvalidDummy = /\bDUMMY-(?!\d{4}\b)\d+\b/iu.test(`${JSON.stringify(scanScenario)} ${scanPayload}`);
  const hasCredential = hasInvalidDummy
    || /\b(?:otp|one[- ]time\s+password|pin|cvv|cvc|card\s+number|account\s+number)\s*[:#=-]?\s*\d{3,19}\b|\b\d{6,19}\b/iu.test(safeMaskedContent)
    || scenarioSafety.issues.some((issue) => issue.code === "credential_pattern_detected");
  const organizationPass = Boolean(scenario.fictional_organization.name.trim()) && scenario.fictional_organization.training_only;
  const brandIssue = scenarioSafety.issues.some((issue) => issue.code === "real_organization_detected");
  const brandConfigured = knownRealOrganizations.some((name) => name.trim());
  const hasOperationalInstruction = scenarioSafety.issues.some((issue) => issue.code === "operational_instruction_detected" || issue.code === "forbidden_phrase_detected");
  const schemaIssue = scenarioSafety.issues.some((issue) => issue.code === "scenario_schema_invalid");
  const disclosurePass = scenario.safety_metadata?.visible_simulation_label === true;
  const checks: SafetyCheck[] = [
    { id: "fictional-organization", label: "Fictional organization", status: organizationPass ? "PASS" : "FAIL", detail: organizationPass ? `${scenario.fictional_organization.name} is marked training-only.` : "A named fictional organization with training-only status is required." },
    { id: "real-brand-scan", label: "Real-brand scan", status: brandIssue ? "FAIL" : brandConfigured ? "PASS" : "WARNING", detail: brandIssue ? "A configured real-organization reference matched this draft." : brandConfigured ? "No configured real-organization name matched this draft." : "No real-organization reference list is configured; coverage is incomplete." },
    { id: "credential-scan", label: "Credential scan", status: hasCredential ? "FAIL" : "PASS", detail: hasCredential ? "Credential-like text or a non-allowlisted dummy value was found." : "No credential values found. Only DUMMY-#### placeholders are allowed." },
    { id: "simulation-disclosure", label: "Simulation disclosure", status: disclosurePass ? "PASS" : "FAIL", detail: disclosurePass ? "Visible simulation labeling is required by the scenario metadata." : "Required visible simulation disclosure is missing." },
    { id: "operational-content", label: "Operational instruction scan", status: hasOperationalInstruction || schemaIssue ? "FAIL" : "PASS", detail: hasOperationalInstruction ? "The content matches a configured operational-risk pattern." : schemaIssue ? "The scenario did not pass structural validation." : "No configured operational-risk phrase matched." },
  ];
  const status = checks.some((check) => check.status === "FAIL") ? "FAIL" : checks.some((check) => check.status === "WARNING") ? "WARNING" : "PASS";
  return { checks, status, localOnly: true };
}

export function normalizeMockDraft(
  draft: DraftScenarioPackage,
  knownRealOrganizations: readonly string[] = [],
): LocalScenarioDraft {
  const sourcePolicy = draft.scenario.adaptive_policy;
  if (!sourcePolicy) throw new Error("The mock package has no configured maximum pressure level.");
  const levels = selectPressureLevels(sourcePolicy.max_pressure_level);
  const tactics: AuthoredTactic[] = tacticDefinitions.map((definition) => {
    const lines = callerCopy[definition.id].map((text, lineIndex) => ({
      pressureLevel: levels[lineIndex]!,
      intensity: (["low", "medium", "high"] as const)[lineIndex]!,
      text,
    })) as [CallerLine, CallerLine, CallerLine];
    return { ...definition, response: { id: definition.id, text: lines[1]!.text }, lines };
  });
  const trainingExamples = createTrainingExamples();
  const debriefVariants = debriefCopy.map((variant) => ({ ...variant }));
  const sourceFallback = draft.scenario.responses["system.safe-fallback"];
  if (!sourceFallback) throw new Error("The mock package is missing its system-safe fallback response.");

  const scenario = ScenarioDocumentSchema.parse({
    ...draft.scenario,
    scenario_id: draft.scenarioBrief.scenarioId,
    version: "0.1.0-local-draft",
    lifecycle_status: "DRAFT",
    language: "hi-en",
    voice_id: null,
    simulation: true,
    opening_line: tactics[0]!.lines[0]!.text,
    learning_objectives: [draft.scenarioBrief.learningObjective],
    red_flag_ids: [...draft.scenarioBrief.redFlags],
    responses: {
      ...Object.fromEntries(tactics.map((tactic) => [tactic.id, { text: tactic.response.text, safety_status: "draft" as const }])),
      "system.safe-fallback": sourceFallback,
    },
    nodes: draft.scenario.nodes.map((node, index) => ({
      ...node,
      response_id: index === 0 ? "urgency" : tactics[(index - 1) % tactics.length]!.id,
      safe_fallback_response_id: "system.safe-fallback",
      debrief_tags: [...draft.scenarioBrief.redFlags],
      branch_status: "draft",
    })),
    adaptive_policy: {
      ...sourcePolicy,
      tactics: tactics.map((tactic) => ({
        tactic_id: tactic.id,
        category: tactic.category,
        pressure_level: tactic.lines[1]!.pressureLevel,
        prompts_dummy_secret: false,
        behavior_targets: ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY", "COMPLIED", "DISCLOSED_DUMMY_SECRET"],
        response_ids: [tactic.response.id],
      })),
    },
    review_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
  });
  const safetyPreflight = createSafetyPreflight(scenario, tactics, trainingExamples, debriefVariants, knownRealOrganizations);
  return { scenario, brief: draft.scenarioBrief, tactics, trainingExamples, debriefVariants, safetyPreflight };
}

export function renderDebriefPreview(variant: DebriefVariant, facts: MockEventFacts = localMockEventFacts): string {
  return resolveDebriefTemplate(variant.text, facts);
}
