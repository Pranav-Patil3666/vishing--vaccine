import { z, type ZodIssue } from "zod";
import { authoringRules, type AddAuthoringFinding, type AuthoringFinding, type AuthoringRuleId } from "./authoringRules.js";
import { affirmativeMatch, independentCue, inspectDebriefClaim, scanAuthoringText, simulationCue, stopCue } from "./authoringContentSafety.js";
import {
  AuthoringCandidateSchema, canonicalDraftJson, draftBehaviors, draftOutcomes, DraftAuthoringError, draftJsonLimit,
  offlineAdaptiveMockGeneratorVersion, outcomeFor, parseAuthoringCandidate, parseDraftJson, SavedDraftSchema, tacticCategories,
  type AuthoringCandidate, type SavedDraft,
} from "./phase6Draft.js";
import type { ScenarioSafetyOptions } from "./safety.js";

export const authoringValidationVersion = "1.0.0";
export interface AuthoringGraphSummary {
  complete: boolean;
  reachablePrefixes: number;
  terminalLeaves: number;
  maximumDepth: number;
  reachableResponseIds: string[];
  reachablePressures: number[];
  unreachableAuthoredVariants: string[];
}
export interface AuthoringValidationResult {
  candidateId: string | null;
  scenarioId: string | null;
  scenarioVersion: string | null;
  schemaVersion: number | null;
  validationVersion: string;
  checkedAt: string;
  sourceHash: string | null;
  policyHash: string | null;
  status: "PASS" | "WARN" | "FAIL";
  structuralValidation: "PASS" | "FAIL";
  reviewEligible: boolean;
  summary: { errors: number; warnings: number; info: number };
  findings: AuthoringFinding[];
  graph: AuthoringGraphSummary | null;
}
export interface AuthoringValidationOptions {
  safety: ScenarioSafetyOptions;
  checkedAt?: string;
  lineage?: readonly unknown[];
}

export const AuthoringValidationResultSchema: z.ZodType<AuthoringValidationResult> = z.object({
  candidateId: z.string().nullable(), scenarioId: z.string().nullable(), scenarioVersion: z.string().nullable(),
  schemaVersion: z.number().int().nullable(), validationVersion: z.string(),
  checkedAt: z.string().datetime(), sourceHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  policyHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(), status: z.enum(["PASS", "WARN", "FAIL"]),
  structuralValidation: z.enum(["PASS", "FAIL"]), reviewEligible: z.boolean(),
  summary: z.object({ errors: z.number().int().nonnegative(), warnings: z.number().int().nonnegative(), info: z.number().int().nonnegative() }).strict(),
  findings: z.array(z.object({
    ruleId: z.custom<AuthoringRuleId>((value) => typeof value === "string" && Object.hasOwn(authoringRules, value)),
    severity: z.enum(["ERROR", "WARNING", "INFO"]),
    category: z.enum(["INPUT", "SCHEMA", "IDENTITY", "PROVENANCE", "SAFETY", "TACTIC", "PRESSURE", "RESPONSE", "GRAPH", "LANGUAGE", "BEHAVIOR", "RED_FLAG", "GUIDANCE", "DEBRIEF"]),
    path: z.string(), message: z.string(), remediation: z.string(),
  }).strict()).max(81),
  graph: z.object({
    complete: z.boolean(), reachablePrefixes: z.number().int().nonnegative(), terminalLeaves: z.number().int().nonnegative(),
    maximumDepth: z.number().int().nonnegative(), reachableResponseIds: z.array(z.string()),
    reachablePressures: z.array(z.number().int().min(0).max(5)), unreachableAuthoredVariants: z.array(z.string()),
  }).strict().nullable(),
}).strict();

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const equal = (a: unknown, b: unknown) => canonicalDraftJson(a) === canonicalDraftJson(b);
const validId = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,79}$/u;
type CandidateContent = Pick<AuthoringCandidate, "draft" | "details">;
class UnsafeAuthoringData extends Error {}
const validVersion = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/u;
const duplicate = <T>(items: T[]) => new Set(items).size !== items.length;
const sameIds = (a: string[], b: string[]) => !duplicate(a) && !duplicate(b) && a.length === b.length && a.every((id) => b.includes(id));
const pathToken = /^(?:[a-zA-Z_][a-zA-Z_0-9]{0,49}|[0-9]+|(?:system|ending|urgency|authority|isolation|fear|reward)\.[a-z.-]{1,32})$/u;

export function authoringPointer(parts: (string | number)[]) {
  return parts.length ? "/" + parts.map((part, index) => {
    if (parts[index - 1] === "responses") {
      return /^(?:system\.(?:opening|safe-ending|safe-fallback)|ending\.(?:verified|dummy|turn-limit)|(?:urgency|authority|isolation|fear|reward)\.(?:low|medium|high))$/u.test(String(part)) ? String(part) : "*";
    }
    return pathToken.test(String(part)) ? String(part) : "*";
  }).join("/") : "/";
}

export async function hashAuthoringData(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalDraftJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function boundedData(value: unknown) {
  const active = new Set<object>();
  const strings: { text: string; path: (string | number)[] }[] = [];
  const stack: { value: unknown; path: (string | number)[]; leave?: boolean }[] = [{ value, path: [] }];
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    const current = entry.value;
    if (entry.leave) { active.delete(current as object); continue; }
    if (++nodes > 12_000 || entry.path.length > 20) throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
    if (typeof current === "string") {
      if (current.length > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
      strings.push({ text: current, path: entry.path });
    } else if (current !== null && typeof current === "object") {
      if (active.has(current) || (Array.isArray(current) && current.length > 128)) {
        throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
      }
      if (!Array.isArray(current) && ![Object.prototype, null].includes(Object.getPrototypeOf(current))) {
        throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
      }
      active.add(current);
      stack.push({ value: current, path: entry.path, leave: true });
      if (Object.getOwnPropertySymbols(current).length) throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
      for (const key of Object.getOwnPropertyNames(current).sort().reverse()) {
        if (Array.isArray(current) && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (["__proto__", "prototype", "constructor"].includes(key) || descriptor.get || descriptor.set) {
          throw new UnsafeAuthoringData();
        }
        stack.push({ value: descriptor.value, path: [...entry.path, key] });
      }
    } else if (current !== null && typeof current !== "boolean"
      && (typeof current !== "number" || !Number.isFinite(current))) {
      throw new DraftAuthoringError("UNSUPPORTED_IMPORT_FORMAT");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
  return strings;
}

function collector() {
  const findings: AuthoringFinding[] = [];
  const seen = new Set<string>();
  const add: AddAuthoringFinding = (ruleId, path) => {
    const pointer = authoringPointer(path);
    const key = ruleId + pointer;
    if (seen.has(key)) return;
    seen.add(key);
    if (findings.length >= 80) {
      if (!findings.some((finding) => finding.ruleId === "FINDING_LIMIT")) {
        findings.push({ ruleId: "FINDING_LIMIT", ...authoringRules.FINDING_LIMIT, path: "/" });
      }
      return;
    }
    findings.push({ ruleId, ...authoringRules[ruleId], path: pointer });
  };
  return { findings, add };
}

function schemaRule(issue: ZodIssue): AuthoringRuleId {
  const path = issue.path.map(String);
  const last = path.at(-1) ?? "";
  if (["status", "runtimeEligible", "lifecycle_status", "review_status", "reviewerId", "reviewedAt"].some((key) => path.includes(key))) return "LIFECYCLE_FORGED";
  if (path.includes("schemaVersion")) return "SCHEMA_VERSION";
  if (path.some((key) => ["pressureLevel", "pressure_level", "max_pressure_level"].includes(key))) return "PRESSURE_RANGE";
  if (["language", "script", "scriptPreference"].includes(last)) return "LANGUAGE_INVALID";
  if (path.includes("variants") && issue.code === "too_small" || path.includes("variants") && issue.code === "too_big") return "TACTIC_COVERAGE";
  if (["tactic", "category", "intensity"].includes(last)) return "TACTIC_METADATA";
  if (path.includes("debriefs") || path.includes("debriefTemplateVariants")) return "DEBRIEF_COVERAGE";
  if (path.includes("safeActions")) return "GUIDANCE_MISSING";
  if (path.includes("terminalResponses") || ["response_id", "response_ids", "safe_fallback_response_id", "safe_ending_response_id"].includes(last)) return "RESPONSE_MISSING";
  if (path.includes("next_node_id") || path.includes("parent_node_id")) return "GRAPH_TARGET";
  if (last === "max_turns" || last === "turn") return "GRAPH_TURN";
  if (path.includes("nodes") && issue.code === "custom") return "GRAPH_ID";
  if (last === "scenarioId" || last === "scenario_id") return "IDENTITY_INVALID";
  if (last === "label" || last === "behavior") return "BEHAVIOR_MAPPING";
  if (last === "utterance" && issue.code === "custom") return "SENSITIVE_VALUE";
  if (last === "opening_line") return "RESPONSE_MISSING";
  return "SCHEMA_INVALID";
}

export async function validateAuthoringDraft(input: unknown, options: AuthoringValidationOptions): Promise<AuthoringValidationResult> {
  const { findings, add } = collector();
  let sourceHash: string | null = null, policyHash: string | null = null;
  let candidateId: string | null = null, scenarioId: string | null = null, scenarioVersion: string | null = null;
  let schemaVersion: number | null = null, structuralValidation: "PASS" | "FAIL" = "FAIL";
  let graph: AuthoringGraphSummary | null = null;
  let verifiedRecord = false;
  try {
    const value = input instanceof Uint8Array ? parseDraftJson(input) : input;
    boundedData(value);
    const object = asObject(value);
    const isSaved = Object.hasOwn(object, "candidate");
    const addCandidate: AddAuthoringFinding = (rule, path) => add(rule, isSaved ? ["candidate", ...path] : path);
    const candidateValue = isSaved ? object.candidate : value;
    const raw = asObject(candidateValue);
    const candidateStrings = boundedData(candidateValue);
    sourceHash = await hashAuthoringData(candidateValue);
    const scenario = asObject(asObject(raw.draft).scenario);
    candidateId = typeof object.candidateId === "string" && /^(mock|import)-[0-9a-f]{64}$/u.test(object.candidateId) ? object.candidateId : null;
    scenarioId = typeof scenario.scenario_id === "string" && /^S-\d{2}$/u.test(scenario.scenario_id) ? scenario.scenario_id : null;
    scenarioVersion = typeof scenario.version === "string" && validVersion.test(scenario.version) ? scenario.version : null;
    schemaVersion = typeof raw.schemaVersion === "number" && Number.isSafeInteger(raw.schemaVersion) ? raw.schemaVersion : null;
    const config = options.safety;
    if (!config || ![config.knownRealOrganizations, config.forbiddenOperationalPhrases].every((list) =>
      Array.isArray(list) && list.length > 0 && list.length <= 64
      && list.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 160))) {
      add("REFERENCE_CONFIG", []);
    } else {
      policyHash = await hashAuthoringData(config);
      scanAuthoringText(candidateStrings, config, addCandidate);
    }
    const parsed = AuthoringCandidateSchema.safeParse(candidateValue);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) addCandidate(schemaRule(issue), issue.path);
    } else {
      const candidate = parsed.data;
      structuralValidation = "PASS";
      inspectCandidate(candidate, addCandidate);
      graph = inspectGraph(candidate, addCandidate);
      if (isSaved) {
        const savedResult = SavedDraftSchema.safeParse(value);
        if (!savedResult.success) {
          for (const issue of savedResult.error.issues) {
            if (issue.path[0] !== "candidate") add("PROVENANCE_INVALID", issue.path);
          }
        } else {
          const saved = savedResult.data;
          const manual = saved.provenance.source === "MANUAL_IMPORT";
          verifiedRecord = true;
          if (saved.contentHash !== sourceHash || saved.candidateId !== `${manual ? "import" : "mock"}-${sourceHash}`) {
            add("HASH_MISMATCH", ["contentHash"]);
          }
          if (saved.provenance.source === "MANUAL_IMPORT" ? saved.provenance.declaredOrigin !== (candidate.declaredOrigin ?? null) : candidate.declaredOrigin !== undefined) {
            add("PROVENANCE_INVALID", ["provenance"]);
          }
          const expectedGeneratorVersion = candidate.details.runtimeProfile === "offline-adaptive-v1" ? offlineAdaptiveMockGeneratorVersion : "1.0.0";
          if (saved.provenance.source === "DETERMINISTIC_MOCK" && saved.provenance.generatorVersion !== expectedGeneratorVersion) {
            add("PROVENANCE_INVALID", ["provenance", "generatorVersion"]);
          }
          if (manual && /evon|gnani|model|llm|inference/iu.test(candidate.declaredOrigin ?? "")) {
            add("ORIGIN_UNVERIFIED", ["candidate", "declaredOrigin"]);
          }
          await inspectLineage(saved, options.lineage ?? [], add);
          // Also scan imported record metadata, using the same sensitive-data rules and safe paths.
          if (policyHash) {
            const metadata = saved.provenance.source === "MANUAL_IMPORT"
              ? { originalFilename: saved.provenance.originalFilename, declaredOrigin: saved.provenance.declaredOrigin }
              : { templateFamily: saved.provenance.templateFamily };
            scanAuthoringText(boundedData({ provenance: metadata }), config, add);
          }
        }
      } else {
        add("RECORD_REQUIRED", []);
        if (/evon|gnani|model|llm|inference/iu.test(candidate.declaredOrigin ?? "")) add("ORIGIN_UNVERIFIED", ["declaredOrigin"]);
      }
      if (!findings.some((finding) => finding.severity === "ERROR")) {
        try { parseAuthoringCandidate(candidateValue, config); }
        catch (error) {
          if (error instanceof DraftAuthoringError && error.code === "UNSAFE_DRAFT_CONTENT") {
            addCandidate("SAFETY_CONTEXT_REVIEW", []);
          } else addCandidate("CANDIDATE_CONTRACT", error instanceof Error
            ? (error.message.match(/ Field: ([a-zA-Z0-9_.]+)\.$/u)?.[1]?.split(".") ?? []) : []);
        }
      }
    }
    add("CONTENT_REVIEW", []);
  } catch (error) {
    add(error instanceof UnsafeAuthoringData ? "INPUT_UNSAFE_KEY"
      : error instanceof DraftAuthoringError ? "INPUT_INVALID" : "VALIDATOR_FAILED", []);
  }
  findings.sort((a, b) => {
    const left = a.path + "\u0000" + a.ruleId, right = b.path + "\u0000" + b.ruleId;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const summary = {
    errors: findings.filter((finding) => finding.severity === "ERROR").length,
    warnings: findings.filter((finding) => finding.severity === "WARNING").length,
    info: findings.filter((finding) => finding.severity === "INFO").length,
  };
  return {
    candidateId, scenarioId, scenarioVersion, schemaVersion, validationVersion: authoringValidationVersion,
    checkedAt: options.checkedAt ?? new Date().toISOString(), sourceHash, policyHash,
    status: summary.errors ? "FAIL" : summary.warnings ? "WARN" : "PASS",
    structuralValidation, reviewEligible: structuralValidation === "PASS" && verifiedRecord && summary.errors === 0,
    summary, findings, graph,
  };
}

function inspectCandidate({ draft, details }: AuthoringCandidate, add: AddAuthoringFinding) {
  const { scenario, review } = draft;
  const policy = scenario.adaptive_policy;
  if (draft.status !== "DRAFT" || draft.runtimeEligible || scenario.lifecycle_status !== "DRAFT"
    || scenario.review_status !== "draft" || review.decision !== "pending"
    || review.reviewerId || review.reviewedAt || scenario.reviewed_by || scenario.reviewed_at
    || Object.values(review.checklist).some(Boolean)) add("LIFECYCLE_FORGED", ["draft", "review"]);
  if (scenario.voice_id !== null || scenario.nodes.some((node) => node.branch_status !== "draft")
    || Object.values(scenario.responses).some((response) => response.safety_status === "reviewed_safe")) {
    add("LIFECYCLE_FORGED", ["draft", "scenario"]);
  }
  if (!/^S-\d{2}$/u.test(scenario.scenario_id) || ["S-01", "S-02", "S-03"].includes(scenario.scenario_id)
    || !validVersion.test(scenario.version) || draft.packageId !== `${scenario.scenario_id}-${scenario.version}-draft`
    || draft.scenarioBrief.scenarioId !== scenario.scenario_id) add("IDENTITY_INVALID", ["draft", "packageId"]);
  if (draft.source !== "offline_authoring" || draft.target !== "offline_pre_generated") add("PROVENANCE_INVALID", ["draft", "source"]);
  if (!/^Fictional\s/iu.test(scenario.fictional_organization.name) || !scenario.fictional_organization.training_only || !scenario.simulation) {
    add("FICTIONAL_ATTESTATION", ["draft", "scenario", "fictional_organization"]);
  }
  if (scenario.fictional_organization.name !== "Fictional Meghdoot Works") add("ENTITY_REVIEW", ["draft", "scenario", "fictional_organization", "name"]);
  if (!simulationCue.test(scenario.opening_line)) add("DISCLOSURE_MISSING", ["draft", "scenario", "opening_line"]);
  if (scenario.language !== "hi-en" || draft.scenarioBrief.language !== scenario.language) add("LANGUAGE_INVALID", ["draft", "scenario", "language"]);
  const responses = scenario.responses;
  const responseIds = Object.keys(responses);
  const terminalIds = Object.values(details.terminalResponses);
  const variantIds = details.variants.map((entry) => entry.responseId);
  if (duplicate(draft.candidateApprovedResponses.map((entry) => entry.responseId))
    || (details.runtimeProfile !== "offline-adaptive-v1" && duplicate(terminalIds))
    || [...variantIds, details.openingResponseId].some((id) => terminalIds.includes(id))
    || details.variants.some((entry) => !validId.test(entry.responseId)) || responseIds.some((id) => !validId.test(id))) {
    add("RESPONSE_ID", ["draft", "candidateApprovedResponses"]);
  }
  if (!responses[details.openingResponseId] || scenario.opening_line !== responses[details.openingResponseId]?.text) {
    add("RESPONSE_MISSING", ["details", "openingResponseId"]);
  }
  for (const [id, response] of Object.entries(responses)) {
    const path = ["draft", "scenario", "responses", id, "text"];
    if (!response.text.trim() || response.text.length > 280) add("CALLER_LENGTH", path);
    if (/[<>]|\n\s*\n|(?:\.\.\.|…|-)$/u.test(response.text)
      || Array.from(response.text).some((character) => character.charCodeAt(0) < 32 && character !== "\n" && character !== "\t")
      || /\b[a-zA-Z0-9_-]{45,}\b/u.test(response.text)) add("CALLER_FORMAT", path);
    const hasScript = details.scriptPreference === "Devanagari" ? /\p{Script=Devanagari}/u : /\p{Script=Latin}/u;
    if (!hasScript.test(response.text) || /\ufffd/u.test(response.text)) add("SCRIPT_REVIEW", path);
    const record = draft.candidateApprovedResponses.find((entry) => entry.responseId === id);
    if (!record || record.text !== response.text || record.language !== scenario.language) add("RESPONSE_METADATA", path);
  }
  if (!sameIds(responseIds, draft.candidateApprovedResponses.map((entry) => entry.responseId))) add("RESPONSE_METADATA", ["draft", "candidateApprovedResponses"]);
  if (draft.importableArtifacts.length !== 1 || !equal(draft.importableArtifacts[0]?.scenario, scenario)) {
    add("IDENTITY_INVALID", ["draft", "importableArtifacts"]);
  }
  for (const [outcome, id] of Object.entries(details.terminalResponses)) {
    const path = ["details", "terminalResponses", outcome];
    const response = responses[id];
    if (!response) { add("RESPONSE_MISSING", path); continue; }
    if (!stopCue.test(response.text)) add("ENDING_AMBIGUOUS", path);
    if (affirmativeMatch(response.text, /\b(?:please|now|abhi)\s+(?:confirm|continue|send|share|pay)|\b(?:or else|last chance|account will be blocked|continue (?:the|this) (?:call|conversation)|provide more details|keep talking|do not end the call)|अब.{0,10}(?:भेजिए|बताइए|जारी रखिए)/iu)) {
      add("ENDING_UNSAFE", path);
    }
  }
  inspectTactics({ draft, details }, add);
  inspectExamples({ draft, details }, add);
  inspectGuidance({ draft, details }, add);
  if (!policy) add("PRESSURE_RANGE", ["draft", "scenario", "adaptive_policy"]);
}

function inspectTactics({ draft: { scenario, tacticPool }, details }: CandidateContent, add: AddAuthoringFinding) {
  const policy = scenario.adaptive_policy;
  for (const tactic of Object.keys(tacticCategories) as (keyof typeof tacticCategories)[]) {
    const variants = details.variants.filter((entry) => entry.tactic === tactic);
    if (!sameIds(variants.map((entry) => entry.intensity), ["low", "medium", "high"])) add("TACTIC_COVERAGE", ["details", "variants"]);
  }
  if (duplicate(details.variants.map((entry) => `${entry.tactic}.${entry.intensity}`))) add("TACTIC_COVERAGE", ["details", "variants"]);
  if (!sameIds(details.variants.map((entry) => entry.responseId), policy?.tactics.flatMap((entry) => entry.response_ids) ?? [])
    || !sameIds(details.variants.map((entry) => entry.responseId), tacticPool.flatMap((entry) => entry.responseIds))) {
    add("TACTIC_METADATA", ["draft", "tacticPool"]);
  }
  if (!policy || policy.max_pressure_level < 0 || policy.max_pressure_level > 5) add("PRESSURE_RANGE", ["draft", "scenario", "adaptive_policy"]);
  details.variants.forEach((variant, index) => {
    const path = ["details", "variants", index];
    if (!policy || variant.pressureLevel > policy.max_pressure_level || variant.pressureLevel < 0 || variant.pressureLevel > 5) {
      add("PRESSURE_RANGE", [...path, "pressureLevel"]);
    }
    const configured = policy?.tactics.find((entry) => entry.tactic_id === variant.responseId);
    const pooled = tacticPool.find((entry) => entry.tacticId === variant.responseId);
    if (!configured || !pooled || configured.category !== tacticCategories[variant.tactic] || pooled.category !== configured.category
      || !equal(configured.response_ids, [variant.responseId]) || !equal(pooled.responseIds, [variant.responseId])) {
      add("TACTIC_METADATA", path);
    }
    if (configured?.pressure_level !== variant.pressureLevel || pooled?.pressureLevel !== variant.pressureLevel
      || variant.pressureLevel !== ["low", "medium", "high"].indexOf(variant.intensity) + 1) {
      add("PRESSURE_METADATA", [...path, "pressureLevel"]);
    }
    if (!scenario.responses[variant.responseId]) add("RESPONSE_MISSING", [...path, "responseId"]);
    const text = scenario.responses[variant.responseId]?.text ?? "";
    if (!/meghdoot|मेघदूत/iu.test(text) || !/wellness|वेलनेस/iu.test(text)) add("TOPIC_REVIEW", [...path, "responseId"]);
    for (const flag of variant.redFlags) {
      if (!details.redFlags.some((entry) => entry.id === flag && entry.tactics.includes(variant.tactic))) {
        add("RED_FLAG_REFERENCE", [...path, "redFlags"]);
      }
    }
  });
  for (let index = 0; index < details.variants.length; index++) {
    const left = details.variants[index]!;
    const text = scenario.responses[left.responseId]?.text.toLowerCase().replace(/\b(?:very|urgent|now|abhi|jaldi)\b/giu, "").replace(/\s+/gu, " ").trim();
    if (details.variants.slice(index + 1).some((right) => left.tactic === right.tactic
      && scenario.responses[right.responseId]?.text.toLowerCase().replace(/\b(?:very|urgent|now|abhi|jaldi)\b/giu, "").replace(/\s+/gu, " ").trim() === text)) {
      add("TACTIC_SIMILAR", ["details", "variants", index]);
    }
  }
}

function inspectExamples({ draft, details }: CandidateContent, add: AddAuthoringFinding) {
  const examples = draft.behaviorTrainingExamples;
  if (duplicate(examples.map((entry) => entry.exampleId)) || duplicate(examples.map((entry) => entry.utterance.trim()))
    || !sameIds(examples.map((entry) => entry.exampleId), details.examples.map((entry) => entry.exampleId))
    || draftBehaviors.some((behavior) => examples.filter((entry) => entry.label === behavior).length < 3)) {
    add("BEHAVIOR_COVERAGE", ["draft", "behaviorTrainingExamples"]);
  }
  if (!equal(examples, draft.candidateUtterances)) add("BEHAVIOR_COVERAGE", ["draft", "candidateUtterances"]);
  examples.forEach((entry, index) => {
    const path = ["draft", "behaviorTrainingExamples", index];
    const metadata = details.examples.find((item) => item.exampleId === entry.exampleId);
    if (!metadata || metadata.decision !== (outcomeFor(entry.label) ?? "continue")
      || /(?<![\p{L}\p{N}_-])DUMMY-[0-9]{4}(?![\p{L}\p{N}_-])/u.test(entry.utterance) !== (entry.label === "DISCLOSED_DUMMY_SECRET")) {
      add("BEHAVIOR_MAPPING", path);
    }
    if (metadata && !(metadata.script === "Devanagari" ? /\p{Script=Devanagari}/u : /\p{Script=Latin}/u).test(entry.utterance)) {
      add("SCRIPT_REVIEW", [...path, "utterance"]);
    }
    if (entry.label === "VERIFIED_INDEPENDENTLY" && !independentCue.test(entry.utterance)) add("BEHAVIOR_REVIEW", path);
    if (entry.label === "UNKNOWN" && affirmativeMatch(entry.utterance, /\b(?:I agree|I will verify independently|main independently verify|mark me down)\b|मैं.{0,10}स्वतंत्र.{0,10}सत्यापन/iu)) {
      add("BEHAVIOR_REVIEW", path);
    }
    if (entry.label === "STALLED" && /\b(?:I refuse|I will not accept|main mana karta hoon)\b|मैं मना करता हूँ/iu.test(entry.utterance)) {
      add("BEHAVIOR_REVIEW", path);
    }
  });
  const context = details.premise + " " + details.examples.map((entry) => entry.interpretation).join(" ");
  if (!/(?:unsolicited (?:synthetic )?(?:token )?disclosure|without being asked|synthetic.token (?:request|exercise)|अनचाहे.{0,10}खुलासे)/iu.test(context)) {
    add("DUMMY_CONTEXT", ["details", "examples"]);
  }
}

function inspectGuidance({ draft, details }: CandidateContent, add: AddAuthoringFinding) {
  const flags = details.redFlags.map((entry) => entry.id);
  if (!sameIds(flags, draft.scenario.red_flag_ids) || !sameIds(flags, draft.scenarioBrief.redFlags)
    || details.redFlags.some((flag) => duplicate(flag.tactics) || flag.tactics.some((tactic) =>
      !details.variants.some((variant) => variant.tactic === tactic && variant.redFlags.includes(flag.id))))) {
    add("RED_FLAG_REFERENCE", ["details", "redFlags"]);
  }
  const guidance = details.safeActions.join(" ");
  if (!independentCue.test(guidance) || !stopCue.test(guidance)) add("GUIDANCE_MISSING", ["details", "safeActions"]);
  const recommendations = [
    ...details.safeActions.map((text, index) => ({ text, path: ["details", "safeActions", index] })),
    ...details.debriefs.map((entry, index) => ({ text: entry.nextAction, path: ["details", "debriefs", index, "nextAction"] })),
    ...details.redFlags.map((entry, index) => ({ text: entry.safeAction, path: ["details", "redFlags", index, "safeAction"] })),
  ];
  for (const { text, path } of recommendations) {
    if (affirmativeMatch(text, /\b(?:use|trust|call|verify through)\b.{0,25}\bcaller[-' ](?:supplied|provided|s)\b.{0,30}\b(?:number|contact|proof|link)|caller ke diye.{0,20}(?:number|contact).{0,12}(?:bharosa|verify)|\bshare (?:your )?(?:password|pin|otp)|\bsend money/iu)) {
      add("GUIDANCE_UNSAFE", path);
    }
  }
  const templates = draft.debriefTemplateVariants;
  if (!sameIds(templates.map((entry) => entry.templateId), details.debriefs.map((entry) => entry.templateId))
    || draftOutcomes.some((outcome) => !details.debriefs.some((entry) => entry.outcome === outcome))
    || ["REFUSED", "STALLED"].some((behavior) => !details.debriefs.some((entry) => entry.behavior === behavior && entry.outcome === null))) {
    add("DEBRIEF_COVERAGE", ["details", "debriefs"]);
  }
  if (!details.debriefs.some((entry) => entry.behavior === "COMPLIED")) add("COMPLIANCE_REVIEW", ["details", "debriefs"]);
  details.debriefs.forEach((entry, index) => {
    if (entry.redFlags.some((flag) => !flags.includes(flag))) add("RED_FLAG_REFERENCE", ["details", "debriefs", index, "redFlags"]);
    const template = templates.find((item) => item.templateId === entry.templateId);
    const fields = { text: template?.text ?? "", scoring: entry.scoring, nextAction: entry.nextAction, limitations: entry.limitations, takeaway: entry.takeaway };
    for (const [field, text] of Object.entries(fields)) inspectDebriefClaim(text, ["details", "debriefs", index, field], add);
    if (!/\b(?:if|when|only|observ|committed|structured|record|unscored)\b/iu.test(entry.scoring)
      || affirmativeMatch(entry.scoring, /\b(?:always award|award.{0,30}regardless|points for everyone|score all categories)/iu)) {
      add("SCORING_UNOBSERVED", ["details", "debriefs", index, "scoring"]);
    }
  });
}

function inspectGraph({ draft: { scenario }, details }: AuthoringCandidate, add: AddAuthoringFinding): AuthoringGraphSummary {
  const points = details.decisionPoints;
  const policy = scenario.adaptive_policy;
  const nodes = scenario.nodes;
  const summary: AuthoringGraphSummary = {
    complete: true, reachablePrefixes: 1, terminalLeaves: 0, maximumDepth: 0,
    reachableResponseIds: [], reachablePressures: [], unreachableAuthoredVariants: [],
  };
  const responses = new Set<string>(), pressures = new Set<number>(), visited = new Set<string>(), terminals = new Set<string>();
  const error = (rule: AuthoringRuleId, path: (string | number)[]) => { summary.complete = false; add(rule, path); };
  if (!policy || points.length !== policy.max_turns || nodes.length !== points.length) error("GRAPH_TURN", ["details", "decisionPoints"]);
  if (duplicate(points.map((point) => point.nodeId)) || duplicate(nodes.map((node) => node.id))) error("GRAPH_ID", ["details", "decisionPoints"]);
  points.forEach((point, index) => {
    const node = nodes.find((entry) => entry.id === point.nodeId);
    if (point.turn !== index + 1 || point.turn > (policy?.max_turns ?? 0)) error("GRAPH_TURN", ["details", "decisionPoints", index, "turn"]);
    if (!node || node.parent_node_id !== (points[index - 1]?.nodeId ?? null)
      || node.next_node_id !== (points[index + 1]?.nodeId ?? null)) error("GRAPH_TARGET", ["details", "decisionPoints", index, "nodeId"]);
    if (!sameIds(point.routes.map((route) => route.behavior), [...draftBehaviors])) error("BEHAVIOR_MAPPING", ["details", "decisionPoints", index, "routes"]);
  });
  function visit(pointId: string, depth: number, ancestors: ReadonlySet<string>) {
    if (depth >= (policy?.max_turns ?? 0) || ancestors.has(pointId) || summary.reachablePrefixes > 4096) {
      error("GRAPH_CYCLE", ["details", "decisionPoints"]); return;
    }
    const index = points.findIndex((entry) => entry.nodeId === pointId), point = points[index];
    const node = nodes.find((entry) => entry.id === pointId);
    if (!point || !node || !scenario.responses[node.response_id]) { error("GRAPH_TARGET", ["details", "decisionPoints"]); return; }
    visited.add(pointId);
    responses.add(node.response_id);
    const variant = details.variants.find((entry) => entry.responseId === node.response_id);
    if (depth === 0 ? node.response_id !== details.openingResponseId : !variant) error("PRESSURE_TRANSITION", ["details", "decisionPoints", index]);
    const pressure = variant?.pressureLevel ?? 0;
    pressures.add(pressure);
    if (pressure > (policy?.max_pressure_level ?? -1)) error("PRESSURE_RANGE", ["details", "decisionPoints", index]);
    for (const [routeIndex, route] of point.routes.entries()) {
      summary.reachablePrefixes++;
      summary.maximumDepth = Math.max(summary.maximumDepth, depth + 1);
      const path = ["details", "decisionPoints", index, "routes", routeIndex];
      const final = depth + 1 === policy?.max_turns;
      const expected = final && route.behavior === "UNKNOWN" ? "MAX_TURNS" : outcomeFor(route.behavior) ?? (final ? "MAX_TURNS" : null);
      if (expected === null && route.action !== "continue" || expected !== null && (route.action !== "terminal" || route.outcome !== expected)) {
        error("GRAPH_TERMINAL", path);
      }
      if (route.action === "terminal") {
        const responseId = details.terminalResponses[route.outcome];
        if (!scenario.responses[responseId]) error("RESPONSE_MISSING", path);
        if (details.variants.some((entry) => entry.responseId === responseId)) error("PRESSURE_TRANSITION", path);
        responses.add(responseId);
        terminals.add(route.outcome);
        summary.terminalLeaves++;
      } else {
        if (final) { error("GRAPH_TERMINAL", path); continue; }
        if (route.nextNodeId !== points[index + 1]?.nodeId) error("GRAPH_TARGET", path);
        visit(route.nextNodeId, depth + 1, new Set([...ancestors, pointId]));
      }
    }
  }
  if (points[0]) visit(points[0].nodeId, 0, new Set());
  if (points.some((point) => !visited.has(point.nodeId)) || draftOutcomes.some((outcome) => !terminals.has(outcome))) error("GRAPH_UNREACHABLE", ["details", "decisionPoints"]);
  summary.reachableResponseIds = [...responses].sort();
  summary.reachablePressures = [...pressures].sort((a, b) => a - b);
  summary.unreachableAuthoredVariants = details.variants.map((entry) => entry.responseId).filter((id) => !responses.has(id)).sort();
  return summary;
}

async function inspectLineage(saved: SavedDraft, lineage: readonly unknown[], add: AddAuthoringFinding) {
  let id = saved.previousCandidateId;
  let child = saved;
  const seen = new Set([saved.candidateId]);
  while (id !== null) {
    if (seen.has(id) || seen.size > 32) { add("LINEAGE_INVALID", ["previousCandidateId"]); return; }
    const parsed = SavedDraftSchema.safeParse(lineage.find((record) => asObject(record).candidateId === id));
    if (!parsed.success) { add("LINEAGE_INVALID", ["previousCandidateId"]); return; }
    const prior = parsed.data;
    const hash = await hashAuthoringData(prior.candidate);
    if (prior.contentHash !== hash || prior.candidateId !== `${prior.provenance.source === "MANUAL_IMPORT" ? "import" : "mock"}-${hash}`
      || prior.candidate.draft.scenario.scenario_id !== child.candidate.draft.scenario.scenario_id
      || prior.candidate.draft.scenario.version === child.candidate.draft.scenario.version) {
      add("LINEAGE_INVALID", ["previousCandidateId"]); return;
    }
    seen.add(id); id = prior.previousCandidateId; child = prior;
  }
}

export async function canSubmitForSafetyReview(
  candidate: unknown, report: unknown, options: AuthoringValidationOptions,
): Promise<{ eligible: boolean; reasons: ("STALE_CONTENT" | "STALE_VALIDATOR" | "STALE_POLICY" | "REPORT_MISMATCH" | "VALIDATION_BLOCKED")[] }> {
  const current = await validateAuthoringDraft(candidate, options);
  try { boundedData(report); }
  catch { return { eligible: false, reasons: ["REPORT_MISMATCH"] }; }
  const parsed = AuthoringValidationResultSchema.safeParse(report);
  if (!parsed.success) return { eligible: false, reasons: ["REPORT_MISMATCH"] };
  const previous = parsed.data;
  const reasons: ("STALE_CONTENT" | "STALE_VALIDATOR" | "STALE_POLICY" | "REPORT_MISMATCH" | "VALIDATION_BLOCKED")[] = [];
  if (previous.sourceHash !== current.sourceHash) reasons.push("STALE_CONTENT");
  if (previous.validationVersion !== authoringValidationVersion) reasons.push("STALE_VALIDATOR");
  if (previous.policyHash !== current.policyHash) reasons.push("STALE_POLICY");
  const substantive = ({ checkedAt: _checkedAt, ...result }: AuthoringValidationResult) => result;
  if (!equal(substantive(previous), substantive(current))) reasons.push("REPORT_MISMATCH");
  if (!current.reviewEligible) reasons.push("VALIDATION_BLOCKED");
  return { eligible: reasons.length === 0, reasons };
}
