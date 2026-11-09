import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  draftJsonLimit, hashAuthoringData, parseAuthoringCandidate, parseMockDraftBrief,
  reviewChecklist, verifyReviewExport, type AuthoringCandidate, type ReviewAction, type SavedDraft, type ScenarioDraftGenerator,
  type ScenarioSafetyOptions,
} from "@vaccine/scenario-schema";
import { draftFingerprint, LocalDraftStore } from "./authoring/draftStore.js";
import { LocalReviewStore } from "./authoring/reviewStore.js";
import { createApiServer } from "./health.js";
import { MockPrismaRecognizer } from "./providers/prisma/mockPrisma.js";
import { InMemorySessionStore } from "./sessionStore.js";

const safetyPath = "content/safety/review-reference-lists.json";
const scenarios = [
  "content/scenarios/S-01-urgent-account-verification.json",
  "content/scenarios/S-02-insurance-refund-trap.json",
  "content/scenarios/S-03-telecom-kyc-lockout.json",
  "content/authoring/S-01-hi-IN.package.json",
];
const briefPath = "content/authoring/examples/benefits-brief.json";
const manualPath = "content/authoring/examples/S-92-v0.1.1.candidate.json";
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const safety = await readJson(safetyPath) as ScenarioSafetyOptions;
const actor = { author: "test-author", reviewer: "test-reviewer", publisher: "test-publisher" };
const checklist = Object.fromEntries(Object.entries(reviewChecklist).map(([id, item]) => [id, item.critical
  ? { decision: "PASS", reason: "" }
  : { decision: "NOT_APPLICABLE", reason: "The synthetic fixture makes no formal translation equivalence claim." }]));
const selection = { scenarioId: "S-93", scenarioVersion: "0.1.1", language: "hi-en", demoMode: false };
const approvalEvidence = (reviewId: string) => ({
  reviewId, confirmed: true, notes: "TEST REVIEWER approved this disposable synthetic fixture.",
  decisionReason: "Exercise the complete workflow offline with a synthetic test approval.",
});
const publishEvidence = (approvalId: string) => ({ approvalId, confirmed: true, target: "offline-adaptive" });

const workspaces: string[] = [];
test.after(async () => {
  for (const path of workspaces) await assert.rejects(stat(path), { code: "ENOENT" });
  console.log("PHASE6E " + JSON.stringify({ id: "CLEANUP", cleanedStores: workspaces.length }));
});

async function isolated(t: TestContext) {
  const temporaryParent = resolve(tmpdir());
  const path = await mkdtemp(join(temporaryParent, "vv-phase6e-"));
  workspaces.push(path);
  let close: (() => Promise<void>) | undefined;
  t.after(async () => {
    await close?.();
    assert.equal(dirname(path), temporaryParent);
    assert.match(basename(path), /^vv-phase6e-[a-z0-9]+$/iu);
    await rm(path, { recursive: true, force: true });
  });
  for (const file of [...scenarios, safetyPath]) {
    const destination = join(path, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file, destination);
  }
  const drafts = new LocalDraftStore(path, safety);
  const reviews = new LocalReviewStore(path, safety);
  await reviews.configure({ mode: "LOCAL_OS_DEMO", acknowledgedLocalTrust: true, actors: [
    { actorId: actor.author, roles: ["AUTHOR"] }, { actorId: actor.reviewer, roles: ["REVIEWER"] },
    { actorId: actor.publisher, roles: ["PUBLISHER"] },
  ] });
  const prepare = (saved: SavedDraft, action: ReviewAction, evidence: unknown) => reviews.prepare(saved.candidateId, action, evidence);
  const act = async (saved: SavedDraft, action: ReviewAction, evidence: unknown, who: string) =>
    reviews.transition(await prepare(saved, action, evidence), who);
  const validate = async (saved: SavedDraft) => drafts.validateBytes(await readFile(drafts.pathFor(saved.candidateId)));
  const view = (saved: SavedDraft) => reviews.export(saved.candidateId);
  async function serve() {
    const calls: string[] = [];
    const forbidden = () => assert.fail("Typed acceptance must never reach STT.");
    const recognizer = new MockPrismaRecognizer();
    const stt = t.mock.method(recognizer, "transcribe");
    const sessionStore = new InMemorySessionStore();
    let now = Date.now();
    const server = createApiServer({ environment: "test", runtimeWorkspace: path, sessionStore, recognizer,
      now: () => new Date(now += 61_000),
      runtimeRecognizer: { openStream: forbidden, transcribe: forbidden },
      synthesizer: { async synthesize(request) {
        assert.equal(request.scenarioId, selection.scenarioId);
        assert.equal(request.scenarioVersion, selection.scenarioVersion);
        assert.ok(!("text" in request));
        calls.push(request.responseId);
        return { bytes: new Uint8Array(), mediaType: "application/x-test-synth" };
      } },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    close = () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const get = (route: string) => fetch(base + route);
    const post = (route: string, body: unknown) => fetch(base + route, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { get, post, calls, stt, sessionStore };
  }
  return { path, drafts, reviews, prepare, act, validate, view, serve };
}

async function generate(h: Awaited<ReturnType<typeof isolated>>, profile = true) {
  return h.drafts.generate({ ...await readJson(briefPath), scenarioId: selection.scenarioId,
    draftVersion: selection.scenarioVersion, ...(profile ? { runtimeProfile: "offline-adaptive-v1" } : {}) });
}

function identify(candidate: AuthoringCandidate, version: string) {
  const { draft } = candidate;
  const id = selection.scenarioId;
  draft.scenario.scenario_id = id;
  draft.scenario.version = version;
  draft.scenarioBrief.scenarioId = id;
  draft.packageId = `${id}-${version}-draft`;
  draft.importableArtifacts = [{ artifactId: `${id}-${version}-scenario`, format: "scenario-json", scenario: draft.scenario }];
}

async function manualFixture() {
  // The independent JSON source is the reviewed import example, adapted only in the disposable fixture.
  const candidate = await readJson(manualPath) as AuthoringCandidate;
  const { draft, details } = candidate;
  const { scenario } = draft;
  identify(candidate, selection.scenarioVersion);
  details.runtimeProfile = "offline-adaptive-v1";
  for (const outcome of ["SAFE_VERIFIED", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"] as const) {
    delete scenario.responses[details.terminalResponses[outcome]];
    details.terminalResponses[outcome] = "system.safe-ending";
  }
  for (const tactic of scenario.adaptive_policy!.tactics) {
    tactic.behavior_targets = ["authority.medium", "fear.medium"].includes(tactic.tactic_id)
      ? ["REFUSED", "STALLED", "COMPLIED"] : ["VERIFIED_INDEPENDENTLY"];
  }
  for (const node of scenario.nodes) node.debrief_tags = [...scenario.nodes[0]!.debrief_tags];
  draft.candidateApprovedResponses = draft.candidateApprovedResponses.filter(({ responseId }) => responseId in scenario.responses);
  candidate.declaredOrigin = "Offline author-supplied training fixture";
  return candidate;
}

async function importFixture(h: Awaited<ReturnType<typeof isolated>>, candidate: AuthoringCandidate) {
  const bytes = Buffer.from(JSON.stringify(candidate));
  const path = join(h.path, "candidate.json");
  await writeFile(path, bytes);
  const saved = await h.drafts.importFile(path);
  assert.deepEqual(saved.provenance, { source: "MANUAL_IMPORT", verification: "UNVERIFIED", originalFilename: "candidate.json",
    sourceFingerprint: draftFingerprint(bytes), declaredOrigin: candidate.declaredOrigin ?? null });
  return saved;
}

for (const intake of ["MOCK", "IMPORT", "FAKE-ADAPTER"] as const) {
  test(`6E E2E-${intake} canonical intake, test review, explicit publication, typed runtime and debrief`, async (t) => {
    const h = await isolated(t);
    const api = await h.serve();
    const deny = async () => assert.equal((await api.post("/api/sessions", selection)).status, 404);
    let fakeAuthoringInvocations = 0;
    let saved: SavedDraft;
    if (intake === "MOCK") {
      saved = await generate(h);
      assert.equal(saved.provenance.source, "DETERMINISTIC_MOCK");
      assert.equal(saved.provenance.generatorVersion, "1.1.0");
      assert.equal(saved.provenance.templateVersion, "1.0.0");
    } else {
      const candidate = await manualFixture();
      if (intake === "FAKE-ADAPTER") {
        const adapter: ScenarioDraftGenerator = { generateDraft(brief) {
          fakeAuthoringInvocations++;
          assert.equal(brief.scenarioId, selection.scenarioId);
          return { ...candidate, declaredOrigin: "Offline test model fixture" };
        } };
        const output = adapter.generateDraft(parseMockDraftBrief({ ...await readJson(briefPath), scenarioId: selection.scenarioId }));
        saved = await importFixture(h, output);
      } else saved = await importFixture(h, candidate);
    }
    assert.deepEqual(parseAuthoringCandidate(saved.candidate, safety), saved.candidate);
    assert.equal(saved.contentHash, await hashAuthoringData(saved.candidate));
    assert.deepEqual(await new LocalDraftStore(h.path, safety).load(saved.candidateId), saved);
    const { draft, details } = saved.candidate;
    assert.equal(draft.scenario.scenario_id, selection.scenarioId);
    assert.equal(draft.scenario.version, selection.scenarioVersion);
    assert.equal(draft.runtimeEligible, false);
    assert.equal(details.variants.length, 15);
    assert.ok(details.variants.every((variant) => variant.educationalPurpose.length > 0));
    assert.equal(details.examples.length, 18);
    assert.equal(details.debriefs.length, intake === "MOCK" ? 6 : 7);
    assert.equal(Object.keys(details.terminalResponses).length, 4);
    const validation = await h.validate(saved);
    assert.equal(validation.reviewEligible, true, JSON.stringify(validation.findings));
    assert.equal(validation.findings.filter((finding) => finding.severity === "ERROR").length, 0);
    assert.equal(validation.graph?.complete, true);
    if (intake === "FAKE-ADAPTER") assert.ok(validation.findings.some(({ ruleId }) => ruleId === "ORIGIN_UNVERIFIED"));
    await deny();
    await assert.rejects(h.act(saved, "approve", approvalEvidence("f66c2052-0268-44d5-9683-8c881f0b9760"), actor.reviewer), { code: "CANDIDATE_NOT_MANAGED" });
    await h.act(saved, "adopt", { confirmed: true }, actor.author);
    await deny();
    const submitted = await h.act(saved, "submit", { validation }, actor.author);
    assert.equal(submitted.item.lifecycle, "SAFETY_REVIEW");
    const review = submitted.item.review!;
    assert.equal(review.snapshot.contentHash, saved.contentHash);
    assert.equal(review.snapshot.recordHash, await hashAuthoringData(saved));
    assert.equal(review.snapshotHash, await hashAuthoringData(review.snapshot));
    await deny();
    await h.act(saved, "start", { reviewId: review.reviewId }, actor.reviewer);
    await assert.rejects(h.act(saved, "approve", approvalEvidence(review.reviewId), actor.reviewer), { code: "CHECKLIST_INCOMPLETE" });
    await h.act(saved, "checklist", { reviewId: review.reviewId, items: checklist }, actor.reviewer);
    const warnings = review.snapshot.validation.findings.filter(({ severity }) => severity === "WARNING");
    for (const { ruleId, path } of warnings) {
      await assert.rejects(h.act(saved, "approve", approvalEvidence(review.reviewId), actor.reviewer), { code: "WARNING_DECISION_REQUIRED" });
      await h.act(saved, "warning", { reviewId: review.reviewId, warning: { ruleId, path,
        decision: "ACCEPTED_WITH_JUSTIFICATION", rationale: "TEST REVIEWER evaluated this specific finding in the isolated fictional exercise." } }, actor.reviewer);
    }
    const approved = await h.act(saved, "approve", approvalEvidence(review.reviewId), actor.reviewer);
    assert.equal(approved.item.lifecycle, "APPROVED");
    assert.deepEqual(approved.item.publications, []);
    assert.deepEqual(approved.item.review!.snapshot, review.snapshot);
    const approval = approved.item.approval!;
    const { artifactHash, ...artifact } = approval;
    assert.equal(artifactHash, await hashAuthoringData(artifact));
    assert.deepEqual(approval.record, saved);
    assert.equal(approval.runtimeEligible, false);
    await deny();
    await assert.rejects(h.act(saved, "publish", publishEvidence(approval.approvalId), actor.reviewer), { code: "UNAUTHORIZED_ACTOR" });
    const published = await h.act(saved, "publish", publishEvidence(approval.approvalId), actor.publisher);
    const publication = published.item.publications[0]!;
    assert.equal(publication.status, "PUBLISHED", JSON.stringify(publication));
    if (publication.status !== "PUBLISHED") assert.fail("Missing runtime release");
    const { release } = publication;
    assert.equal(release.approvalArtifactHash, artifactHash);
    assert.equal(release.sourceContentHash, saved.contentHash);
    assert.deepEqual(release.graph, { prefixes: 79, leaves: 66, depth: 3 });
    const { packageHash, ...packageBody } = release;
    assert.equal(packageHash, await hashAuthoringData(packageBody));
    assert.deepEqual((await (await api.get("/api/runtime/scenarios")).json()).scenarios.map(({ scenario_id }: { scenario_id: string }) => scenario_id), ["S-01", "S-93"]);
    assert.equal((await api.post("/api/sessions", { ...selection, runtimeMode: "REAL_STT" })).status, 422);
    const created = await api.post("/api/sessions", selection);
    assert.equal(created.status, 201);
    const session = (await created.json()).session;
    const pin = { publicationId: publication.publicationId, packageHash, policyVersion: release.policyVersion };
    assert.deepEqual(session.runtimeRelease, pin);
    const route = `/api/sessions/${session.sessionId}`;
    assert.equal((await api.post(route + "/turn", { text: "I need more time" })).status, 409);
    assert.equal((await api.post(route + "/consent", { consentVersion: "training-consent-v1" })).status, 200);
    assert.equal((await api.post(route + "/audio/start", {})).status, 409);
    const turns = intake === "MOCK" ? [
      ["I need more time", "authority.medium", null],
      ["I will verify using the official number", "system.safe-ending", "SAFE_VERIFIED"],
    ] : [
      ["I need more time", "authority.medium", null],
      ["I need more time", "fear.medium", null],
      ["I need more time", "system.safe-ending", "MAX_TURNS"],
    ];
    for (const [index, [text, responseId, terminal]] of turns.entries()) {
      const turn = await api.post(route + "/turn", { text });
      assert.equal(turn.status, 200, await turn.clone().text());
      const result = await turn.json();
      assert.equal(result.branch.responseId, responseId);
      assert.equal(result.approvedResponseText, release.scenario.responses[responseId!]!.text);
      assert.equal(result.session.timelineEvents.length, index + 1);
      assert.equal(result.session.terminalState, terminal);
      assert.deepEqual(result.session.runtimeRelease, pin);
    }
    assert.equal((await api.post(route + "/turn", { text: "I need more time" })).status, 409);
    const result = (await (await api.get(route)).json()).session;
    assert.equal(result.pressureDebrief.turnSummaries.length, turns.length);
    assert.equal(result.pressureTimeline.length, turns.length);
    assert.equal(api.sessionStore.get(session.sessionId).timelineEvents.length, turns.length);
    assert.deepEqual(api.calls, turns.map((turn) => turn[1]));
    assert.equal(api.stt.mock.callCount(), turns.length);
    assert.ok(api.stt.mock.calls.every(({ arguments: [request] }) => request.input.mediaType === "text/mock"));
    const verified = await verifyReviewExport(await h.view(saved), safety);
    const restarted = new LocalReviewStore(h.path, safety);
    const reloaded = await restarted.export(saved.candidateId);
    assert.deepEqual(reloaded.item, verified.item);
    assert.deepEqual(reloaded.audit, verified.audit);
    assert.deepEqual(await restarted.runtimeReleases(), [release]);
    assert.equal(verified.audit.at(-1)?.type, "SCENARIO_PUBLISHED");
    t.diagnostic("PHASE6E " + JSON.stringify({ id: `E2E-${intake}`, source: saved.provenance, candidateId: saved.candidateId,
      contentHash: saved.contentHash, validation: validation.status, authoringGraph: validation.graph, warnings: warnings.map(({ ruleId, path }) => ({ ruleId, path })),
      reviewId: review.reviewId, snapshotHash: review.snapshotHash, approvalId: approval.approvalId, artifactHash,
      publicationId: publication.publicationId, packageHash, runtimeGraph: release.graph, catalogEligible: true, pin,
      terminal: result.terminalState, turns: turns.length, pressurePoints: result.pressureTimeline.length, fakeSynthesisCalls: api.calls,
      fakeAuthoringInvocations, fakeSttInvocations: api.stt.mock.callCount(), audit: verified.audit.map(({ type }) => type) }));
  });
}

test("6E SEC-INTAKE bounds bytes, rejects malformed and privileged origin claims, and checks mock profile provenance", async (t) => {
  const h = await isolated(t);
  const path = join(h.path, "invalid.json");
  const candidate = await manualFixture();
  const cases = [
    [Buffer.alloc(draftJsonLimit + 1, 0x20), "IMPORT_TOO_LARGE"],
    ["{\"malformed\":", "INVALID_IMPORT_JSON"],
    ["{\"schemaVersion\":1,\"schemaVersion\":1}", "DUPLICATE_JSON_KEY"],
    [JSON.stringify({ ...candidate, schemaVersion: 2 }), "UNSUPPORTED_IMPORT_FORMAT"],
    [JSON.stringify({ ...candidate, provenance: { source: "EVON", verification: "VERIFIED" } }), "INVALID_DRAFT_SCHEMA"],
  ] as const;
  for (const [input, code] of cases) {
    await writeFile(path, input);
    await assert.rejects(h.drafts.importFile(path), { code });
  }
  assert.deepEqual(await h.drafts.list(), []);
  const saved = await generate(h);
  const forged = { ...saved, provenance: { ...saved.provenance, generatorVersion: "1.0.0" } };
  const report = await h.drafts.validateBytes(Buffer.from(JSON.stringify(forged)));
  assert.equal(report.reviewEligible, false);
  assert.ok(report.findings.some(({ ruleId }) => ruleId === "PROVENANCE_INVALID"));
  t.diagnostic("PHASE6E " + JSON.stringify({ id: "SEC-INTAKE", rejected: cases.map(([, code]) => code), forgedMockVersionRejected: true }));
});

test("6E SEC-REVISION rejects stale operations and old approval reuse, and preserves blocked history across reload", async (t) => {
  const h = await isolated(t);
  const api = await h.serve();
  const parent = await generate(h, false);
  const current = await h.validate(parent);
  await h.act(parent, "adopt", { confirmed: true }, actor.author);
  await assert.rejects(h.act(parent, "submit", { validation: { ...current, validationVersion: "9.9.9" } }, actor.author), { code: "VALIDATION_BLOCKED" });

  async function race(saved: SavedDraft, action: ReviewAction, evidence: unknown, who: string) {
    const [a, b] = await Promise.all([h.prepare(saved, action, evidence), h.prepare(saved, action, evidence)]);
    const otherStore = new LocalReviewStore(h.path, safety);
    const results = await Promise.allSettled([h.reviews.transition(a, who), otherStore.transition(b, who)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected")!;
    assert.equal(rejected.reason.code, "REVIEW_CONFLICT");
    const after = await h.reviews.status();
    assert.equal(after.sequence, a.expectedSequence + 1);
  }
  async function finish(saved: SavedDraft, reviewId: string) {
    for (const { ruleId, path, severity } of (await h.view(saved)).item.review!.snapshot.validation.findings) {
      if (severity !== "WARNING") continue;
      await h.act(saved, "warning", { reviewId, warning: { ruleId, path, decision: "ACCEPTED_WITH_JUSTIFICATION",
        rationale: "TEST REVIEWER recorded the individual fictional training finding for workflow acceptance." } }, actor.reviewer);
    }
    return (await h.act(saved, "approve", approvalEvidence(reviewId), actor.reviewer)).item.approval!;
  }
  await race(parent, "submit", { validation: current }, actor.author);
  const parentReview = (await h.view(parent)).item.review!.reviewId;
  await h.act(parent, "start", { reviewId: parentReview }, actor.reviewer);
  await race(parent, "checklist", { reviewId: parentReview, items: checklist }, actor.reviewer);
  const parentApproval = await finish(parent, parentReview);
  const blocked = (await h.act(parent, "publish", publishEvidence(parentApproval.approvalId), actor.publisher)).item.publications[0]!;
  assert.equal(blocked.status, "PUBLICATION_BLOCKED");
  assert.deepEqual(blocked.reasons, ["OFFLINE_PROFILE_REQUIRED"]);
  assert.equal((await api.post("/api/sessions", selection)).status, 404);
  const parentView = await h.view(parent);
  const revised = structuredClone(parent.candidate);
  const newVersion = "0.1.2";
  identify(revised, newVersion);
  const revision = (await h.act(parent, "revise", { candidate: revised,
    revisionReason: "TEST AUTHOR created a new version to exercise independent review and approval." }, actor.author)).item;
  assert.equal(revision.lifecycle, "DRAFT");
  assert.equal(revision.record.previousCandidateId, parent.candidateId);
  assert.notEqual(revision.record.contentHash, parent.contentHash);
  assert.equal(revision.approval, null);
  assert.equal(revision.review, null);
  assert.deepEqual(revision.publications, []);
  assert.deepEqual((await h.view(parent)).item, parentView.item);
  const child = revision.record;
  await assert.rejects(h.act(child, "submit", { validation: current }, actor.author), { code: "VALIDATION_BLOCKED" });
  await assert.rejects(h.act(child, "publish", publishEvidence(parentApproval.approvalId), actor.publisher), { code: "INVALID_REVIEW_STATE" });
  const fresh = await h.validate(child);
  assert.equal(fresh.sourceHash, child.contentHash);
  const childReview = (await h.act(child, "submit", { validation: fresh }, actor.author)).item.review!.reviewId;
  assert.notEqual(childReview, parentReview);
  await assert.rejects(h.act(child, "start", { reviewId: parentReview }, actor.reviewer), { code: "REVIEW_REQUIRED" });
  await h.act(child, "start", { reviewId: childReview }, actor.reviewer);
  await assert.rejects(h.act(child, "approve", approvalEvidence(childReview), actor.reviewer), { code: "CHECKLIST_INCOMPLETE" });
  await h.act(child, "checklist", { reviewId: childReview, items: checklist }, actor.reviewer);
  await assert.rejects(h.act(child, "approve", approvalEvidence(parentReview), actor.reviewer), { code: "REVIEW_REQUIRED" });
  const stale = await h.prepare(child, "approve", approvalEvidence(childReview));
  await assert.rejects(h.reviews.transition({ ...stale, expectedContentHash: parent.contentHash }, actor.reviewer), { code: "REVIEW_CONFLICT" });
  const childApproval = await finish(child, childReview);
  assert.notEqual(childApproval.approvalId, parentApproval.approvalId);
  assert.equal(childApproval.contentHash, child.contentHash);
  assert.equal((await api.post("/api/sessions", { ...selection, scenarioVersion: newVersion })).status, 404);
  const reloaded = new LocalReviewStore(h.path, safety);
  assert.deepEqual((await reloaded.export(parent.candidateId)).item, parentView.item);
  assert.deepEqual((await reloaded.export(child.candidateId)).item.approval, childApproval);
  assert.deepEqual(await reloaded.runtimeReleases(), []);
  assert.equal(api.calls.length, 0);
  assert.equal(api.stt.mock.callCount(), 0);
  t.diagnostic("PHASE6E " + JSON.stringify({ id: "SEC-REVISION", parentHash: parent.contentHash, childHash: child.contentHash,
    parentReview, childReview, parentApproval: parentApproval.approvalId, childApproval: childApproval.approvalId,
    blocked: { id: blocked.publicationId, reasons: blocked.reasons }, races: ["submit", "checklist"], restart: true }));
});
