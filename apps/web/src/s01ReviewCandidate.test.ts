import assert from "node:assert/strict";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test, { type TestContext } from "node:test";
import {
  SafetyReviewScenarioPackageSchema, ApprovedScenarioPackageSchema, ScenarioDocumentSchema, BehaviorTrainingExampleSchema,
  approveDraftScenarioPackage, makeScenarioRuntimeEligible, isScenarioRuntimeEligible, validateScenarioSafety,
  type ScenarioDocument, type SafetyReviewScenarioPackage, type ApprovedScenarioPackage,
} from "@vaccine/scenario-schema";
import reviewJson from "../../../content/authoring/S-01-hi-IN.package.json";
import pendingReviewJson from "../../../content/authoring/history/S-01-hi-IN.pending-review.package.json";
import candidateJson from "../../../content/scenario-candidates/S-01-hi-IN.json";
import linesJson from "../../../content/authoring/S-01-hi-IN.lines.json";
import references from "../../../content/safety/review-reference-lists.json";
import { canonicalTacticIds, createSafetyPreflight, selectPressureLevels, type LocalScenarioDraft } from "./authoringDraft.js";
import { AdaptivePolicyEngine, ApprovedResponseResolver } from "../../api/src/adaptivePolicy.js";
import { LearnerBehaviorClassifier } from "../../api/src/behaviorClassifier.js";
import { detectDummySecretDisclosure } from "../../api/src/timing.js";
import { createApiServer } from "../../api/src/health.js";
import { createApiClient } from "./sessionApi.js";
import { scenarioCatalog } from "./scenarioCatalog.js";

const review = SafetyReviewScenarioPackageSchema.parse(pendingReviewJson);
const releasedReview = ApprovedScenarioPackageSchema.parse(reviewJson);
const candidate = review.scenario;
const releasedCandidate = ScenarioDocumentSchema.parse(candidateJson);
const local = { ...linesJson, scenario: candidate } as unknown as LocalScenarioDraft;
const classifier = new LearnerBehaviorClassifier(), engine = new AdaptivePolicyEngine(), resolver = new ApprovedResponseResolver();
/** Ephemeral approval simulation only. Nothing from this function is saved as project content. */
function approvedForTest() {
  return makeScenarioRuntimeEligible(approveDraftScenarioPackage(review, {
    reviewerId: "offline-transition-test-only", reviewedAt: "2026-10-13T00:00:00.000Z",
    checklist: { fictionalOrganization: true, syntheticDataOnly: true, noSecurityBypassInstructions: true, safeEndingAvailable: true,
      simulationLabelVisible: true, aiVoiceDisclosureRequired: true, consentBeforeRecording: true, noAudioRetentionByDefault: true },
  }));
}
function decide(scenario: ScenarioDocument, text: string, currentPressureLevel = 0, history: string[] = []) {
  const tokens = text.match(/(?<![\p{L}\p{N}-])DUMMY-\d{4}(?![\p{L}\p{N}-])/gu) ?? [];
  const observed = detectDummySecretDisclosure({ turnId: "test-turn", text, segmentIndex: 1, timingSource: "UNKNOWN" }, tokens) !== null;
  const behavior = classifier.classify({ transcriptText: text, dummySecretDisclosureObserved: observed, scenario });
  const action = engine.decide({ scenario, behavior: behavior.label, turnNumber: 1, currentPressureLevel,
    previousTacticIds: history, learnerText: text, runtimeAllowed: true });
  return { behavior, action, response: resolver.resolve({ scenario, language: "hi-IN", action }) };
}

test("archived S-01 pending review retains its original state without claimed human approval", () => {
  assert.deepEqual(candidate, review.scenario);
  assert.equal(candidate.lifecycle_status, "SAFETY_REVIEW"); assert.equal(candidate.review_status, "in_review");
  assert.equal(candidate.reviewed_by, null); assert.equal(candidate.reviewed_at, null);
  assert.equal(review.review.decision, "pending"); assert.equal(review.review.reviewerId, null);
  assert.equal(review.review.reviewedAt, null);
  assert.equal(review.runtimeEligible, false); assert.equal(isScenarioRuntimeEligible(candidate), false);
  assert.ok(Object.values(review.review.checklist).every((item) => item === false));
  assert.equal(candidate.language, "hi-IN"); assert.equal(review.scenarioBrief.language, "hi-en"); assert.equal(candidate.voice_id, "mock-only");
  assert.equal(candidate.fictional_organization.name, "Northstar Cooperative Bank");
});
test("fifteen authored lines retain canonical IDs and existing max-2 intensity mapping", () => {
  assert.deepEqual(local.tactics.map((tactic) => tactic.id), canonicalTacticIds);
  assert.equal(local.tactics.flatMap((tactic) => tactic.lines).length, 15);
  assert.equal(new Set(local.tactics.flatMap((tactic) => tactic.lines.map((line) => line.text))).size, 15);
  assert.deepEqual(selectPressureLevels(candidate.adaptive_policy!.max_pressure_level), [0, 1, 2]);
  for (const tactic of local.tactics) {
    assert.equal(tactic.id, tactic.response.id); assert.deepEqual(tactic.lines.map((line) => line.intensity), ["low", "medium", "high"]);
    assert.deepEqual(tactic.lines.map((line) => line.pressureLevel), [0, 1, 2]);
    assert.equal(tactic.response.text, tactic.lines[1].text); assert.equal(candidate.responses[tactic.id]?.text, tactic.response.text);
    assert.deepEqual(candidate.adaptive_policy?.tactics.find((item) => item.tactic_id === tactic.id)?.response_ids, [tactic.id]);
    assert.equal(candidate.adaptive_policy?.tactics.find((item) => item.tactic_id === tactic.id)?.pressure_level, 1);
    assert.equal(candidate.responses[tactic.id]?.safety_status, "draft");
  }
  assert.equal(candidate.responses["system.opening"]?.text, candidate.opening_line);
  assert.deepEqual(candidate.red_flag_ids, ["RF-01", "RF-02", "RF-03", "RF-05", "RF-07"]);
});
test("fifteen synthetic examples and five debrief variants use existing authoring contracts", () => {
  assert.equal(local.trainingExamples.length, 15); assert.deepEqual(local.trainingExamples, review.behaviorTrainingExamples);
  for (const behavior of ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY", "COMPLIED", "DISCLOSED_DUMMY_SECRET"]) {
    assert.equal(local.trainingExamples.filter((example) => example.label === behavior).length, 3);
  }
  for (const example of local.trainingExamples) assert.equal(BehaviorTrainingExampleSchema.safeParse(example).success, true);
  assert.equal(local.debriefVariants.length, 5);
  assert.deepEqual(local.debriefVariants, review.debriefTemplateVariants.map((variant) => ({ id: variant.templateId, text: variant.text })));
  for (const variant of local.debriefVariants) {
    assert.match(variant.text, /Around \{timestamp\}/u);
    for (const placeholder of ["{latency}", "{timestamp}", "{behavior}"]) assert.ok(variant.text.includes(placeholder));
    assert.doesNotMatch(variant.text, /nervous|panicked|trusting|angry/iu);
  }
});
test("existing configured safety scan and Phase 3A preflight pass the whole reviewable content", () => {
  const preflight = createSafetyPreflight(candidate, local.tactics, local.trainingExamples, local.debriefVariants, references.knownRealOrganizations);
  assert.equal(preflight.status, "PASS"); assert.deepEqual(preflight, linesJson.safetyPreflight);
  assert.equal(validateScenarioSafety(candidate, references).passed, true);
});
test("absent mandatory safeguards, missing lines and unconfigured brand coverage cannot appear green", () => {
  const missing = structuredClone(candidate); delete missing.safety_metadata;
  assert.equal(createSafetyPreflight(missing, local.tactics, local.trainingExamples, local.debriefVariants, references.knownRealOrganizations).status, "FAIL");
  const empty = structuredClone(local.tactics); empty[0]!.lines[1].text = "";
  assert.equal(createSafetyPreflight(candidate, empty, local.trainingExamples, local.debriefVariants, references.knownRealOrganizations).status, "FAIL");
  assert.equal(createSafetyPreflight(candidate, local.tactics, local.trainingExamples, local.debriefVariants, []).status, "WARNING");
});
for (const text of ["123456", "my PIN is 1234", "card number 4111111111111111", "DUMMY-12345", "DUMMY-OTP-EXAMPLE"]) {
  test("invalid credential/example cannot pass preflight or become dummy disclosure", () => {
    const unsafe = structuredClone(candidate); unsafe.responses.authority!.text = text;
    const result = createSafetyPreflight(unsafe, local.tactics, local.trainingExamples, local.debriefVariants, references.knownRealOrganizations);
    assert.equal(result.status, "FAIL");
    assert.equal(validateScenarioSafety(unsafe, references).passed, false);
    const actual = decide(approvedForTest().scenario, text); assert.notEqual(actual.behavior.label, "DISCLOSED_DUMMY_SECRET");
  });
}
test("bare four-digit input is never a project dummy secret", () => {
  assert.equal(detectDummySecretDisclosure({ turnId: "test-turn", text: "1234", segmentIndex: 1, timingSource: "UNKNOWN" }, ["1234"]), null);
  assert.equal(decide(approvedForTest().scenario, "1234").behavior.label, "UNKNOWN");
});
for (const example of review.behaviorTrainingExamples) test(`candidate example ${example.exampleId} follows existing classifier and policy`, () => {
  const scenario = approvedForTest().scenario;
  const result = decide(scenario, example.utterance); assert.equal(result.behavior.label, example.label);
  assert.equal(result.response.text, scenario.responses[result.action.responseId]?.text);
  assert.equal(result.action.pressureLevel <= 2, true);
  if (example.label === "VERIFIED_INDEPENDENTLY") { assert.equal(result.action.terminalState, "SAFE_VERIFIED"); assert.equal(result.action.nextPressureLevel, 0); }
  else if (example.label === "DISCLOSED_DUMMY_SECRET") { assert.equal(result.action.terminalState, "DUMMY_SECRET_DISCLOSED"); assert.equal(result.action.nextPressureLevel, 0); assert.doesNotMatch(result.response.text, /DUMMY-\d{4}/u); }
  else { assert.equal(result.action.terminalState, null); assert.equal(result.action.tacticId, "authority"); assert.equal(result.action.pressureLevel, 1); }
});
test("unknown transcript, safe word, maximum turns and exhausted history end without further pressure", () => {
  const scenario = approvedForTest().scenario;
  assert.equal(decide(scenario, "no matching phrase").action.terminalState, "SAFE_FALLBACK");
  assert.equal(decide(scenario, "please stop simulation now").action.terminalState, "SAFE_WORD");
  assert.equal(decide(scenario, "Main share nahi karunga", 1, [...canonicalTacticIds]).action.terminalState, "SAFE_FALLBACK");
  const action = engine.decide({ scenario, behavior: "COMPLIED", turnNumber: 3, currentPressureLevel: 1, previousTacticIds: [], learnerText: "main agree karta hoon" });
  assert.equal(action.terminalState, "MAX_TURNS"); assert.equal(action.nextPressureLevel, 1);
});
test("terminal outcomes stop tactics and preserve the current pressure without escalation", () => {
  const scenario = approvedForTest().scenario;
  for (const text of ["Main official channel se verify karunga.", "Practice token DUMMY-4821 hai.", "no matching phrase"]) {
    const result = decide(scenario, text, 1);
    assert.notEqual(result.action.terminalState, null); assert.equal(result.action.tacticId, null);
    assert.equal(result.action.nextPressureLevel, 1); assert.equal(result.action.responseId.startsWith("system.safe-"), true);
    assert.doesNotMatch(result.response.text, /DUMMY-\d{4}/u);
  }
});
test("each fixed runtime tactic resolves to its matching medium authoring line", () => {
  const scenario = approvedForTest().scenario;
  const history: string[] = [];
  for (let index = 0; index < canonicalTacticIds.length; index++) {
    const result = decide(scenario, "Main share nahi karunga.", 1, history);
    assert.equal(result.action.terminalState, null); assert.equal(result.action.pressureLevel, 1);
    const tactic = local.tactics.find((item) => item.id === result.action.tacticId); assert.ok(tactic);
    assert.equal(result.action.responseId, tactic.id); assert.equal(result.response.text, tactic.lines[1].text);
    assert.equal(result.response.safetyStatus, "reviewed_safe"); history.push(tactic.id);
  }
  assert.deepEqual([...history].sort(), [...canonicalTacticIds].sort());
  assert.equal(decide(scenario, "Main share nahi karunga.", 1, history).action.terminalState, "SAFE_FALLBACK");
});
test("unapproved review fixture cannot resolve draft tactic responses or claim runtime eligibility", () => {
  assert.equal(decide(candidate, "main share nahi karunga").action.decisionCode, "DRAFT_SAFE_FALLBACK");
  const scenario = approvedForTest().scenario;
  const chosen = decide(scenario, "main share nahi karunga").action;
  const unreviewed = structuredClone(scenario); unreviewed.responses.authority!.safety_status = "draft";
  assert.throws(() => resolver.resolve({ scenario: unreviewed, language: "hi-IN", action: chosen }));
  const arbitrary = { ...chosen, responseId: "arbitrary" }; assert.throws(() => resolver.resolve({ scenario, language: "hi-IN", action: arbitrary }));
  const absent = structuredClone(scenario); delete absent.responses.authority;
  assert.equal(ScenarioDocumentSchema.safeParse(absent).success, false);
});
async function serve(context: TestContext, scenario: ScenarioDocument) {
  const directory = await mkdtemp(join(tmpdir(), "vishing-s01-review-test-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify(scenario));
  let server;
  try { server = createApiServer({ environment: "test", scenarioDirectory: directory, runtimeRecognizer: {
    transcribe: async () => { throw new Error("no provider permitted"); }, openStream: () => { throw new Error("no provider permitted"); },
  } }); } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== "string"); return createApiClient(`http://127.0.0.1:${address.port}`);
}
test("runtime loader rejects pending review and accepts only ephemeral approved hi-IN scenario in an offline test", async (context) => {
  const pendingApi = await serve(context, candidate);
  await assert.rejects(pendingApi.createDemoSession({ scenarioId: "S-01", scenarioVersion: candidate.version, language: "hi-IN", runtimeMode: "REAL_STT" }));
  const approved = approvedForTest(); const api = await serve(context, approved.scenario);
  const session = await api.createDemoSession({ scenarioId: "S-01", scenarioVersion: candidate.version, language: "hi-IN", runtimeMode: "REAL_STT" });
  assert.equal((await api.getRealVoiceStatus!(session.sessionId)).reason, "READY"); await api.endSession(session.sessionId);
});
test("runtime loader rejects approved safety-invalid content without weakening the gate", async (context) => {
  const bad = approvedForTest().scenario; bad.responses.authority!.text = "SBI verification desk";
  await assert.rejects(serve(context, bad), /configured safety scan/u);
});
for (const defect of ["policy", "language"] as const) test(`approved scenario missing valid ${defect} cannot start REAL_STT`, async (context) => {
  const bad = approvedForTest().scenario;
  if (defect === "policy") delete bad.adaptive_policy; else bad.language = "unsupported-language";
  const api = await serve(context, bad);
  await assert.rejects(api.createDemoSession({ scenarioId: "S-01", scenarioVersion: bad.version, language: bad.language!, runtimeMode: "REAL_STT" }));
});
test("archived original draft stays ineligible and canonical catalog contains one approved S-01", async () => {
  const original = ScenarioDocumentSchema.parse(JSON.parse(await readFile("content/scenario-candidates/history/S-01-0.1.0-draft.json", "utf8")));
  assert.equal(original.version, "0.1.0-draft"); assert.equal(original.review_status, "draft");
  assert.equal(isScenarioRuntimeEligible(original), false);
  assert.equal(engine.decide({ scenario: original, behavior: "COMPLIED", turnNumber: 1, currentPressureLevel: 0, previousTacticIds: [], learnerText: "main agree karta hoon" }).decisionCode, "DRAFT_SAFE_FALLBACK");
  assert.equal(scenarioCatalog.filter((scenario) => scenario.scenario_id === "S-01").length, 1);
  assert.equal(scenarioCatalog.find((scenario) => scenario.scenario_id === "S-01")?.review_status, "approved");
  approvedForTest(); const fresh = SafetyReviewScenarioPackageSchema.parse(JSON.parse(await readFile("content/authoring/history/S-01-hi-IN.pending-review.package.json", "utf8")));
  assert.equal(fresh.review.reviewerId, null); assert.equal(fresh.scenario.reviewed_at, null); assert.equal(fresh.runtimeEligible, false);
});

test("user-approved promotion changes lifecycle metadata only and matches every canonical review artifact", async () => {
  const canonical = ScenarioDocumentSchema.parse(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  assert.deepEqual(canonical, releasedCandidate); assert.deepEqual(canonical, releasedReview.scenario); assert.deepEqual(canonical, linesJson.scenario);
  for (const artifact of releasedReview.importableArtifacts) assert.deepEqual(artifact.scenario, canonical);
  assert.equal(isScenarioRuntimeEligible(canonical), true); assert.equal(releasedReview.runtimeEligible, true);
  assert.equal(releasedReview.status, "RUNTIME_ELIGIBLE"); assert.equal(releasedReview.review.decision, "approved");
  assert.equal(releasedReview.review.reviewerId, "user:explicit-chat-approval");
  assert.equal(canonical.reviewed_by, releasedReview.review.reviewerId); assert.equal(canonical.reviewed_at, releasedReview.review.reviewedAt);
  assert.ok(releasedReview.review.reviewedAt); assert.ok(Object.values(releasedReview.review.checklist).every(Boolean));
  const expected = makeScenarioRuntimeEligible(approveDraftScenarioPackage(review, {
    reviewerId: releasedReview.review.reviewerId!, reviewedAt: releasedReview.review.reviewedAt!,
    checklist: releasedReview.review.checklist, notes: releasedReview.review.notes,
  }));
  assert.deepEqual(releasedReview, expected);
  assert.ok(releasedReview.tacticPool.every((tactic) => tactic.status === "APPROVED"));
  assert.ok(releasedReview.candidateApprovedResponses.every((response) => response.status === "APPROVED"));
  assert.ok(releasedReview.debriefTemplateVariants.every((variant) => variant.status === "APPROVED"));
  assert.equal(validateScenarioSafety(canonical, references).passed, true);
});

test("promoted canonical S-01 passes real-session content gates without opening a provider stream", async (context) => {
  const canonical = ScenarioDocumentSchema.parse(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  const api = await serve(context, canonical); // Recognizer throws if any provider operation is attempted.
  const session = await api.createDemoSession({ scenarioId: "S-01", scenarioVersion: canonical.version, language: "hi-IN", runtimeMode: "REAL_STT" });
  assert.equal(session.scenarioRuntimeStatus, "RUNTIME_ELIGIBLE"); assert.equal(session.runtimeMode, "REAL_STT");
  assert.equal(session.state, "CONSENT_REQUIRED"); assert.equal(session.recordingEnabled, false);
  await assert.rejects(api.createDemoSession({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "hi-IN", runtimeMode: "REAL_STT" }));
  await api.endSession(session.sessionId);
});

interface CliFixture {
  canonical: ScenarioDocument;
  candidate: ScenarioDocument;
  reviewPackage: SafetyReviewScenarioPackage | ApprovedScenarioPackage;
  lineRecord: LocalScenarioDraft;
}
async function runCandidateCli(context: TestContext, approved: boolean, mutate: (fixture: CliFixture) => void = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "vishing-s01-validator-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const reviewPackage = structuredClone(approved ? approvedForTest() : review);
  const fixture: CliFixture = {
    canonical: approved ? structuredClone(reviewPackage.scenario) : ScenarioDocumentSchema.parse(JSON.parse(await readFile("content/scenario-candidates/history/S-01-0.1.0-draft.json", "utf8"))),
    candidate: structuredClone(reviewPackage.scenario), reviewPackage,
    lineRecord: { ...structuredClone(local), scenario: structuredClone(reviewPackage.scenario) },
  };
  mutate(fixture);
  const files = [
    ["content/scenarios/scenario.json", fixture.canonical], ["content/scenario-candidates/S-01-hi-IN.json", fixture.candidate],
    ["content/authoring/S-01-hi-IN.package.json", fixture.reviewPackage], ["content/authoring/S-01-hi-IN.lines.json", fixture.lineRecord],
    ["content/safety/review-reference-lists.json", references],
  ] as const;
  for (const name of ["scenarios", "scenario-candidates", "authoring", "safety"]) await mkdir(join(directory, "content", name), { recursive: true });
  for (const [name, value] of files) await writeFile(join(directory, name), JSON.stringify(value));
  return promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), resolve("scripts/validate-scenarios.mjs")], {
    cwd: directory, env: { ...process.env, TSX_TSCONFIG_PATH: resolve("apps/web/tsconfig.app.json") },
  });
}
test("actual validator CLI accepts review artifacts while reporting runtime false", async (context) => {
  const result = await runCandidateCli(context, false);
  assert.match(result.stdout, /review=pending; runtime=false/u);
});
test("actual validator CLI accepts an exactly matching ephemeral released package", async (context) => {
  const result = await runCandidateCli(context, true);
  assert.match(result.stdout, /review=approved; runtime=true/u);
});
const cliDefects: ReadonlyArray<{ name: string; mutate: (fixture: CliFixture) => void; expected: RegExp }> = [
  { name: "changed released text", mutate: (fixture) => { fixture.canonical.responses.authority!.text += " Changed content."; }, expected: /differs from its review package/u },
  { name: "pending package used for release", mutate: (fixture) => { fixture.reviewPackage = structuredClone(review); }, expected: /ZodError/u },
  { name: "missing reviewer", mutate: (fixture) => { fixture.reviewPackage.review.reviewerId = null; fixture.reviewPackage.review.reviewedAt = null; }, expected: /Approval requires/u },
  { name: "unchecked human review", mutate: (fixture) => { fixture.reviewPackage.review.checklist.syntheticDataOnly = false; }, expected: /every safety checklist/u },
  { name: "changed response package", mutate: (fixture) => { fixture.reviewPackage.candidateApprovedResponses[0]!.text += " Changed content."; }, expected: /tactics\/responses differ/u },
  { name: "changed example record", mutate: (fixture) => { fixture.lineRecord.trainingExamples[0]!.utterance += " Extra sentence."; }, expected: /review records disagree/u },
  { name: "changed debrief record", mutate: (fixture) => { fixture.lineRecord.debriefVariants[0]!.text += " Extra sentence."; }, expected: /review records disagree/u },
  { name: "stale preflight", mutate: (fixture) => { fixture.lineRecord.safetyPreflight.status = "FAIL"; }, expected: /saved preflight is stale/u },
  { name: "unsafe released text", mutate: (fixture) => {
    for (const scenario of [fixture.canonical, fixture.candidate, fixture.reviewPackage.scenario, fixture.reviewPackage.importableArtifacts[0]!.scenario, fixture.lineRecord.scenario]) scenario.responses.authority!.text = "SBI verification desk";
    fixture.reviewPackage.candidateApprovedResponses.find((response) => response.responseId === "authority")!.text = "SBI verification desk";
  }, expected: /configured safety scan/u },
];
for (const defect of cliDefects) test(`actual validator CLI rejects ${defect.name}`, async (context) => {
  await assert.rejects(runCandidateCli(context, true, defect.mutate), defect.expected);
});
