import { BehaviorLabelSchema, RedFlagIdSchema, ScenarioBriefSchema } from "@vaccine/contracts";
import { z } from "zod";
import { DraftScenarioPackageSchema } from "./authoring.js";
import { validateScenarioSafety, type ScenarioSafetyOptions } from "./safety.js";

export const draftJsonLimit = 160 * 1024;
export const tacticCategories = {
  urgency: "URGENCY", authority: "AUTHORITY", isolation: "ISOLATION",
  fear: "FEAR_CONSEQUENCE", reward: "REWARD_FAKE_HELP",
} as const;
export const authoredIntensities = ["low", "medium", "high"] as const;
export const draftOutcomes = ["SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "SAFE_FALLBACK", "MAX_TURNS"] as const;
export const draftBehaviors = BehaviorLabelSchema.options;
export const reservedScenarioIds: ReadonlySet<string> = new Set(["S-01", "S-02", "S-03"]);

export const draftErrorMessages = {
  INVALID_AUTHORING_BRIEF: "Check the brief fields, supported options, scenario ID and draft version.",
  UNSUPPORTED_TEMPLATE: "Select fictional-benefits-verification version 1.0.0, or use manual import.",
  INVALID_IMPORT_JSON: "Select a nonempty, well-formed UTF-8 JSON file.",
  DUPLICATE_JSON_KEY: "JSON object keys must be unique.",
  IMPORT_TOO_LARGE: "The JSON file exceeds the 160 KiB limit.",
  UNSUPPORTED_IMPORT_FORMAT: "Use Phase 6A candidate JSON with schemaVersion 1.",
  INVALID_DRAFT_SCHEMA: "The candidate has missing, invalid, or unrecognized fields.",
  INVALID_CANDIDATE_REFERENCE: "Candidate references, coverage, or pressure metadata do not agree.",
  DUPLICATE_RESPONSE_ID: "Each candidate response ID must occur once in the response list.",
  UNAUTHORIZED_LIFECYCLE_STATUS: "Only pending, unreviewed DRAFT content is accepted.",
  UNSAFE_DRAFT_CONTENT: "A configured organization, credential-like value, or operational instruction matched the basic intake scan.",
  INVALID_DRAFT_PATH: "Use a local JSON file or a valid saved candidate ID.",
  CANDIDATE_ALREADY_EXISTS: "This source already has a record for identical candidate content.",
  DRAFT_STORAGE_FAILED: "The draft could not be saved or loaded.",
} as const;

export class DraftAuthoringError extends Error {
  constructor(readonly code: keyof typeof draftErrorMessages, field?: string) {
    super(draftErrorMessages[code] + (field ? ` Field: ${field}.` : ""));
    this.name = "DraftAuthoringError";
  }
}

const copy = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/\b(?:TODO|Lorem ipsum|TBD)\b/iu.test(value));
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,79}$/u);
const version = z.string().regex(/^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const tactic = z.enum(["urgency", "authority", "isolation", "fear", "reward"]);
const outcome = z.enum(draftOutcomes);
const script = z.enum(["Devanagari", "Latin"]);
const pressure = z.number().int().min(0).max(5);
const scenarioId = z.string().regex(/^S-\d{2}$/u).refine((value) => !reservedScenarioIds.has(value));

export const MockDraftBriefSchema = ScenarioBriefSchema.extend({
  scenarioId,
  learningObjective: z.enum(["verify-through-known-channel", "pause-before-confirming"]),
  redFlags: z.array(RedFlagIdSchema).max(8).optional(),
  language: z.literal("hi-en"),
  title: copy(100),
  draftVersion: version,
  templateFamily: z.literal("fictional-benefits-verification"),
  templateVersion: z.literal("1.0.0"),
  audience: z.enum(["new employees", "all employees"]),
  difficulty: z.enum(["introductory", "intermediate"]),
  scriptPreference: script,
  maxLearnerTurns: z.union([z.literal(2), z.literal(3)]),
}).strict();
export type MockDraftBrief = z.infer<typeof MockDraftBriefSchema>;

const variant = z.object({
  responseId: id, tactic, intensity: z.enum(authoredIntensities), pressureLevel: pressure, script,
  redFlags: z.array(RedFlagIdSchema).min(1).max(8), educationalPurpose: copy(240),
}).strict();

const terminalResponses = z.object({
  SAFE_VERIFIED: id, DUMMY_SECRET_DISCLOSED: id, SAFE_FALLBACK: id, MAX_TURNS: id,
}).strict();

const route = z.discriminatedUnion("action", [
  z.object({ behavior: BehaviorLabelSchema, action: z.literal("continue"), nextNodeId: id }).strict(),
  z.object({ behavior: BehaviorLabelSchema, action: z.literal("terminal"), outcome }).strict(),
]);

const DraftDetailsSchema = z.object({
  title: copy(100), department: copy(100), industry: copy(100), audience: copy(100),
  difficulty: z.enum(["introductory", "intermediate"]),
  premise: copy(500), register: copy(120), scriptPreference: script,
  safeActions: z.array(copy(240)).min(2).max(8),
  openingResponseId: id,
  variants: z.array(variant).length(15),
  redFlags: z.array(z.object({
    id: RedFlagIdSchema, title: copy(100), description: copy(240),
    tactics: z.array(tactic).min(1).max(5), safeAction: copy(240),
  }).strict()).min(5).max(8),
  examples: z.array(z.object({
    exampleId: id, script, interpretation: copy(240),
    decision: z.enum(["continue", "SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "SAFE_FALLBACK"]),
  }).strict()).min(18).max(36),
  decisionPoints: z.array(z.object({
    nodeId: id, turn: z.number().int().min(1).max(3), context: copy(240),
    routes: z.array(route).length(draftBehaviors.length),
  }).strict()).min(2).max(3),
  terminalResponses,
  stopGuidance: copy(240),
  debriefs: z.array(z.object({
    templateId: id, behavior: BehaviorLabelSchema.nullable(), outcome: outcome.nullable(),
    redFlags: z.array(RedFlagIdSchema).min(1).max(8), scoring: copy(300),
    nextAction: copy(240), limitations: copy(240), takeaway: copy(240),
  }).strict()).min(5).max(12),
}).strict();

export const AuthoringCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  draft: DraftScenarioPackageSchema,
  details: DraftDetailsSchema,
  declaredOrigin: copy(120).optional(),
}).strict();
const CandidateSchema = AuthoringCandidateSchema;

const candidateId = z.string().regex(/^(?:mock|import)-[0-9a-f]{64}$/u);
export const draftJsonFilename = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.()-]{0,114}\.json$/iu;
export const SavedDraftSchema = z.object({
  candidateId,
  createdAt: z.string().datetime(),
  contentHash: hash,
  previousCandidateId: candidateId.nullable(),
  structuralValidation: z.literal("PASS"),
  provenance: z.discriminatedUnion("source", [
    z.object({
      source: z.literal("DETERMINISTIC_MOCK"), templateFamily: z.literal("fictional-benefits-verification"),
      templateVersion: z.literal("1.0.0"), briefFingerprint: hash, generatorVersion: version,
    }).strict(),
    z.object({
      source: z.literal("MANUAL_IMPORT"), originalFilename: z.string().regex(draftJsonFilename),
      sourceFingerprint: hash, declaredOrigin: copy(120).nullable(), verification: z.literal("UNVERIFIED"),
    }).strict(),
  ]),
  candidate: CandidateSchema,
}).strict();
export type AuthoringCandidate = z.infer<typeof CandidateSchema>;
export type SavedDraft = z.infer<typeof SavedDraftSchema>;

function safeField(path: (string | number)[]) {
  return path.filter((part) => /^[a-zA-Z0-9_.-]{1,80}$/u.test(String(part))).join(".");
}

export function parseDraftJson(bytes: Uint8Array): unknown {
  if (bytes.length > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
  let parsed: unknown;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new DraftAuthoringError("INVALID_IMPORT_JSON");
  }
  const stack: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++visited > 12_000 || depth > 20 || (Array.isArray(value) && value.length > 128)) {
      throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
    }
    if (value === null || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
      }
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  rejectDuplicateKeys(text);
  return parsed;
}

function rejectDuplicateKeys(json: string) {
  // JSON.parse has already verified the grammar. Quoted tokens followed by a colon are object keys.
  const scopes: (Set<string> | null)[] = [];
  let quoted = "";
  for (const [token] of json.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/gsu)) {
    if (token.startsWith('"')) quoted = token;
    else if (token === "{") scopes.push(new Set());
    else if (token === "[") scopes.push(null);
    else if (token === "}" || token === "]") scopes.pop();
    else if (token === ":") {
      const keys = scopes.at(-1)!;
      const key: string = JSON.parse(quoted);
      if (keys.has(key)) throw new DraftAuthoringError("DUPLICATE_JSON_KEY");
      keys.add(key);
    }
  }
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return Object.fromEntries(entries.map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
};
export const canonicalDraftJson = (value: unknown): string => JSON.stringify(stableValue(value));
const same = (left: unknown, right: unknown) => canonicalDraftJson(left) === canonicalDraftJson(right);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const sameSet = <T>(left: T[], right: T[]) =>
  left.length === right.length && unique(left) && left.every((item) => right.includes(item));
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function rejectLifecycleClaims(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(rejectLifecycleClaims);
    return;
  }
  for (const [key, entry] of Object.entries(record(value))) {
    const incompatible = (key === "status" || key === "lifecycle_status") && entry !== "DRAFT"
      || (key === "review_status" || key === "branch_status") && entry !== "draft"
      || key === "safety_status" && entry === "reviewed_safe"
      || key === "decision" && (entry === "approved" || entry === "rejected")
      || key === "runtimeEligible" && entry !== false
      || ["reviewerId", "reviewedAt", "reviewed_by", "reviewed_at", "voice_id"].includes(key) && entry !== null;
    if (incompatible) throw new DraftAuthoringError("UNAUTHORIZED_LIFECYCLE_STATUS");
    if (entry && typeof entry === "object") rejectLifecycleClaims(entry);
  }
}

const strictBriefProjection = ScenarioBriefSchema.strict();
const strictDraftTrigger = z.object({ type: z.literal("normalized_text"), text: copy(180) }).strict();

export function parseAuthoringCandidate(value: unknown, safety: ScenarioSafetyOptions): AuthoringCandidate {
  rejectLifecycleClaims(value);
  const raw = record(value);
  if (raw.schemaVersion !== 1) throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
  const rawDraft = record(raw.draft);
  if (!strictBriefProjection.safeParse(rawDraft.scenarioBrief).success) {
    throw new DraftAuthoringError("INVALID_DRAFT_SCHEMA", "draft.scenarioBrief");
  }
  const rawNodes = record(record(rawDraft.scenario)).nodes;
  const containsUnsupportedTriggers = (nodes: unknown) => Array.isArray(nodes)
    && nodes.some((node) => !z.array(strictDraftTrigger).safeParse(record(node).trigger_rules).success);
  if (containsUnsupportedTriggers(rawNodes) || (Array.isArray(rawDraft.importableArtifacts)
    && rawDraft.importableArtifacts.some((artifact) => containsUnsupportedTriggers(record(record(artifact).scenario).nodes)))) {
    throw new DraftAuthoringError("INVALID_DRAFT_SCHEMA", "draft.scenario.nodes.trigger_rules");
  }
  const parsed = CandidateSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new DraftAuthoringError(issue.code === "custom" ? "INVALID_CANDIDATE_REFERENCE" : "INVALID_DRAFT_SCHEMA", safeField(issue.path));
  }
  const candidate = parsed.data;
  const { draft, details } = candidate;
  const { scenario, scenarioBrief, review } = draft;
  const ref = (valid: boolean, field: string) => {
    if (!valid) throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", field);
  };
  if (Object.values(review.checklist).some(Boolean)) throw new DraftAuthoringError("UNAUTHORIZED_LIFECYCLE_STATUS");
  if (!scenarioId.safeParse(scenario.scenario_id).success || !version.safeParse(scenario.version).success
    || draft.packageId !== `${scenario.scenario_id}-${scenario.version}-draft` || draft.target !== "offline_pre_generated") {
    throw new DraftAuthoringError("INVALID_DRAFT_SCHEMA", "draft.scenario");
  }
  if (!unique(draft.candidateApprovedResponses.map((response) => response.responseId))) {
    throw new DraftAuthoringError("DUPLICATE_RESPONSE_ID");
  }

  const policy = scenario.adaptive_policy;
  ref(Boolean(policy) && scenario.language === "hi-en" && scenarioBrief.language === scenario.language
    && scenario.learning_objectives.includes(scenarioBrief.learningObjective)
    && /^Fictional\s/iu.test(scenario.fictional_organization.name)
    && sameSet(scenario.red_flag_ids, scenarioBrief.redFlags)
    && sameSet(scenario.red_flag_ids, details.redFlags.map((flag) => flag.id)), "draft.scenario");
  if (!policy) throw new DraftAuthoringError("INVALID_DRAFT_SCHEMA");
  const responses = scenario.responses;
  const ids = Object.keys(responses);
  const allowedSafeIds = ["system.safe-fallback", "system.safe-ending"];
  ref(allowedSafeIds.every((key) => responses[key]?.safety_status === "system_safe_template")
    && ids.every((key) => id.safeParse(key).success
      && responses[key]!.safety_status === (allowedSafeIds.includes(key) ? "system_safe_template" : "draft")
      && responses[key]!.text.length <= 280 && copy(280).safeParse(responses[key]!.text).success
      && scriptMatches(responses[key]!.text, details.scriptPreference)), "draft.scenario.responses");
  ref(scenario.safety_metadata?.safe_ending_response_id === "system.safe-ending"
    && scenario.opening_line === responses[details.openingResponseId]?.text
    && !allowedSafeIds.includes(details.openingResponseId), "details.openingResponseId");
  ref(sameSet(ids, draft.candidateApprovedResponses.map((response) => response.responseId))
    && draft.candidateApprovedResponses.every((response) =>
      response.text === responses[response.responseId]?.text && response.language === scenario.language),
  "draft.candidateApprovedResponses");
  ref(draft.importableArtifacts.length === 1 && same(draft.importableArtifacts[0]?.scenario, scenario),
    "draft.importableArtifacts");

  const variantIds = details.variants.map((item) => item.responseId);
  const terminalIds = Object.values(details.terminalResponses);
  ref(unique(terminalIds) && terminalIds.every((key) => ids.includes(key))
    && terminalIds.every((key) => !allowedSafeIds.includes(key) || key === "system.safe-fallback")
    && details.terminalResponses.SAFE_FALLBACK === "system.safe-fallback"
    && sameSet(ids, [...variantIds, ...terminalIds, details.openingResponseId, "system.safe-ending"])
    && unique(details.variants.map((item) => responses[item.responseId]?.text)), "details.variants");
  ref(sameSet(variantIds, policy.tactics.flatMap((item) => item.response_ids))
    && sameSet(variantIds, draft.tacticPool.flatMap((item) => item.responseIds)), "draft.tacticPool");
  for (const key of tactic.options) {
    const variants = details.variants.filter((item) => item.tactic === key);
    ref(sameSet(variants.map((item) => item.intensity), [...authoredIntensities])
      && authoredIntensities.every((intensity, index) => variants.find((item) => item.intensity === intensity)?.pressureLevel === index + 1),
    "details.variants.intensity");
  }
  for (const item of details.variants) {
    const configured = policy.tactics.find((entry) => entry.tactic_id === item.responseId);
    const pooled = draft.tacticPool.find((entry) => entry.tacticId === item.responseId);
    ref(Boolean(configured && pooled && configured.category === tacticCategories[item.tactic]
      && pooled.category === configured.category && pooled.pressureLevel === item.pressureLevel
      && configured.pressure_level === item.pressureLevel && same(configured.response_ids, [item.responseId])
      && same(pooled.responseIds, [item.responseId]) && !configured.prompts_dummy_secret
      && scriptMatches(responses[item.responseId]?.text ?? "", item.script)
      && item.script === details.scriptPreference && unique(item.redFlags)
      && item.redFlags.every((flag) => details.redFlags.some((entry) => entry.id === flag && entry.tactics.includes(item.tactic)))),
    "details.variants.references");
  }
  ref(policy.max_pressure_level === 3 && details.redFlags.every((flag) =>
    unique(flag.tactics) && flag.tactics.every((key) =>
      details.variants.some((item) => item.tactic === key && item.redFlags.includes(flag.id)))),
  "details.redFlags");
  validateFlow(candidate, ref);

  const examples = draft.behaviorTrainingExamples;
  ref(same(draft.candidateUtterances, examples) && sameSet(examples.map((entry) => entry.exampleId), details.examples.map((entry) => entry.exampleId))
    && unique(examples.map((entry) => entry.utterance))
    && draftBehaviors.every((label) => examples.filter((entry) => entry.label === label).length >= 3),
  "draft.behaviorTrainingExamples");
  for (const entry of examples) {
    const metadata = details.examples.find((item) => item.exampleId === entry.exampleId);
    ref(Boolean(metadata && metadata.decision === (outcomeFor(entry.label) ?? "continue")
      && scriptMatches(entry.utterance, metadata.script) && entry.source === "synthetic"
      && /\bDUMMY-\d{4}\b/u.test(entry.utterance) === (entry.label === "DISCLOSED_DUMMY_SECRET")),
    "details.examples");
  }
  const templates = draft.debriefTemplateVariants;
  ref(sameSet(templates.map((entry) => entry.templateId), details.debriefs.map((entry) => entry.templateId))
    && unique(templates.map((entry) => entry.text))
    && templates.every((entry) => copy(600).safeParse(entry.text).success && entry.language === "hi-en")
    && draftOutcomes.every((expected) => details.debriefs.some((entry) => entry.outcome === expected))
    && ["REFUSED", "STALLED"].every((label) => details.debriefs.some((entry) => entry.behavior === label && entry.outcome === null))
    && details.debriefs.every((entry) => (entry.behavior !== null || entry.outcome !== null)
      && entry.redFlags.every((flag) => scenario.red_flag_ids.includes(flag))), "details.debriefs");

  // Scan authored strings with the existing configured-list lint. No release decision is derived from it.
  const scanText = canonicalDraftJson(candidate).normalize("NFKC")
    .replace(/[०-९]/gu, (digit) => String(digit.codePointAt(0)! - 0x966));
  const scan = validateScenarioSafety({ ...scenario, safety_constraints: [...scenario.safety_constraints, scanText] }, safety);
  if (scan.issues.some((issue) => [
    "credential_pattern_detected", "real_organization_detected", "operational_instruction_detected", "forbidden_phrase_detected",
  ].includes(issue.code))) throw new DraftAuthoringError("UNSAFE_DRAFT_CONTENT");
  return candidate;
}

function scriptMatches(value: string, expected: z.infer<typeof script>) {
  return /\p{Script=Devanagari}/u.test(value) === (expected === "Devanagari");
}

export function outcomeFor(behavior: z.infer<typeof BehaviorLabelSchema>) {
  if (behavior === "VERIFIED_INDEPENDENTLY") return "SAFE_VERIFIED" as const;
  if (behavior === "DISCLOSED_DUMMY_SECRET") return "DUMMY_SECRET_DISCLOSED" as const;
  if (behavior === "UNKNOWN") return "SAFE_FALLBACK" as const;
  return null;
}

function validateFlow({ draft: { scenario }, details }: AuthoringCandidate, ref: (valid: boolean, field: string) => void) {
  const policy = scenario.adaptive_policy!;
  const { decisionPoints: points } = details;
  ref(points.length === policy.max_turns && points.length === scenario.nodes.length
    && ["SAFE_WORD", "LEARNER_ENDED", ...draftOutcomes].every((expected) =>
      policy.terminal_states.some((state) => state === expected)), "details.decisionPoints");
  for (const [index, point] of points.entries()) {
    const node = scenario.nodes.find((entry) => entry.id === point.nodeId);
    const previous = points[index - 1]?.nodeId ?? null;
    const next = points[index + 1]?.nodeId ?? null;
    ref(Boolean(node && point.turn === index + 1 && node.parent_node_id === previous
      && node.next_node_id === next && node.safe_fallback_response_id === "system.safe-fallback"
      && node.learner_expected_behavior.some((line) => copy(240).safeParse(line).success)
      && node.debrief_tags.every((flag) => scenario.red_flag_ids.includes(flag))
      && node.trigger_rules.every((rule) => strictDraftTrigger.safeParse(rule).success)
      && (index === 0 ? node.response_id === details.openingResponseId
        : details.variants.some((entry) => entry.responseId === node.response_id))
      && sameSet(point.routes.map((entry) => entry.behavior), [...draftBehaviors])), "details.decisionPoints.nodeId");
    for (const route of point.routes) {
      const expected = !next && route.behavior === "UNKNOWN" ? "MAX_TURNS" : outcomeFor(route.behavior) ?? (next ? null : "MAX_TURNS");
      ref(expected === null ? route.action === "continue" && route.nextNodeId === next
        : route.action === "terminal" && route.outcome === expected, "details.decisionPoints.routes");
    }
  }
}

export function parseSavedDraft(value: unknown, safety: ScenarioSafetyOptions): SavedDraft {
  const candidate = parseAuthoringCandidate(record(value).candidate, safety);
  const parsed = SavedDraftSchema.safeParse({ ...record(value), candidate });
  if (!parsed.success) throw new DraftAuthoringError("INVALID_DRAFT_SCHEMA", safeField(parsed.error.issues[0]!.path));
  const saved = parsed.data;
  const manual = saved.provenance.source === "MANUAL_IMPORT";
  if (saved.candidateId !== `${manual ? "import" : "mock"}-${saved.contentHash}`
    || saved.previousCandidateId === saved.candidateId
    || (saved.provenance.source === "MANUAL_IMPORT" && saved.provenance.declaredOrigin !== (candidate.declaredOrigin ?? null))
    || (!manual && candidate.declaredOrigin !== undefined)) {
    throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", "provenance");
  }
  return saved;
}
