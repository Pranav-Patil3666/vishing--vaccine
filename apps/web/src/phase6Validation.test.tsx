import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { renderToStaticMarkup } from "react-dom/server";
import {
  authoringRules, AuthoringValidationResultSchema, authoringValidationVersion, canSubmitForSafetyReview,
  DeterministicMockScenarioGenerator, draftJsonLimit, hashAuthoringData, isScenarioRuntimeEligible, parseMockDraftBrief,
  validateAuthoringDraft, type AuthoringCandidate, type AuthoringRuleId, type SavedDraft,
} from "@vaccine/scenario-schema";
import { LocalDraftStore } from "../../api/src/authoring/draftStore.js";
import { AuthoringValidationFindings } from "./pages/AuthoringPage.js";
import { RuntimeCreditLedger } from "../../api/src/runtimeCredit.js";
import { InMemorySessionStore } from "../../api/src/sessionStore.js";
import { freshPathSession } from "../../api/src/testing/behaviorPath.js";
import { createApiServer } from "../../api/src/health.js";
import { once } from "node:events";
import safety from "../../../content/safety/review-reference-lists.json";
import brief from "../../../content/authoring/examples/benefits-brief.json";

const fixed = "2026-11-07T00:00:00.000Z";
const options = { safety, checkedAt: fixed };
const generator = new DeterministicMockScenarioGenerator();
const generate = () => generator.generateDraft(parseMockDraftBrief(brief));
const encode = (text: string) => new TextEncoder().encode(text);
const record = async (candidate = generate()): Promise<SavedDraft> => {
  const hash = await hashAuthoringData(candidate);
  const manual = candidate.declaredOrigin !== undefined;
  return {
    candidateId: `${manual ? "import" : "mock"}-${hash}`, createdAt: fixed, contentHash: hash, previousCandidateId: null,
    structuralValidation: "PASS", candidate,
    provenance: manual ? {
      source: "MANUAL_IMPORT", originalFilename: "fixture.json", sourceFingerprint: "a".repeat(64),
      declaredOrigin: candidate.declaredOrigin ?? null, verification: "UNVERIFIED",
    } : {
      source: "DETERMINISTIC_MOCK", templateFamily: "fictional-benefits-verification", templateVersion: "1.0.0",
      generatorVersion: "1.0.0", briefFingerprint: "a".repeat(64),
    },
  };
};
const report = async (candidate: AuthoringCandidate) => validateAuthoringDraft(await record(candidate), options);
function response(candidate: AuthoringCandidate, id: string, text: string) {
  candidate.draft.scenario.responses[id]!.text = text;
  candidate.draft.candidateApprovedResponses.find((entry) => entry.responseId === id)!.text = text;
  if (id === candidate.details.openingResponseId) candidate.draft.scenario.opening_line = text;
}
function route(candidate: AuthoringCandidate, turn: number, behavior: string) {
  return candidate.details.decisionPoints[turn]!.routes.findIndex((entry) => entry.behavior === behavior);
}
type Mutation = (candidate: AuthoringCandidate) => void;
const cases: [string, AuthoringRuleId, Mutation][] = [
  ["01 missing metadata", "SCHEMA_INVALID", (c) => { Reflect.deleteProperty(c.details, "industry"); }],
  ["02 missing opening", "RESPONSE_MISSING", (c) => { delete c.draft.scenario.responses["system.opening"]; }],
  ["03 missing terminal", "RESPONSE_MISSING", (c) => { delete c.draft.scenario.responses["ending.verified"]; }],
  ["04 wrong field type", "SCHEMA_INVALID", (c) => { Reflect.set(c.details, "audience", 42); }],
  ["05 unsupported schema", "SCHEMA_VERSION", (c) => { Reflect.set(c, "schemaVersion", 2); }],
  ["06 missing debrief", "DEBRIEF_COVERAGE", (c) => { c.details.debriefs = []; }],
  ["07 empty text", "SCHEMA_INVALID", (c) => { c.details.premise = ""; }],
  ["08 duplicate response", "RESPONSE_ID", (c) => { c.draft.candidateApprovedResponses.push(c.draft.candidateApprovedResponses[0]!); }],
  ["09 duplicate decision", "GRAPH_ID", (c) => { c.details.decisionPoints[1]!.nodeId = c.details.decisionPoints[0]!.nodeId; }],
  ["10 invalid identity", "IDENTITY_INVALID", (c) => { c.draft.scenario.scenario_id = "S-900"; }],
  ["11 cross-scenario reference", "IDENTITY_INVALID", (c) => {
    c.draft.importableArtifacts[0] = structuredClone(c.draft.importableArtifacts[0]!);
    c.draft.importableArtifacts[0]!.scenario.scenario_id = "S-92";
  }],
  ["12 dangling red flag", "RED_FLAG_REFERENCE", (c) => { c.details.variants[0]!.redFlags = ["RF-06"]; }],
  ["13 unknown tactic", "TACTIC_METADATA", (c) => { Reflect.set(c.details.variants[0]!, "tactic", "flattery"); }],
  ["14 duplicate tactic level", "TACTIC_COVERAGE", (c) => { c.details.variants[1]!.intensity = "low"; }],
  ["15 missing full-template variant", "TACTIC_COVERAGE", (c) => { c.details.variants.pop(); }],
  ["16 invalid intensity", "TACTIC_METADATA", (c) => { Reflect.set(c.details.variants[0]!, "intensity", "extreme"); }],
  ["17 mismatched response metadata", "RESPONSE_METADATA", (c) => { c.draft.candidateApprovedResponses[1]!.text = "A different line."; }],
  ["18 negative pressure", "PRESSURE_RANGE", (c) => { c.details.variants[0]!.pressureLevel = -1; }],
  ["19 pressure above global bound", "PRESSURE_RANGE", (c) => { c.details.variants[0]!.pressureLevel = 6; }],
  ["20 pressure above own ceiling", "PRESSURE_RANGE", (c) => { c.draft.scenario.adaptive_policy!.max_pressure_level = 2; }],
  ["21 unsupported pressure transition", "PRESSURE_TRANSITION", (c) => {
    c.draft.scenario.nodes[1]!.response_id = "system.safe-ending";
  }],
  ["22 terminal pressure escalation", "PRESSURE_TRANSITION", (c) => { c.details.terminalResponses.SAFE_VERIFIED = "authority.high"; }],
  ["23 invalid behavior", "BEHAVIOR_MAPPING", (c) => { Reflect.set(c.draft.behaviorTrainingExamples[0]!, "label", "PANICKED"); }],
  ["24 duplicate example", "BEHAVIOR_COVERAGE", (c) => { c.draft.behaviorTrainingExamples[1]!.exampleId = c.draft.behaviorTrainingExamples[0]!.exampleId; }],
  ["25 missing behavior category", "BEHAVIOR_COVERAGE", (c) => {
    c.draft.behaviorTrainingExamples.filter((entry) => entry.label === "UNKNOWN").forEach((entry) => { entry.label = "COMPLIED"; });
  }],
  ["26 disclosure without dummy", "BEHAVIOR_MAPPING", (c) => {
    c.draft.behaviorTrainingExamples.find((entry) => entry.label === "DISCLOSED_DUMMY_SECRET")!.utterance = "I read the example aloud.";
  }],
  ["27 contradictory behavior outcome", "BEHAVIOR_MAPPING", (c) => { c.details.examples[0]!.decision = "DUMMY_SECRET_DISCLOSED"; }],
  ["28 missing branch target", "GRAPH_TARGET", (c) => {
    c.details.decisionPoints[0]!.routes[route(c, 0, "STALLED")] = { behavior: "STALLED", action: "continue", nextNodeId: "missing-decision" };
  }],
  ["29 invalid turn index", "GRAPH_TURN", (c) => { c.details.decisionPoints[1]!.turn = 1; }],
  ["30 final-turn continuation", "GRAPH_TERMINAL", (c) => {
    c.details.decisionPoints[2]!.routes[route(c, 2, "STALLED")] = { behavior: "STALLED", action: "continue", nextNodeId: c.details.decisionPoints[0]!.nodeId };
  }],
  ["31 cycle beyond cap", "GRAPH_CYCLE", (c) => {
    c.details.decisionPoints[1]!.routes[route(c, 1, "REFUSED")] = { behavior: "REFUSED", action: "continue", nextNodeId: c.details.decisionPoints[0]!.nodeId };
  }],
  ["32 terminal-to-active transition", "GRAPH_TERMINAL", (c) => {
    c.details.decisionPoints[0]!.routes[route(c, 0, "VERIFIED_INDEPENDENTLY")] = {
      behavior: "VERIFIED_INDEPENDENTLY", action: "continue", nextNodeId: c.details.decisionPoints[1]!.nodeId,
    };
  }],
  ["33 missing disclosure", "DISCLOSURE_MISSING", (c) => { response(c, "system.opening", "Meghdoot wellness desk se baat kar raha hoon. Aapka form pending hai."); }],
  ["34 credential value", "SENSITIVE_VALUE", (c) => { c.details.premise = "Fictional negative test marker. OTP is " + ["731", "482"].join(""); }],
  ["35 payment identifier", "CONTACT_DATA", (c) => { c.details.premise = "Fictional negative payment marker learner@oktraining"; }],
  ["36 brand impersonation", "REAL_BRAND", (c) => { c.draft.scenario.fictional_organization.name = "Fictional State Bank of India"; }],
  ["37 operational caller instruction", "OPERATIONAL_INSTRUCTION", (c) => { response(c, "authority.low", "Meghdoot wellness exercise. Install AnyDesk to proceed."); }],
  ["38 unsafe recommendation", "GUIDANCE_UNSAFE", (c) => { c.details.safeActions.push("Trust the caller-supplied number as proof."); }],
  ["39 missing independent guidance", "GUIDANCE_MISSING", (c) => { c.details.safeActions = ["Pause before responding.", "End the simulation."]; }],
  ["40 unsupported secret format", "SENSITIVE_VALUE", (c) => { c.details.premise += " Synthetic negative marker DUMMY-12345."; }],
  ["41 unsupported language", "LANGUAGE_INVALID", (c) => { c.draft.scenario.language = "fr-FR"; }],
  ["42 invalid script declaration", "LANGUAGE_INVALID", (c) => { Reflect.set(c.details, "scriptPreference", "Unknown"); }],
  ["43 missing primary script", "SCRIPT_REVIEW", (c) => { c.details.scriptPreference = "Devanagari"; }],
  ["44 emotion inference", "DEBRIEF_INFERENCE", (c) => { c.details.debriefs[0]!.takeaway = "The learner was panicked."; }],
  ["45 invented verification", "DEBRIEF_FABRICATION", (c) => { c.details.debriefs[0]!.takeaway = "The learner completed external verification."; }],
  ["46 invented real disclosure", "DEBRIEF_FABRICATION", (c) => { c.details.debriefs[0]!.takeaway = "The learner shared a real password."; }],
  ["47 scoring an unobserved action", "SCORING_UNOBSERVED", (c) => { c.details.debriefs[0]!.scoring = "Always award one point."; }],
  ["48 missing outcome explanation", "DEBRIEF_COVERAGE", (c) => { c.details.debriefs.find((entry) => entry.outcome === "MAX_TURNS")!.outcome = null; }],
];
for (const [name, rule, mutate] of cases) test("6B negative " + name, async () => {
  const candidate = generate();
  mutate(candidate);
  const result = await report(candidate);
  const finding = result.findings.find((entry) => entry.ruleId === rule);
  assert.ok(finding, `${rule} absent: ${result.findings.map((entry) => entry.ruleId).join(", ")}`);
  assert.equal(finding.severity, rule === "SCRIPT_REVIEW" ? "WARNING" : "ERROR");
  assert.ok(finding.path.startsWith("/"));
  assert.ok(finding.message.length && finding.remediation.length);
  if (finding.severity === "ERROR") {
    assert.equal(result.status, "FAIL"); assert.equal(result.reviewEligible, false);
  }
});

test("6B negative 49 forged approval metadata", async () => {
  const candidate = generate();
  Reflect.set(candidate.draft, "status", "APPROVED");
  const result = await report(candidate);
  assert.ok(result.findings.some((finding) => finding.ruleId === "LIFECYCLE_FORGED"));
  assert.equal(result.reviewEligible, false);
});
test("6B negative 50 claimed verified Evon provenance", async () => {
  const saved = await record();
  Reflect.set(saved.provenance, "source", "REAL_EVON_VERIFIED");
  const result = await validateAuthoringDraft(saved, options);
  assert.ok(result.findings.some((finding) => finding.ruleId === "PROVENANCE_INVALID"));
  assert.equal(result.reviewEligible, false);
});
test("6B negative 51 stale content and validator reports", async () => {
  const saved = await record();
  const original = await validateAuthoringDraft(saved, options);
  const changed = structuredClone(saved);
  changed.candidate.details.title = "Changed safe metadata";
  assert.ok((await canSubmitForSafetyReview(changed, original, options)).reasons.includes("STALE_CONTENT"));
  assert.ok((await canSubmitForSafetyReview(saved, { ...original, validationVersion: "0.0.0" }, options)).reasons.includes("STALE_VALIDATOR"));
  assert.equal((await canSubmitForSafetyReview(saved, null, options)).eligible, false);
});
test("6B negative 52 tampered saved draft", async () => {
  const saved = await record();
  saved.candidate.details.title = "Changed without new hash";
  const result = await validateAuthoringDraft(saved, options);
  assert.ok(result.findings.some((entry) => entry.ruleId === "HASH_MISMATCH"));
  assert.equal(result.reviewEligible, false);
});
for (const [name, input] of [
  ["53 oversized JSON", new Uint8Array(draftJsonLimit + 1)],
  ["54 dangerous object keys", encode('{"constructor":{"prototype":{"polluted":true}}}')],
  ["56 invalid UTF-8", Uint8Array.from([0xc3, 0x28])],
  ["57 over-deep JSON", encode("[".repeat(22) + "0" + "]".repeat(22))],
] as const) test("6B negative " + name, async () => {
  const result = await validateAuthoringDraft(input, options);
  assert.equal(result.status, "FAIL"); assert.equal(result.reviewEligible, false);
  assert.ok(result.findings.some((finding) => finding.ruleId === "INPUT_INVALID"));
});
test("6B negative 55 import path traversal", async () => {
  const store = new LocalDraftStore(process.cwd(), safety);
  await assert.rejects(store.importFile("../candidate.json"), { code: "INVALID_DRAFT_PATH" });
});

async function passCandidate() {
  const candidate = generate();
  candidate.details.premise += " This exercise models unsolicited synthetic disclosure.";
  candidate.draft.debriefTemplateVariants.push({
    templateId: "complied", language: "hi-en", kind: "risky", status: "DRAFT",
    text: "Learner ne suggested practice action par sahmati di. Yeh token disclosure se alag observation hai.",
  });
  candidate.details.debriefs.push({
    templateId: "complied", behavior: "COMPLIED", outcome: null, redFlags: ["RF-02"],
    scoring: "Record agreement only when the learner explicitly accepts the suggested action.",
    nextAction: "Check the request through a familiar training channel before acting.",
    limitations: "Agreement alone does not establish token disclosure.",
    takeaway: "The learner can pause before confirming the practice request.",
  });
  return candidate;
}

test("6B positive S-90/S-91, two/three turns, complete coverage, scoped warnings and all bounded paths", async () => {
  for (const [candidate, expected] of [
    [generate(), [79, 66, 3, 13]],
    [JSON.parse(await readFile(new URL("../../../content/authoring/examples/benefits-import.json", import.meta.url), "utf8")) as AuthoringCandidate, [25, 21, 2, 14]],
  ] as const) {
    const saved = await record(candidate);
    const result = await validateAuthoringDraft(saved, options);
    assert.equal(result.status, "WARN");
    assert.equal(result.validationVersion, authoringValidationVersion);
    assert.equal(result.structuralValidation, "PASS");
    assert.deepEqual(result.summary, { errors: 0, warnings: 2, info: 1 });
    assert.deepEqual(result.findings.map((entry) => entry.ruleId), ["CONTENT_REVIEW", "COMPLIANCE_REVIEW", "DUMMY_CONTEXT"]);
    assert.ok(result.graph?.complete);
    assert.deepEqual([result.graph.reachablePrefixes, result.graph.terminalLeaves, result.graph.maximumDepth,
      result.graph.unreachableAuthoredVariants.length], expected);
    assert.deepEqual(result.graph.reachablePressures, [0, 2]);
    assert.equal(candidate.draft.scenario.adaptive_policy!.max_pressure_level, 3);
    assert.equal(result.reviewEligible, true);
    assert.equal((await canSubmitForSafetyReview(saved, result, options)).eligible, true);
    assert.equal(isScenarioRuntimeEligible(candidate.draft.scenario), false);
    assert.ok(AuthoringValidationResultSchema.safeParse(result).success);
  }
});
test("6B positive PASS, harmless warnings, deterministic findings, nonmutation and fresh metadata revision", async () => {
  const saved = await record(await passCandidate());
  const before = JSON.stringify(saved);
  const result = await validateAuthoringDraft(saved, options);
  assert.equal(result.status, "PASS", JSON.stringify(result.findings));
  assert.equal(result.reviewEligible, true);
  const again = await validateAuthoringDraft(saved, { ...options, checkedAt: "2026-11-07T01:00:00.000Z" });
  assert.deepEqual({ ...result, checkedAt: "" }, { ...again, checkedAt: "" });
  assert.equal(JSON.stringify(saved), before);
  const changed = structuredClone(saved.candidate);
  changed.details.title = "Revised descriptive working title";
  const fresh = await record(changed);
  const newResult = await validateAuthoringDraft(fresh, options);
  assert.notEqual(newResult.sourceHash, result.sourceHash);
  assert.equal((await canSubmitForSafetyReview(fresh, newResult, options)).eligible, true);
  assert.equal((await canSubmitForSafetyReview(fresh, result, options)).eligible, false);
});
test("6B educational credential words, negation, ordinary dates, Hindi punctuation and code mixing avoid blocking safety findings", async () => {
  const candidate = await passCandidate();
  candidate.details.premise += " The exercise year is 2026. OTP is confidential. Never share your OTP. Date 2026-11-07.";
  const result = await report(candidate);
  assert.equal(result.summary.errors, 0, JSON.stringify(result.findings));
  assert.ok(!result.findings.some((entry) => entry.ruleId === "SENSITIVE_VALUE"));
  assert.equal(result.reviewEligible, true);
});
test("6B authored levels use their own declared ceiling throughout existing intake and consolidated validation", async () => {
  const candidate = generate();
  candidate.draft.scenario.adaptive_policy!.max_pressure_level = 5;
  const result = await report(candidate);
  assert.equal(result.summary.errors, 0, JSON.stringify(result.findings));
  assert.deepEqual(candidate.details.variants.slice(0, 3).map((entry) => entry.pressureLevel), [1, 2, 3]);
  candidate.draft.scenario.adaptive_policy!.max_pressure_level = 2;
  assert.equal((await report(candidate)).status, "FAIL");
});
test("6B sensitive values and suspicious instructions are found across metadata, examples and recommendations without disclosure", async () => {
  for (const value of ["DUMMY-1234suffix", "ADUMMY-1234", "DUMMY-1234-extra", "dummy-1234",
    "API key = " + "fakeSyntheticKeyForNegativeFixture", "PIN is " + ["82", "74"].join(""),
    "ओटीपी " + ["८२७", "४७१"].join(""), "learner@training.invalid", "https://training.invalid"]) {
    const candidate = generate();
    candidate.details.premise = value;
    const result = await report(candidate);
    assert.equal(result.status, "FAIL", value);
    assert.ok(result.findings.some((finding) => ["SENSITIVE_VALUE", "CONTACT_DATA"].includes(finding.ruleId)));
    assert.ok(!JSON.stringify(result).includes(value));
  }
});
test("6B all text surfaces, imported metadata and new review context invalidate unsafe/stale results", async () => {
  const saved = await record();
  Reflect.set(saved.provenance, "source", "MANUAL_IMPORT");
  Reflect.set(saved.provenance, "originalFilename", "valid.json");
  // Build a valid imported envelope before checking the declared origin.
  saved.provenance = {
    source: "MANUAL_IMPORT", originalFilename: "valid.json", sourceFingerprint: "a".repeat(64),
    declaredOrigin: "Unverified gnani-evon-v3.3 claim", verification: "UNVERIFIED",
  };
  saved.candidate.declaredOrigin = saved.provenance.declaredOrigin ?? undefined;
  const hash = await hashAuthoringData(saved.candidate);
  saved.contentHash = hash; saved.candidateId = `import-${hash}`;
  const result = await validateAuthoringDraft(saved, options);
  assert.equal(result.summary.errors, 0);
  assert.ok(result.findings.some((finding) => finding.ruleId === "ORIGIN_UNVERIFIED"));
  const changedSafety = { ...safety, knownRealOrganizations: [...safety.knownRealOrganizations, "Fictional Meghdoot Works"] };
  const blocked = await canSubmitForSafetyReview(saved, result, { safety: changedSafety });
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.reasons.includes("STALE_POLICY"));
  assert.equal((await canSubmitForSafetyReview(saved, { ...result, status: "PASS", findings: [], reviewEligible: true }, options)).eligible, false);
});
test("6B in-memory hardening rejects accessors, toJSON, cycles, executable values and width abuse without executing", async () => {
  let executed = 0;
  const getter = {};
  Object.defineProperty(getter, "read", { enumerable: true, get() { executed++; return "bad"; } });
  const hidden = {};
  Object.defineProperty(hidden, "toJSON", { value: () => { executed++; return {}; } });
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  for (const input of [getter, hidden, cyclic, { payload: () => { executed++; } }, { wide: new Array(129).fill("x") }, { big: BigInt(1) }]) {
    const result = await validateAuthoringDraft(input, options);
    assert.equal(result.status, "FAIL"); assert.equal(result.reviewEligible, false);
  }
  assert.equal(executed, 0);
});
test("6B deterministic cap limits findings and paths never echo malicious ID/field values", async () => {
  const candidate = generate();
  const secretLikeKey = "private@example.invalid";
  Reflect.set(candidate.details, secretLikeKey, "not a schema field");
  const results = await Promise.all([report(candidate), report(candidate)]);
  assert.deepEqual(results[0], results[1]);
  assert.ok(!JSON.stringify(results).includes(secretLikeKey));
  const numericId = ["731", "482"].join("");
  const numeric = generate();
  numeric.draft.scenario.responses[numericId] = { text: "A fictional line.", safety_status: "draft" };
  assert.ok(!JSON.stringify(await report(numeric)).includes(numericId));
  const many = generate();
  many.draft.behaviorTrainingExamples.forEach((entry) => Reflect.set(entry, "label", "INVALID"));
  const result = await report(many);
  assert.ok(result.findings.length <= 81);
  const sorted = result.findings.map((entry) => entry.path + "\u0000" + entry.ruleId);
  assert.deepEqual(sorted, [...sorted].sort());
});
test("6B lineage checks predecessor hashes, identity, versions and cycles", async () => {
  const prior = await record();
  const candidate = generate();
  candidate.draft.scenario.version = "0.2.0"; candidate.draft.packageId = "S-90-0.2.0-draft";
  const next = await record(candidate); next.previousCandidateId = prior.candidateId;
  assert.equal((await validateAuthoringDraft(next, { ...options, lineage: [prior] })).summary.errors, 0);
  assert.equal((await validateAuthoringDraft(next, options)).reviewEligible, false);
  const tampered = structuredClone(prior); tampered.candidate.details.title = "tampered predecessor";
  assert.ok((await validateAuthoringDraft(next, { ...options, lineage: [tampered] })).findings.some((entry) => entry.ruleId === "LINEAGE_INVALID"));
  next.previousCandidateId = next.candidateId;
  assert.ok((await validateAuthoringDraft(next, { ...options, lineage: [prior] })).findings.some((entry) => entry.ruleId === "LINEAGE_INVALID"));
});
test("6B validation is offline, preserves active state, budgets and canonical content for PASS/WARN/FAIL", async (t) => {
  const state = freshPathSession("phase6b-active");
  const sessions = new InMemorySessionStore(); sessions.create(state);
  const budget = new RuntimeCreditLedger({ mode: "development", developmentCap: 4, publicDemoCap: 4, reserveCap: 0, usedUnits: 0 }, { stt: 1, tts: 1 }, 1, () => new Date(fixed));
  const snapshot = budget.snapshot(), before = structuredClone(sessions.get(state.sessionId));
  const forbidden = () => assert.fail("Validation attempted network/provider/credit work");
  t.mock.method(globalThis, "fetch", forbidden);
  t.mock.method(RuntimeCreditLedger.prototype, "reserve", forbidden);
  t.mock.method(RuntimeCreditLedger.prototype, "chargeSimulated", forbidden);
  const files = ["content/scenarios/S-01-urgent-account-verification.json", "content/authoring/S-01-hi-IN.package.json"];
  const originals = await Promise.all(files.map((file) => readFile(file)));
  const fail = generate(); fail.details.safeActions = [];
  for (const candidate of [await passCandidate(), generate(), fail]) {
    const saved = await record(candidate), result = await validateAuthoringDraft(saved, options);
    assert.equal(candidate.draft.status, "DRAFT");
    assert.equal(candidate.draft.runtimeEligible, false);
    assert.equal(isScenarioRuntimeEligible(candidate.draft.scenario), false);
    assert.equal((await canSubmitForSafetyReview(saved, result, options)).eligible, result.reviewEligible);
  }
  assert.deepEqual(sessions.get(state.sessionId), before);
  assert.deepEqual(budget.snapshot(), snapshot);
  assert.deepEqual(await Promise.all(files.map((file) => readFile(file))), originals);
});
test("6B S-02/S-03 metadata demos cannot authorize real caller playback", async (t) => {
  const server = createApiServer({ environment: "test" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  for (const id of ["S-02", "S-03"]) {
    const filename = id === "S-02" ? "S-02-insurance-refund-trap.json" : "S-03-telecom-kyc-lockout.json";
    const scenario = JSON.parse(await readFile(join("content/scenarios", filename), "utf8"));
    const httpResponse: Response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: id, scenarioVersion: scenario.version, language: "hi-IN", runtimeMode: "REAL_CONVERSATION", demoMode: false }),
    });
    assert.equal((await httpResponse.json()).error.code, "INVALID_SCENARIO");
  }
});
test("6B UI renders actionable findings and eligibility without a review/publish control", async () => {
  const result = await report(generate());
  const html = renderToStaticMarkup(<AuthoringValidationFindings result={result} />);
  for (const expected of ["Safety validation WARN", "Review eligible Yes", "Errors 0", "Warnings 2",
    "BEHAVIOR", "DUMMY_CONTEXT", "/details/examples", authoringRules.DUMMY_CONTEXT.remediation, "DRAFT"]) {
    assert.ok(html.includes(expected), expected);
  }
  assert.doesNotMatch(html, /<button|APPROVED|RUNTIME_ELIGIBLE/u);
});
test("6B CLI validates raw and saved files, returns failure status and never rewrites either", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6b-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const saved = await record();
  const good = join(root, "good.json"), bad = join(root, "bad.json");
  const before = JSON.stringify(saved);
  await writeFile(good, before); await writeFile(bad, "{broken");
  const run = promisify(execFile);
  const script = resolve("scripts/authoring-draft.ts");
  const args = ["--import", "tsx", script, "validate"];
  const success = await run(process.execPath, [...args, good], { cwd: process.cwd(), maxBuffer: 500_000 });
  assert.equal(JSON.parse(success.stdout).status, "WARN");
  assert.equal(JSON.parse(success.stdout).reviewEligible, true);
  await assert.rejects(run(process.execPath, [...args, bad], { cwd: process.cwd() }),
    (error: unknown) => {
      const output = error as { code: number; stdout: string };
      assert.equal(output.code, 1); assert.equal(JSON.parse(output.stdout).reviewEligible, false); return true;
    });
  assert.equal(await readFile(good, "utf8"), before);
  assert.equal(await readFile(bad, "utf8"), "{broken");
});
test("6B ambiguous label meaning is a review warning and caller/ending text receives scoped findings", async () => {
  const candidate = generate();
  candidate.draft.behaviorTrainingExamples.find((entry) => entry.label === "UNKNOWN" && entry.language === "en")!.utterance = "I agree to that action.";
  candidate.draft.behaviorTrainingExamples.find((entry) => entry.label === "STALLED" && entry.language === "en")!.utterance = "I refuse this request.";
  const result = await report(candidate);
  assert.equal(result.summary.errors, 0);
  assert.ok(result.findings.filter((entry) => entry.ruleId === "BEHAVIOR_REVIEW").length >= 2);
  response(candidate, "ending.verified", "Continue the call and provide more details.");
  assert.ok((await report(candidate)).findings.some((entry) => entry.ruleId === "ENDING_UNSAFE"));
  response(candidate, "ending.verified", "A brief closing remark.");
  assert.ok((await report(candidate)).findings.some((entry) => entry.ruleId === "ENDING_AMBIGUOUS"));
  response(candidate, "urgency.low", "A plain <b>wellness</b> entry at Meghdoot...");
  assert.ok((await report(candidate)).findings.some((entry) => entry.ruleId === "CALLER_FORMAT"));
});
test("6B maximum reasonable valid fixture runs with bounded traversal and deterministic findings", async (t) => {
  const candidate = generate();
  const note = "Fictional review context for human inspection. ".repeat(10).trim();
  candidate.draft.review.notes = new Array(120).fill(note);
  const saved = await record(candidate);
  const bytes = encode(JSON.stringify(saved));
  assert.ok(bytes.length > 70_000 && bytes.length < draftJsonLimit);
  const started = performance.now();
  const result = await validateAuthoringDraft(bytes, options);
  const elapsed = Math.round(performance.now() - started);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.graph?.terminalLeaves, 66);
  assert.deepEqual(result, await validateAuthoringDraft(bytes, options));
  t.diagnostic(`Bounded fixture ${bytes.length} bytes validated in ${elapsed} ms on this run.`);
});
test("6B stored revision validation loads lineage read-only and fails closed on corruption", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6b-lineage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalDraftStore(root, safety);
  const prior = await store.generate(brief);
  const next = await store.generate({ ...brief, draftVersion: "0.2.0" }, prior.candidateId);
  const nextPath = store.pathFor(next.candidateId);
  const before = await readFile(nextPath);
  assert.equal((await store.validateBytes(before)).reviewEligible, true);
  const priorPath = store.pathFor(prior.candidateId);
  await writeFile(priorPath, "{damaged");
  const after = await store.validateBytes(before);
  assert.ok(after.findings.some((entry) => entry.ruleId === "LINEAGE_INVALID"));
  assert.equal(after.reviewEligible, false);
  assert.deepEqual(await readFile(nextPath), before);
});
test("6B missing safety configuration, unrecognized fiction and named staff require explicit findings", async () => {
  const saved = await record();
  assert.equal((await validateAuthoringDraft(saved, { safety: { knownRealOrganizations: [], forbiddenOperationalPhrases: [] } })).reviewEligible, false);
  saved.candidate.draft.scenario.fictional_organization.name = "Fictional Unlisted Training Works";
  const revised = await record(saved.candidate);
  assert.ok((await validateAuthoringDraft(revised, options)).findings.some((entry) => entry.ruleId === "ENTITY_REVIEW"));
  revised.provenance = { source: "DETERMINISTIC_MOCK", templateFamily: "fictional-benefits-verification", templateVersion: "1.0.0", generatorVersion: "9.0.0", briefFingerprint: "a".repeat(64) };
  assert.ok((await validateAuthoringDraft(revised, options)).findings.some((entry) => entry.ruleId === "PROVENANCE_INVALID"));
});
