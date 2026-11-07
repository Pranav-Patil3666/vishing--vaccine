import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canonicalDraftJson, DeterministicMockScenarioGenerator, draftBehaviors, draftJsonLimit, draftOutcomes,
  isScenarioRuntimeEligible, parseAuthoringCandidate, parseDraftJson, parseMockDraftBrief, tacticCategories,
  type AuthoringCandidate, type DraftAuthoringError,
} from "@vaccine/scenario-schema";
import { createApiServer } from "../../api/src/health.js";
import { LocalDraftStore } from "../../api/src/authoring/draftStore.js";
import { MockPrismaRecognizer } from "../../api/src/providers/prisma/mockPrisma.js";
import { MockTimbreSynthesizer } from "../../api/src/providers/timbre/mockTimbre.js";
import { AuthoringDraftPreview, readDraftPreview } from "./pages/AuthoringPage.js";
import { scenarioById, scenarioCatalog } from "./scenarioCatalog.js";
import safety from "../../../content/safety/review-reference-lists.json";
import demoBrief from "../../../content/authoring/examples/benefits-brief.json";

const importFixture = new URL("../../../content/authoring/examples/benefits-import.json", import.meta.url);
const s01 = new URL("../../../content/scenarios/S-01-urgent-account-verification.json", import.meta.url);
const approved = new URL("../../../content/authoring/S-01-hi-IN.package.json", import.meta.url);
const generator = new DeterministicMockScenarioGenerator();
const generate = () => generator.generateDraft(parseMockDraftBrief(demoBrief));
const code = (value: DraftAuthoringError["code"]) => ({ code: value });
const encode = (value: string) => new TextEncoder().encode(value);

async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6a-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalDraftStore(root, safety);
  const imported = join(root, "अपना अभ्यास.json");
  await writeFile(imported, await readFile(importFixture));
  return { root, store, imported };
}

test("6A complete preset has localized opening, 15 distinct tactics, 18 contextual examples and six debriefs", () => {
  const candidate = parseAuthoringCandidate(generate(), safety);
  const { draft, details } = candidate;
  assert.equal(draft.scenario.fictional_organization.name, "Fictional Meghdoot Works");
  assert.match(draft.scenario.opening_line, /Meghdoot Works.*wellness/u);
  assert.match(draft.scenarioBrief.learningObjective, /channel you already know/u);
  assert.equal(details.department, "Employee Benefits Practice Desk");
  assert.equal(details.audience, demoBrief.audience);
  assert.equal(details.difficulty, demoBrief.difficulty);
  assert.equal(draft.scenario.language, "hi-en");
  assert.equal(details.safeActions.length, 4);
  assert.equal(details.redFlags.length, 5);
  for (const category of Object.keys(tacticCategories)) {
    const variants = details.variants.filter((item) => item.tactic === category);
    assert.deepEqual(variants.map((item) => [item.intensity, item.pressureLevel]), [["low", 1], ["medium", 2], ["high", 3]]);
    for (const variant of variants) {
      assert.match(draft.scenario.responses[variant.responseId]!.text, /Meghdoot.*wellness/u);
      assert.ok(details.redFlags.some((flag) => variant.redFlags.includes(flag.id) && flag.tactics.some((key) => key === category)));
    }
  }
  assert.equal(new Set(details.variants.map((item) => draft.scenario.responses[item.responseId]!.text)).size, 15);
  assert.equal(draft.behaviorTrainingExamples.length, 18);
  for (const label of draftBehaviors) {
    const examples = draft.behaviorTrainingExamples.filter((item) => item.label === label);
    assert.deepEqual(examples.map((entry) => entry.language), ["hi", "hi-en", "en"]);
    assert.ok(examples.every((entry) => /\bDUMMY-\d{4}\b/u.test(entry.utterance) === (label === "DISCLOSED_DUMMY_SECRET")));
    assert.equal(new Set(examples.map((entry) => entry.utterance)).size, 3);
  }
  assert.match(draft.behaviorTrainingExamples.find((entry) => entry.label === "UNKNOWN")!.utterance, /बारिश/u);
  assert.equal(details.debriefs.length, 6);
  assert.ok(details.debriefs.every((entry) => entry.scoring && entry.limitations && entry.nextAction));
  assert.ok(draftOutcomes.every((outcome) => details.debriefs.some((entry) => entry.outcome === outcome)));
  assert.match(details.debriefs.find((entry) => entry.outcome === "SAFE_VERIFIED")!.scoring, /only when/u);
  assert.doesNotMatch(canonicalDraftJson(candidate), /\b(?:TODO|Lorem ipsum|TBD)\b/iu);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.review.decision, "pending");
  assert.equal(draft.runtimeEligible, false);
  assert.equal(isScenarioRuntimeEligible(draft.scenario), false);
});

test("6A branch rows agree with canonical response and pressure metadata and terminate at the cap", () => {
  const { draft, details } = parseAuthoringCandidate(generate(), safety);
  assert.equal(details.decisionPoints.length, 3);
  for (const [index, point] of details.decisionPoints.entries()) {
    assert.equal(point.routes.length, 6);
    const next = details.decisionPoints[index + 1];
    for (const route of point.routes) {
      if (route.action === "continue") {
        assert.equal(route.nextNodeId, next?.nodeId);
        assert.ok(["REFUSED", "STALLED", "COMPLIED"].includes(route.behavior));
        const nextNode = draft.scenario.nodes.find((node) => node.id === route.nextNodeId)!;
        assert.equal(details.variants.find((entry) => entry.responseId === nextNode.response_id)?.pressureLevel, 2);
      } else {
        assert.ok(draft.scenario.responses[details.terminalResponses[route.outcome]]);
      }
    }
    if (!next) {
      assert.ok(point.routes.every((route) => route.action === "terminal"));
      assert.deepEqual(point.routes.find((route) => route.behavior === "UNKNOWN"),
        { behavior: "UNKNOWN", action: "terminal", outcome: "MAX_TURNS" });
    }
  }
});

test("6A normalized briefs yield identical semantics and ordering, with deliberate script/turn variations", () => {
  const first = generate();
  const equivalent = generator.generateDraft(parseMockDraftBrief({
    ...demoBrief, title: `  ${demoBrief.title} `, redFlags: ["RF-08", "RF-07", "RF-03", "RF-02", "RF-01"],
  }));
  assert.deepEqual(first, equivalent);
  const hindi = parseAuthoringCandidate(generator.generateDraft(parseMockDraftBrief({
    ...demoBrief, scriptPreference: "Devanagari", maxLearnerTurns: 2, learningObjective: "pause-before-confirming",
  })), safety);
  assert.match(hindi.draft.scenario.opening_line, /मेघदूत/u);
  assert.match(hindi.draft.scenarioBrief.learningObjective, /^Pause/u);
  assert.equal(hindi.details.decisionPoints.length, 2);
  assert.equal(hindi.details.variants.length, 15);
});

test("6A unsupported template and arbitrary brief premise/options are rejected", () => {
  assert.throws(() => parseMockDraftBrief({ ...demoBrief, templateFamily: "arbitrary-bank" }), code("UNSUPPORTED_TEMPLATE"));
  for (const delta of [{ premise: "arbitrary" }, { maxLearnerTurns: 99 }, { scenarioId: "S-01" },
    { draftVersion: "../v2" }, { title: "A".repeat(101) }, { redFlags: ["RF-06"] },
    { learningObjective: "custom caller script" }, { language: "en" }]) {
    assert.throws(() => parseMockDraftBrief({ ...demoBrief, ...delta }), code("INVALID_AUTHORING_BRIEF"));
  }
});

const negative: [string, DraftAuthoringError["code"], (draft: AuthoringCandidate) => void][] = [
  ["missing metadata", "INVALID_DRAFT_SCHEMA", (value) => { Reflect.deleteProperty(value.details, "premise"); }],
  ["missing opening", "INVALID_CANDIDATE_REFERENCE", (value) => { delete value.draft.scenario.responses["system.opening"]; }],
  ["missing terminal", "INVALID_CANDIDATE_REFERENCE", (value) => { delete value.draft.scenario.responses["ending.verified"]; }],
  ["missing tactic variant", "INVALID_DRAFT_SCHEMA", (value) => { value.details.variants.pop(); }],
  ["duplicate response ID", "DUPLICATE_RESPONSE_ID", (value) => { value.draft.candidateApprovedResponses.push(value.draft.candidateApprovedResponses[0]!); }],
  ["unsupported tactic", "INVALID_DRAFT_SCHEMA", (value) => { Reflect.set(value.details.variants[0]!, "tactic", "flattery"); }],
  ["unsupported behavior", "INVALID_DRAFT_SCHEMA", (value) => { Reflect.set(value.draft.behaviorTrainingExamples[0]!, "label", "SCARED"); }],
  ["invalid pressure", "INVALID_DRAFT_SCHEMA", (value) => { value.details.variants[0]!.pressureLevel = 8; }],
  ["contradictory response pressure", "INVALID_CANDIDATE_REFERENCE", (value) => { value.draft.tacticPool[0]!.pressureLevel = 3; }],
  ["dangling branch", "INVALID_CANDIDATE_REFERENCE", (value) => {
    const route = value.details.decisionPoints[0]!.routes.find((route) => route.action === "continue")!;
    if (route.action === "continue") route.nextNodeId = "missing-node";
  }],
  ["cycle", "INVALID_CANDIDATE_REFERENCE", (value) => { value.draft.scenario.nodes[2]!.next_node_id = value.draft.scenario.nodes[0]!.id; }],
  ["invalid turn limit", "INVALID_CANDIDATE_REFERENCE", (value) => { value.draft.scenario.adaptive_policy!.max_turns = 4; }],
  ["missing safe action", "INVALID_DRAFT_SCHEMA", (value) => { value.details.safeActions = []; }],
  ["missing debrief", "INVALID_DRAFT_SCHEMA", (value) => { value.details.debriefs = []; }],
  ["credential-like content", "UNSAFE_DRAFT_CONTENT", (value) => { value.details.premise = "Invalid practice marker DUMMY-12."; }],
  ["configured organization impersonation", "UNSAFE_DRAFT_CONTENT", (value) => { value.draft.scenario.fictional_organization.name = "Fictional State Bank of India"; }],
  ["claimed approval", "UNAUTHORIZED_LIFECYCLE_STATUS", (value) => { Reflect.set(value.draft, "status", "APPROVED"); }],
  ["claimed runtime eligibility", "UNAUTHORIZED_LIFECYCLE_STATUS", (value) => { Reflect.set(value.draft.scenario, "lifecycle_status", "RUNTIME_ELIGIBLE"); }],
  ["claimed checklist passes", "UNAUTHORIZED_LIFECYCLE_STATUS", (value) => { value.draft.review.checklist.fictionalOrganization = true; }],
  ["unsupported schema version", "UNSUPPORTED_IMPORT_FORMAT", (value) => { Reflect.set(value, "schemaVersion", 4); }],
  ["trusted model claim", "INVALID_DRAFT_SCHEMA", (value) => { Reflect.set(value, "source", "REAL_EVON_VERIFIED"); }],
  ["executable instruction key", "INVALID_DRAFT_SCHEMA", (value) => { Reflect.set(value.draft.scenario.nodes[1]!.trigger_rules[0]!, "execute", "fetch remote"); }],
  ["reserved identity", "INVALID_DRAFT_SCHEMA", (value) => { value.draft.scenario.scenario_id = value.draft.scenarioBrief.scenarioId = "S-01"; }],
];

for (const [title, expected, mutate] of negative) {
  test(`6A rejects ${title}`, () => {
    const candidate = generate();
    mutate(candidate);
    assert.throws(() => parseAuthoringCandidate(parseDraftJson(encode(JSON.stringify(candidate))), safety), code(expected));
  });
}

test("6A JSON intake bounds UTF-8, depth, arrays, dangerous keys, top-level type and bytes", () => {
  for (const text of ["{broken", "", "   "]) assert.throws(() => parseDraftJson(encode(text)), code("INVALID_IMPORT_JSON"));
  assert.throws(() => parseDraftJson(Uint8Array.from([0xc3, 0x28])), code("INVALID_IMPORT_JSON"));
  assert.throws(() => parseDraftJson(new Uint8Array(draftJsonLimit + 1)), code("IMPORT_TOO_LARGE"));
  assert.throws(() => parseDraftJson(encode('{"responses":{"authority.low":1,"authority\\u002elow":2}}')), code("DUPLICATE_JSON_KEY"));
  for (const text of ['{"__proto__":{"polluted":true}}', '{"nested":{"constructor":{}}}', '{"prototype":{}}',
    "[".repeat(22) + "0" + "]".repeat(22), JSON.stringify(Array.from({ length: 129 }, () => 0))]) {
    assert.throws(() => parseDraftJson(encode(text)), code("UNSUPPORTED_IMPORT_FORMAT"));
  }
  for (const text of ["[]", "null", "42"]) {
    assert.throws(() => parseAuthoringCandidate(parseDraftJson(encode(text)), safety), code("UNSUPPORTED_IMPORT_FORMAT"));
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("6A generates, imports, reloads, verifies Unicode, renders both badges and retains version history", async (t) => {
  const { store, imported } = await harness(t);
  assert.deepEqual(await store.list(), []);
  const mock = await store.generate(demoBrief);
  const manual = await store.importFile(imported);
  const revision = await store.generate({ ...demoBrief, draftVersion: "0.2.0" }, mock.candidateId);
  assert.equal(revision.previousCandidateId, mock.candidateId);
  assert.equal(revision.candidate.draft.scenario.version, "0.2.0");
  assert.equal((await store.load(mock.candidateId)).candidate.draft.scenario.version, "0.1.0");
  assert.equal((await store.list()).length, 3);
  assert.notEqual(mock.candidateId, manual.candidateId);
  assert.equal(mock.provenance.source, "DETERMINISTIC_MOCK");
  assert.equal(manual.provenance.source, "MANUAL_IMPORT");
  if (manual.provenance.source === "MANUAL_IMPORT") {
    assert.equal(manual.provenance.originalFilename, "अपना अभ्यास.json");
    assert.equal(manual.provenance.verification, "UNVERIFIED");
    assert.match(manual.provenance.declaredOrigin ?? "", /adapted from the deterministic benefits template/u);
  }
  for (const [saved, label] of [[mock, "MOCK GENERATED — DRAFT"], [manual, "MANUALLY IMPORTED — DRAFT"]] as const) {
    assert.deepEqual(await store.load(saved.candidateId), saved);
    assert.equal(saved.candidate.draft.runtimeEligible, false);
    const file = new File([await readFile(store.pathFor(saved.candidateId))], "draft.json");
    const preview = await readDraftPreview(file);
    const html = renderToStaticMarkup(<AuthoringDraftPreview saved={preview} />);
    for (const expected of [label, "Human approval absent", "urgency.high", "UNKNOWN", "MAX_TURNS", "Debrief and observable scoring", "नामांकन"]) {
      assert.ok(html.includes(expected), expected);
    }
    assert.doesNotMatch(html, /AI generated by Evon|Start simulation/iu);
  }
  await assert.rejects(store.generate({ ...demoBrief, scenarioId: "S-92", draftVersion: "0.2.0" }, mock.candidateId),
    code("INVALID_CANDIDATE_REFERENCE"));
  await assert.rejects(store.generate(demoBrief, ""), code("INVALID_DRAFT_PATH"));
});

test("6A identical simultaneous saves and repeat imports are rejected without overwriting", async (t) => {
  const { store, imported } = await harness(t);
  const results = await Promise.allSettled([store.generate(demoBrief), store.generate(demoBrief)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const loser = results.find((result) => result.status === "rejected");
  assert.equal(loser?.reason?.code, "CANDIDATE_ALREADY_EXISTS");
  const first = await store.importFile(imported);
  await assert.rejects(store.importFile(imported), code("CANDIDATE_ALREADY_EXISTS"));
  assert.deepEqual(await store.load(first.candidateId), first);
});

test("6A provider declaration is retained solely as unverified and approval claims never persist", async (t) => {
  const { store, root } = await harness(t);
  const file = join(root, "claim.json");
  const candidate = generate();
  candidate.declaredOrigin = "Declared model origin: gnani-evon-v3.3";
  await writeFile(file, JSON.stringify(candidate));
  const manual = await store.importFile(file);
  assert.equal(manual.provenance.source, "MANUAL_IMPORT");
  assert.ok(manual.provenance.source === "MANUAL_IMPORT" && manual.provenance.verification === "UNVERIFIED");
  Reflect.set(candidate.draft, "runtimeEligible", true);
  await writeFile(file, JSON.stringify(candidate));
  await assert.rejects(store.importFile(file), code("UNAUTHORIZED_LIFECYCLE_STATUS"));
  assert.deepEqual(await store.list(), [manual]);
});

test("6A rejects unsafe file paths, oversized file, write failure and corrupted saved content", async (t) => {
  const { store, root } = await harness(t);
  await assert.rejects(store.load("../S-01"), code("INVALID_DRAFT_PATH"));
  await assert.rejects(store.importFile(join(root, "payload.txt")), code("INVALID_DRAFT_PATH"));
  await assert.rejects(store.importFile("\\\\example.invalid\\candidate.json"), code("INVALID_DRAFT_PATH"));
  const oversized = join(root, "big.json");
  await writeFile(oversized, new Uint8Array(draftJsonLimit + 1));
  await assert.rejects(store.importFile(oversized), code("IMPORT_TOO_LARGE"));
  const unavailable = new LocalDraftStore(join(root, "missing"), safety);
  await assert.rejects(unavailable.generate(demoBrief), code("DRAFT_STORAGE_FAILED"));
  const saved = await store.generate(demoBrief);
  saved.candidate.details.title = "Altered after saving";
  await writeFile(store.pathFor(saved.candidateId), JSON.stringify(saved));
  await assert.rejects(store.load(saved.candidateId), code("INVALID_CANDIDATE_REFERENCE"));
  await assert.rejects(readDraftPreview(new File([JSON.stringify(saved)], "draft.json")), code("INVALID_CANDIDATE_REFERENCE"));
});

test("6A authoring leaves active S-01, approved files, runtime catalog, provider adapters and credits untouched", async (t) => {
  const { store, imported } = await harness(t);
  const originals = await Promise.all([readFile(s01), readFile(approved)]);
  const forbidden = () => assert.fail("Draft authoring attempted a provider operation.");
  const recognizer = new MockPrismaRecognizer();
  const synthesizer = new MockTimbreSynthesizer();
  const stt = t.mock.fn(forbidden);
  const transcribe = t.mock.method(recognizer, "transcribe", forbidden);
  const tts = t.mock.method(synthesizer, "synthesize", forbidden);
  const server = createApiServer({
    environment: "test", recognizer,
    runtimeRecognizer: { openStream: stt, transcribe: recognizer.transcribe.bind(recognizer) }, synthesizer,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const fetchLocal = globalThis.fetch.bind(globalThis);
  const network = t.mock.method(globalThis, "fetch", forbidden);
  const post = (url: string, payload: object) => fetchLocal(base + url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const create = await post("/api/sessions", {
    scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", demoMode: false, runtimeMode: "REAL_CONVERSATION",
  });
  const creation = await create.json();
  assert.equal(create.status, 201, creation.error?.code);
  const { session } = creation;
  const read = async (path: string) => (await fetchLocal(base + path)).json();
  const sessionPath = `/api/sessions/${session.sessionId}`;
  assert.equal((await post(`${sessionPath}/consent`, { consentVersion: "training-consent-v1" })).status, 200);
  assert.equal((await post(`${sessionPath}/conversation/start`, { audioClockId: "3cd85e75-51f8-43c4-8408-a25163087ad5" })).status, 200);
  const originalSession = await read(sessionPath);
  assert.equal(originalSession.session.conversation.phase, "CALLER_PREPARING");
  const originalCredit = await read("/api/runtime/credit");
  const generated = await store.generate(demoBrief);
  const manual = await store.importFile(imported);
  for (const candidate of [generated, manual]) {
    const scenario = candidate.candidate.draft.scenario;
    assert.equal(isScenarioRuntimeEligible(scenario), false);
    assert.equal(scenarioById(scenario.scenario_id), undefined);
    const rejected = await post("/api/sessions", {
      scenarioId: scenario.scenario_id, scenarioVersion: scenario.version, language: "hi-IN", demoMode: false, runtimeMode: "REAL_CONVERSATION",
    });
    assert.equal((await rejected.json()).error.code, "SCENARIO_NOT_FOUND");
  }
  assert.equal(scenarioCatalog.filter(isScenarioRuntimeEligible).length, 1);
  assert.deepEqual(await read(sessionPath), originalSession);
  assert.deepEqual(await read("/api/runtime/credit"), originalCredit);
  assert.deepEqual(await Promise.all([readFile(s01), readFile(approved)]), originals);
  assert.deepEqual([stt, transcribe, tts, network].map((spy) => spy.mock.callCount()), [0, 0, 0, 0]);
});
