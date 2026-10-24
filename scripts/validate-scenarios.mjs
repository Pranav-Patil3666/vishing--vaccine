import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ScenarioDocumentSchema, SafetyReviewScenarioPackageSchema, ApprovedScenarioPackageSchema, validateScenarioForRelease, validateScenarioSafety } from "@vaccine/scenario-schema";
import { createSafetyPreflight } from "../apps/web/src/authoringDraft.ts";

const workspaceRoot = process.cwd();
const scenarioRoot = join(workspaceRoot, "content", "scenarios");
const files = [...await listJsonFiles(scenarioRoot), ...await listJsonFiles(join(workspaceRoot, "content", "scenario-candidates"))];
const references = JSON.parse(await readFile(join(workspaceRoot, "content/safety/review-reference-lists.json"), "utf8"));
if (files.length === 0) throw new Error("No scenario JSON files were found.");

for (const file of files) {
  const source = await readFile(file, "utf8");
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error(`Invalid JSON in ${relative(workspaceRoot, file)}.`);
  }
  const parsed = ScenarioDocumentSchema.safeParse(document);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Scenario validation failed for ${relative(workspaceRoot, file)} at: ${paths}`);
  }
  if (parsed.data.review_status === "approved") {
    validateScenarioForRelease(parsed.data);
    const packagePath = join(workspaceRoot, "content", "authoring", `${parsed.data.scenario_id}-${parsed.data.language}.package.json`);
    const approved = ApprovedScenarioPackageSchema.parse(JSON.parse(await readFile(packagePath, "utf8")));
    assertPackageMatches(approved, parsed.data);
    if (!validateScenarioSafety(parsed.data, references).passed) throw new Error("Released content failed the configured safety scan.");
  }
  process.stdout.write(`PASS ${relative(workspaceRoot, file)} (${parsed.data.review_status})\n`);
}

// Reuse the existing authoring/review models and preflight; these records are outside runtime/catalog loading.
const reviewValue = JSON.parse(await readFile(join(workspaceRoot, "content/authoring/S-01-hi-IN.package.json"), "utf8"));
const approvedReview = ApprovedScenarioPackageSchema.safeParse(reviewValue);
const review = approvedReview.success ? approvedReview.data : SafetyReviewScenarioPackageSchema.parse(reviewValue);
const lines = JSON.parse(await readFile(join(workspaceRoot, "content/authoring/S-01-hi-IN.lines.json"), "utf8"));
const candidate = ScenarioDocumentSchema.parse(JSON.parse(await readFile(join(workspaceRoot, "content/scenario-candidates/S-01-hi-IN.json"), "utf8")));
assertPackageMatches(review, candidate);
if (!isDeepStrictEqual(candidate, lines.scenario) || !isDeepStrictEqual(lines.brief, review.scenarioBrief)
  || !isDeepStrictEqual(lines.trainingExamples, review.behaviorTrainingExamples)
  || !isDeepStrictEqual(lines.debriefVariants, review.debriefTemplateVariants.map((variant) => ({ id: variant.templateId, text: variant.text })))
  || !isDeepStrictEqual(lines.tactics.map((tactic) => tactic.response), review.candidateApprovedResponses.map((response) => ({ id: response.responseId, text: response.text })))) {
  throw new Error("S-01 review records disagree.");
}
for (const tactic of lines.tactics) {
  const policyTactic = candidate.adaptive_policy?.tactics.find((item) => item.tactic_id === tactic.id);
  if (!policyTactic || tactic.category !== policyTactic.category || tactic.response.id !== tactic.id
    || tactic.lines[1]?.text !== tactic.response.text || tactic.lines[1]?.pressureLevel !== policyTactic.pressure_level) {
    throw new Error("S-01 authored tactics differ from runtime responses.");
  }
}
const preflight = createSafetyPreflight(candidate, lines.tactics, lines.trainingExamples, lines.debriefVariants, references.knownRealOrganizations);
if (!isDeepStrictEqual(preflight, lines.safetyPreflight)) throw new Error("S-01 saved preflight is stale.");
if (preflight.status !== "PASS" || !validateScenarioSafety(candidate, references).passed) throw new Error("S-01 candidate failed existing safety preflight.");
process.stdout.write(`PASS S-01 review package and configured-list safety preflight (review=${review.review.decision}; runtime=${review.runtimeEligible})\n`);

function assertPackageMatches(review, scenario) {
  if (!isDeepStrictEqual(review.scenario, scenario) || review.importableArtifacts.length === 0
    || review.importableArtifacts.some((artifact) => !isDeepStrictEqual(artifact.scenario, scenario))
    || review.scenarioBrief.scenarioId !== scenario.scenario_id || !isDeepStrictEqual(review.scenarioBrief.redFlags, scenario.red_flag_ids)) {
    throw new Error("Scenario content differs from its review package.");
  }
  const tactics = scenario.adaptive_policy?.tactics ?? [];
  const expectedPool = tactics.map((tactic) => ({ tacticId: tactic.tactic_id, category: tactic.category, pressureLevel: tactic.pressure_level, responseIds: tactic.response_ids }));
  const expectedResponses = [...new Set(tactics.flatMap((tactic) => tactic.response_ids))]
    .map((id) => ({ responseId: id, text: scenario.responses[id]?.text, language: scenario.language }));
  if (!isDeepStrictEqual(review.tacticPool.map((tactic) => ({ tacticId: tactic.tacticId, category: tactic.category, pressureLevel: tactic.pressureLevel, responseIds: tactic.responseIds })), expectedPool)
    || !isDeepStrictEqual(review.candidateApprovedResponses.map((response) => ({ responseId: response.responseId, text: response.text, language: response.language })), expectedResponses)) {
    throw new Error("Review tactics/responses differ from scenario content.");
  }
  const scan = { ...scenario, safety_constraints: [...scenario.safety_constraints, JSON.stringify({
    responses: review.candidateApprovedResponses, examples: review.behaviorTrainingExamples,
    utterances: review.candidateUtterances, debrief: review.debriefTemplateVariants,
  })] };
  if (!validateScenarioSafety(scan, references).passed) throw new Error("Review package failed the configured safety scan.");
}

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.isFile() && extname(entry.name).toLowerCase() === ".json" ? [path] : [];
  }));
  return nested.flat();
}
