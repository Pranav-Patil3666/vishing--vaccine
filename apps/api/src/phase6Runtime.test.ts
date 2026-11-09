import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { reviewChecklist, hashAuthoringData, ScenarioDocumentSchema, type AuthoringCandidate, type ReviewAction, type ReviewCommit } from "@vaccine/scenario-schema";
import { LocalDraftStore } from "./authoring/draftStore.js";
import { LocalReviewStore, type ReviewStoreOptions } from "./authoring/reviewStore.js";
import { createApiServer, type HealthServerOptions } from "./health.js";
import { InMemorySessionStore } from "./sessionStore.js";
import { ApprovedCallerCatalog } from "./callerAudio/catalog.js";
import { CallerAudioService } from "./callerAudio/service.js";
import { TimbreSpeechSynthesizer } from "./providers/timbre/timbreSpeechSynthesizer.js";
import { TIMBRE_PROFILE } from "./providers/timbre/runtimeConfig.js";
import { MockPrismaRecognizer } from "./providers/prisma/mockPrisma.js";
import { callerWavFixture } from "./testing/callerWavFixture.js";

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const safety = await readJson("content/safety/review-reference-lists.json");
const canonical = "content/scenarios/S-01-urgent-account-verification.json";
const source = await readJson("content/authoring/examples/S-92-v0.1.1.candidate.json") as AuthoringCandidate;
const actor = { author: "local-author", reviewer: "local-reviewer", publisher: "local-publisher" };
const checklist = Object.fromEntries(Object.entries(reviewChecklist).map(([id, item]) => [id,
  item.critical ? { decision: "PASS", reason: "" } : { decision: "NOT_APPLICABLE", reason: "These synthetic tests make no formal translation claim." }]));
const consent = { consentVersion: "training-consent-v1" };
const select = (scenarioId = "S-93", scenarioVersion = "0.1.1") => ({ scenarioId, scenarioVersion, language: "hi-en", demoMode: false });

async function workspace(t: TestContext, scenariosDirectory = "content/scenarios") {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6d-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  const paths = [canonical, "content/authoring/S-01-hi-IN.package.json", "content/safety/review-reference-lists.json",
    "content/scenarios/S-02-insurance-refund-trap.json", "content/scenarios/S-03-telecom-kyc-lockout.json"];
  for (const path of paths) {
    const target = join(root, path.replace("content/scenarios", scenariosDirectory));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(path, target);
  }
  return root;
}

function candidate(id = "S-93", compatible = true) {
  const copy = structuredClone(source);
  const { draft, details } = copy;
  const scenario = draft.scenario;
  scenario.scenario_id = id;
  draft.scenarioBrief.scenarioId = id;
  draft.packageId = `${id}-${scenario.version}-draft`;
  if (compatible) {
    details.runtimeProfile = "offline-adaptive-v1";
    for (const outcome of ["SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"] as const) {
      delete scenario.responses[details.terminalResponses[outcome]];
      details.terminalResponses[outcome] = "system.safe-ending";
    }
    scenario.adaptive_policy!.tactics.forEach((tactic) => {
      tactic.behavior_targets = ["authority.medium", "fear.medium"].includes(tactic.tactic_id)
        ? ["REFUSED", "STALLED", "COMPLIED"] : ["VERIFIED_INDEPENDENTLY"];
    });
    for (const node of scenario.nodes) node.debrief_tags = [...scenario.nodes[0]!.debrief_tags];
    draft.candidateApprovedResponses = draft.candidateApprovedResponses.filter((entry) => Boolean(scenario.responses[entry.responseId]));
  }
  draft.importableArtifacts = [{ artifactId: `${id}-${scenario.version}-scenario`, format: "scenario-json", scenario: structuredClone(scenario) }];
  return copy;
}

async function setup(root: string, value = candidate(), options: ReviewStoreOptions = {}) {
  const drafts = new LocalDraftStore(root, safety);
  const store = new LocalReviewStore(root, safety, options);
  if ((await store.status()).sequence === 0) await store.configure(await readJson("content/authoring/examples/review-actors.example.json"));
  const path = join(root, `fixture-${value.draft.scenario.scenario_id}.json`);
  await writeFile(path, JSON.stringify(value));
  const saved = await drafts.importFile(path);
  const inspect = () => store.export(saved.candidateId);
  async function act(action: ReviewAction, evidence: unknown, who: string) {
    return store.transition(await store.prepare(saved.candidateId, action, evidence), who);
  }
  await act("adopt", { confirmed: true }, actor.author);
  const submit = async () => {
    const validation = (await inspect()).item.validation;
    assert.equal(validation.status, "PASS", JSON.stringify(validation.findings));
    const submitted = await act("submit", { validation }, actor.author);
    const reviewId = submitted.item.review!.reviewId;
    await act("start", { reviewId }, actor.reviewer);
    return reviewId;
  };
  const approve = async (reviewId: string) => {
    await act("checklist", { reviewId, items: checklist }, actor.reviewer);
    return (await act("approve", { reviewId, confirmed: true, notes: "Isolated synthetic approval fixture for runtime tests.",
      decisionReason: "Exercise trusted release compilation offline in temporary storage." }, actor.reviewer)).item.approval!;
  };
  const publication = async (target = "offline-adaptive") => ({ target, confirmed: true, approvalId: (await inspect()).item.approval!.approvalId });
  const publish = async (target?: string) => act("publish", await publication(target), actor.publisher);
  const ready = async () => { await approve(await submit()); return publish(); };
  return { store, drafts, saved, act, inspect, submit, approve, publish, publication, ready };
}

async function serve(t: TestContext, root: string, options: Partial<HealthServerOptions> = {}) {
  const sessionStore = new InMemorySessionStore();
  let simulatedClock = Date.now();
  const server = createApiServer({ environment: "test", runtimeWorkspace: root, sessionStore,
    now: () => new Date(simulatedClock += 61_000), ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string) => fetch(base + path);
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const list = async () => ScenarioDocumentSchema.array().parse((await (await get("/api/runtime/scenarios")).json()).scenarios);
  return { get, post, list, sessionStore };
}

test("6D raw drafts, copied packages, names, forged fields and direct session bypasses never enter runtime", async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, "content/scenarios/S-93-approved.json"), JSON.stringify({ ...candidate(), approved: true, runtimeEligible: true }));
  await writeFile(join(root, "content/scenarios/S-01-looking.json"), JSON.stringify({ ...source.draft.scenario, scenario_id: "S-01", lifecycle_status: "RUNTIME_ELIGIBLE" }));
  const saved = await setup(root);
  const denied: string[] = [];
  const forbidden = () => assert.fail("Rejected request reached a provider boundary");
  const recognizer = new MockPrismaRecognizer();
  t.mock.method(recognizer, "transcribe", forbidden);
  const api = await serve(t, root, { runtimeRecognizer: { openStream: forbidden, transcribe: forbidden },
    synthesizer: { synthesize: forbidden }, recognizer, onRuntimeDenial: (event) => denied.push(event.code) });
  const listed = await api.list();
  assert.deepEqual(listed.map((entry) => entry.scenario_id), ["S-01"]);
  for (const id of ["S-90", "S-91", "S-92", "S-93", "S-99", "../S-01", "D:/S-01"]) {
    const response = await api.post("/api/sessions", select(id));
    assert.equal(response.status, 404, id);
  }
  for (const fields of [{ approved: true }, { runtimeEligible: true }, { approvalId: randomUUID() }, { publicationId: randomUUID() },
    { policy: {} }, { text: "untrusted caller line" }, { responses: {} }, { scenario: {} }]) {
    assert.equal((await api.post("/api/sessions", { ...select(), ...fields })).status, 400);
  }
  assert.equal((await api.get("/api/sessions/stale-session")).status, 404);
  assert.equal((await api.post("/api/sessions", select("S-01", "9.9.9"))).status, 422);
  assert.equal(api.sessionStore.values().length, 0);
  assert.equal((await saved.inspect()).item.validation.reviewEligible, true);
  assert.ok(denied.includes("SCENARIO_NOT_FOUND"));
});

test("6D submitted, rejected, approved-only and blocked journal states stay unavailable", async (t) => {
  const root = await workspace(t);
  const h = await setup(root, candidate("S-92", false));
  const api = await serve(t, root);
  const deny = async () => assert.equal((await api.post("/api/sessions", select("S-92"))).status, 404);
  await deny();
  const reviewId = await h.submit(); await deny();
  await h.approve(reviewId); await deny();
  const blocked = (await h.publish("current-real-conversation")).item.publications[0]!;
  assert.equal(blocked.status, "PUBLICATION_BLOCKED"); assert.equal(blocked.reasons.length, 7); await deny();
  const rejected = await setup(root, candidate("S-94"));
  const otherReview = await rejected.submit();
  await rejected.act("request-changes", { reviewId: otherReview, confirmed: true, reason: "Isolated fixture requires a new reviewed revision.", failedItems: [], findingPaths: ["/"] }, actor.reviewer);
  assert.equal((await api.post("/api/sessions", select("S-94"))).status, 404);
  assert.equal(api.sessionStore.values().length, 0);
});

test("6D matching offline package publishes atomically and runs the normal bounded policy with pinned identity", async (t) => {
  const root = await workspace(t), h = await setup(root);
  const calls: string[] = [];
  const api = await serve(t, root, { synthesizer: { async synthesize(request) {
    calls.push(`${request.scenarioId}:${request.scenarioVersion}:${request.responseId}`);
    return { bytes: new Uint8Array(), mediaType: "application/x-offline-test" };
  } }, runtimeRecognizer: { openStream: () => assert.fail("Offline publication opened live Prisma"), transcribe: () => assert.fail("Offline publication used live STT") } });
  const reviewId = await h.submit(); const approved = await h.approve(reviewId);
  assert.equal((await api.post("/api/sessions", select())).status, 404);
  const op = await h.store.prepare(h.saved.candidateId, "publish", await h.publication());
  const [commit] = await Promise.all([h.store.transition(op, actor.publisher), api.get("/api/runtime/scenarios")]);
  const publication = commit.item.publications[0]!;
  assert.equal(publication.status, "PUBLISHED", JSON.stringify(publication));
  assert.deepEqual(publication.release.graph, { prefixes: 79, leaves: 66, depth: 3 });
  assert.equal(publication.release.approvalArtifactHash, approved.artifactHash);
  assert.equal((await h.store.transition(op, actor.publisher)).duplicate, true);
  await assert.rejects(h.publish(), { code: "ALREADY_PUBLISHED" });
  assert.deepEqual((await new LocalReviewStore(root, safety).runtimeReleases())[0], publication.release);
  const listed = await api.list();
  assert.deepEqual(listed.map((entry) => entry.scenario_id), ["S-01", "S-93"]);
  assert.equal((await api.post("/api/sessions", { ...select(), runtimeMode: "REAL_CONVERSATION" })).status, 422);
  const created = await Promise.all([api.post("/api/sessions", select()), api.post("/api/sessions", select())]);
  assert.ok(created.every((response) => response.status === 201));
  const [first, second] = await Promise.all(created.map(async (response) => (await response.json()).session));
  const pin = { publicationId: publication.publicationId, packageHash: publication.release.packageHash, policyVersion: publication.release.policyVersion };
  assert.deepEqual(first.runtimeRelease, pin); assert.deepEqual(second.runtimeRelease, pin);
  const route = `/api/sessions/${first.sessionId}`;
  assert.equal((await api.post(route + "/turn", { text: "I need more time" })).status, 409);
  assert.equal(calls.length, 0);
  assert.equal((await api.post(route + "/consent", consent)).status, 200);
  assert.equal((await api.post(route + "/audio/start", {})).status, 409);
  for (const [index, id] of ["authority.medium", "fear.medium", "system.safe-ending"].entries()) {
    const response = await api.post(route + "/turn", { text: "I need more time" });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.branch.responseId, id);
    assert.equal(result.approvedResponseText, publication.release.scenario.responses[id]!.text);
    assert.equal(result.session.timelineEvents.length, index + 1);
    assert.deepEqual(result.session.runtimeRelease, pin);
    assert.equal(result.session.terminalState, index === 2 ? "MAX_TURNS" : null);
  }
  assert.equal((await api.post(route + "/turn", { text: "I need more time" })).status, 409);
  assert.deepEqual(calls, ["S-93:0.1.1:authority.medium", "S-93:0.1.1:fear.medium", "S-93:0.1.1:system.safe-ending"]);
  assert.equal(api.sessionStore.get(second.sessionId).turnNumber, 0);
});

test("6D newer drafts cannot replace pins and hold survives restart", async (t) => {
  const root = await workspace(t), h = await setup(root);
  const published = await h.ready(); assert.equal(published.item.publications[0]?.status, "PUBLISHED");
  const api = await serve(t, root);
  const session = (await (await api.post("/api/sessions", select())).json()).session;
  await api.post(`/api/sessions/${session.sessionId}/consent`, consent);
  const revision = candidate();
  revision.draft.scenario.version = "0.1.2";
  revision.draft.packageId = "S-93-0.1.2-draft";
  revision.draft.importableArtifacts = [{ artifactId: "S-93-0.1.2-scenario", format: "scenario-json", scenario: structuredClone(revision.draft.scenario) }];
  await h.act("revise", { candidate: revision, revisionReason: "Keep this isolated revised version unpublished while an earlier session runs." }, actor.author);
  assert.equal((await api.post("/api/sessions", select("S-93", "0.1.2"))).status, 404);
  const pinned = await api.post(`/api/sessions/${session.sessionId}/turn`, { text: "I refuse to share" });
  assert.equal(pinned.status, 200);
  assert.equal((await pinned.json()).session.scenarioVersion, "0.1.1");
  await h.act("hold", { approvalId: published.item.approval!.approvalId, confirmed: true, reason: "Test publisher placed a safety hold on the release." }, actor.publisher);
  assert.equal((await api.post("/api/sessions", select())).status, 404);
  assert.equal((await api.get(`/api/sessions/${session.sessionId}`)).status, 422);
  assert.equal(api.sessionStore.get(session.sessionId).recordingEnabled, false);
  assert.equal(api.sessionStore.get(session.sessionId).terminalState, "LEARNER_ENDED");
  const restarted = await serve(t, root);
  assert.equal((await restarted.post("/api/sessions", select())).status, 404);
  assert.equal((await restarted.get(`/api/sessions/${session.sessionId}`)).status, 404);
  assert.equal((await h.inspect()).item.publications.length, 1);
});

test("6D fixture verification, disclosure, unknown, safe word and manual End remain terminal", async (t) => {
  const root = await workspace(t), h = await setup(root);
  assert.equal((await h.ready()).item.publications[0]?.status, "PUBLISHED");
  const api = await serve(t, root);
  for (const [input, terminal, responseId] of [
    ["I will verify independently.", "SAFE_VERIFIED", "system.safe-ending"],
    ["SYNTHETIC-SECRET-EXAMPLE", "DUMMY_SECRET_DISCLOSED", "system.safe-ending"],
    ["The clouds are grey.", "SAFE_FALLBACK", "system.safe-fallback"],
    ["stop simulation", "SAFE_WORD", "system.safe-ending"],
    [null, "LEARNER_ENDED", null],
  ] as const) {
    const session = (await (await api.post("/api/sessions", select())).json()).session;
    const route = `/api/sessions/${session.sessionId}`;
    await api.post(route + "/consent", consent);
    const response = await api.post(route + (input === null ? "/end" : "/turn"), input === null ? {} : { text: input });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.session.terminalState, terminal);
    assert.equal(result.branch?.responseId ?? null, responseId);
    assert.equal(result.session.recordingEnabled, false);
    assert.equal((await api.post(route + "/turn", { text: "I agree to continue" })).status, 409);
  }
});

test("6D graph mismatch and unsupported terminal semantics fail closed at publication", async (t) => {
  const root = await workspace(t);
  const value = candidate();
  value.draft.scenario.adaptive_policy!.tactics.find((entry) => entry.tactic_id === "authority.medium")!.behavior_targets = ["REFUSED"];
  value.draft.importableArtifacts[0]!.scenario = structuredClone(value.draft.scenario);
  const h = await setup(root, value);
  const result = await h.ready();
  assert.deepEqual(result.item.publications[0]?.reasons, ["GRAPH_POLICY_MISMATCH"]);
  const unsupported = await setup(root, candidate("S-94", false));
  assert.deepEqual((await unsupported.ready()).item.publications[0]?.reasons, ["OFFLINE_PROFILE_REQUIRED"]);
  assert.deepEqual(await h.store.runtimeReleases(), []);
});

test("6D corrupt, truncated, rehashed-forged and missing journal records cannot execute", async (t) => {
  const root = await workspace(t), h = await setup(root);
  const result = await h.ready(); assert.equal(result.item.publications[0]?.status, "PUBLISHED");
  const api = await serve(t, root);
  const file = join(h.store.directory, "commits", String(result.sequence).padStart(8, "0") + ".json");
  const original = await readFile(file, "utf8");
  type Published = Extract<ReviewCommit["item"]["publications"][number], { status: "PUBLISHED" }>;
  const mutations: ((entry: ReviewCommit, published: Published) => void)[] = [
    (entry) => { Reflect.set(entry, "schemaVersion", 99); },
    (_entry, published) => { published.release.packageHash = "0".repeat(64); },
    (_entry, published) => { published.release.scenario.version = "9.9.9"; },
    (_entry, published) => { published.release.scenario.scenario_id = "S-94"; },
    (_entry, published) => { published.approvalId = randomUUID(); },
    (_entry, published) => { published.release.sourceContentHash = "f".repeat(64); },
    (entry) => { entry.item.approval = null; },
    (_entry, published) => { published.release.scenario.language = "unsupported-language"; },
    (_entry, published) => { published.release.scenario.voice_id = "unverified-voice"; },
    (_entry, published) => { published.release.scenario.adaptive_policy!.max_pressure_level = 5; },
    (_entry, published) => { delete published.release.scenario.adaptive_policy; },
    (_entry, published) => { delete published.release.scenario.safety_metadata; },
    (_entry, published) => { delete published.release.scenario.responses["authority.medium"]; },
    (entry, published) => { entry.item.publications.push(structuredClone(published)); },
    (_entry, published) => { published.release.scenario.responses["authority.medium"]!.text = "Unapproved replacement line."; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const entry = JSON.parse(original) as ReviewCommit;
    const published = entry.item.publications[0]!;
    assert.equal(published.status, "PUBLISHED");
    mutate(entry, published);
    if (index !== 1) {
      const { packageHash: _prior, ...packageBody } = published.release;
      published.release.packageHash = await hashAuthoringData(packageBody);
    }
    const { commitHash: _old, ...body } = entry;
    await writeFile(file, JSON.stringify({ ...body, commitHash: await hashAuthoringData(body) }));
    assert.equal((await api.post("/api/sessions", select())).status, 422);
  }
  await writeFile(file, '{"schemaVersion":1');
  assert.equal((await api.post("/api/sessions", select())).status, 422);
  await rm(file);
  assert.equal((await api.post("/api/sessions", select())).status, 404);
  assert.equal(api.sessionStore.values().length, 0);
});

test("6D interrupted publication never becomes executable and the identical operation can retry", async (t) => {
  const root = await workspace(t);
  let failing = false;
  const h = await setup(root, candidate(), { before(stage) { if (failing && stage === "link") throw new Error("Simulated publication interruption"); } });
  await h.approve(await h.submit());
  const op = await h.store.prepare(h.saved.candidateId, "publish", await h.publication());
  failing = true;
  await assert.rejects(h.store.transition(op, actor.publisher), { code: "REVIEW_STORAGE_FAILED" });
  assert.deepEqual(await h.store.runtimeReleases(), []);
  failing = false;
  assert.equal((await h.store.transition(op, actor.publisher)).item.publications[0]?.status, "PUBLISHED");
});

test("6D canonical S-01 gate checks actual Timbre body and rejects forged or replaced caller content", async (t) => {
  const root = await workspace(t);
  const sourceScenario = await readJson(canonical);
  const requests: string[] = [];
  const api = await serve(t, root, { ttsUnits: 1, recognizer: new MockPrismaRecognizer(), callerAudio: (scenarios, reserve) => {
    const catalog = new ApprovedCallerCatalog(scenarios, TIMBRE_PROFILE.voice);
    const cache = new Map<string, Uint8Array>();
    const synth = new TimbreSpeechSynthesizer(catalog, { apiKey: "offline-fixture" }, async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)).text);
      return new Response(Buffer.from(callerWavFixture()), { headers: { "content-type": "audio/wav" } });
    });
    return new CallerAudioService(catalog, TIMBRE_PROFILE, {
      async get(key) { return cache.get(key); }, async set(key, bytes) { cache.set(key, bytes); },
    }, synth, reserve);
  } });
  const start = { scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", demoMode: false, runtimeMode: "REAL_STT" };
  const created = await api.post("/api/sessions", start);
  assert.equal(created.status, 201);
  const session = (await created.json()).session;
  assert.equal(session.runtimeRelease.publicationId, null);
  const route = `/api/sessions/${session.sessionId}`;
  const opening = { turnNumber: 0, responseId: "system.opening" };
  assert.equal((await api.post(route + "/caller-audio", opening)).status, 409);
  await api.post(route + "/consent", consent);
  for (const body of [{ ...opening, text: "untrusted text" }, { ...opening, scenarioId: "S-92" },
    { ...opening, scenarioVersion: "9.9.9" }, { ...opening, responseId: "unknown" }]) {
    assert.ok((await api.post(route + "/caller-audio", body)).status >= 400);
  }
  assert.deepEqual(requests, []);
  assert.equal((await api.post(route + "/caller-audio", opening)).status, 200);
  assert.deepEqual(requests, [sourceScenario.responses["system.opening"].text.normalize("NFKC")]);
  sourceScenario.responses["system.opening"].text = "Replacement caller text";
  await writeFile(join(root, canonical), JSON.stringify(sourceScenario));
  assert.equal((await api.post("/api/sessions", start)).status, 422);
  assert.equal((await api.post(route + "/caller-audio", opening)).status, 422);
  assert.equal(requests.length, 1);
});

test("6D linked directories cannot supply otherwise approved canonical content", async (t) => {
  const root = await workspace(t, "elsewhere");
  await symlink(join(root, "elsewhere"), join(root, "content/scenarios"), process.platform === "win32" ? "junction" : "dir");
  const api = await serve(t, root);
  assert.deepEqual(await api.list(), []);
  assert.equal((await api.post("/api/sessions", { ...select("S-01", "0.2.0"), language: "hi-IN" })).status, 404);
});
