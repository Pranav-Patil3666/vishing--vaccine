import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import {
  AuthoringReviewError, hashAuthoringData, parseReviewJson, reviewChecklist,
  validateAuthoringDraft, verifyReviewExport, type AuthoringCandidate, type ReviewAction, type SavedDraft,
} from "@vaccine/scenario-schema";
import { LocalDraftStore } from "../../api/src/authoring/draftStore.js";
import { LocalReviewStore, type ReviewStoreOptions } from "../../api/src/authoring/reviewStore.js";
import { createApiServer } from "../../api/src/health.js";
import { RuntimeCreditLedger } from "../../api/src/runtimeCredit.js";
import { ReviewWorkflowDetails, createReviewProposal, reviewUiCapabilities, revisionProposalCandidate } from "./components/AuthoringReviewPanel.js";
import { AuthoringPage } from "./pages/AuthoringPage.js";
import brief from "../../../content/authoring/examples/benefits-brief.json";
import references from "../../../content/safety/review-reference-lists.json";
import actorTemplate from "../../../content/authoring/examples/review-actors.example.json";

const ids = { AUTHOR: "local-author", REVIEWER: "local-reviewer", PUBLISHER: "local-publisher" };
const fixed = "2026-11-08T00:00:00.000Z";
const approveEvidence = { confirmed: true, notes: "Offline test-only reviewer fixture, not a human production approval.",
  decisionReason: "Synthetic test decision covering the complete submitted educational snapshot." };
const warningRationale = "Offline test fixture accepts the documented educational interpretation for this individual finding.";
const checklist = Object.fromEntries(Object.keys(reviewChecklist).map((key) => [key,
  key === "translationChecked" ? { decision: "NOT_APPLICABLE", reason: "No formal translation-equivalence claim is made in this fixture." }
    : { decision: "PASS", reason: "" }]));
const role = (action: ReviewAction) => ["adopt", "submit", "revise"].includes(action) ? ids.AUTHOR
  : ["publish", "hold"].includes(action) ? ids.PUBLISHER : ids.REVIEWER;
const failure = (code: string | string[]) => (error: unknown) => {
  assert.ok(error instanceof AuthoringReviewError);
  assert.ok((Array.isArray(code) ? code : [code]).includes(error.code), error.code);
  return true;
};

async function harness(t: TestContext, setup: {
  candidate?: AuthoringCandidate; twoTurns?: boolean; selfRole?: boolean; secondReviewer?: boolean; options?: ReviewStoreOptions;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6c-"));
  t.after(async () => {
    assert.equal(join(tmpdir(), root.split(/[\\/]/u).at(-1)!), root);
    await rm(root, { recursive: true, force: true });
  });
  const safety = structuredClone(references);
  const drafts = new LocalDraftStore(root, safety);
  let saved: SavedDraft;
  if (setup.candidate) {
    const input = join(root, "fixture.json"); await writeFile(input, JSON.stringify(setup.candidate));
    saved = await drafts.importFile(input);
  } else saved = await drafts.generate({ ...brief, maxLearnerTurns: setup.twoTurns ? 2 : 3 });
  const options = { now: () => new Date(fixed), ...setup.options };
  const store = new LocalReviewStore(root, safety, options);
  const policy = structuredClone(actorTemplate);
  if (setup.selfRole) policy.actors[0]!.roles = ["AUTHOR", "REVIEWER", "PUBLISHER"];
  if (setup.secondReviewer) policy.actors.push({ actorId: "local-reviewer-two", roles: ["REVIEWER"] });
  await store.configure(policy);
  const call = async (action: ReviewAction, evidence: unknown = {}, actor = role(action), id = saved.candidateId) => {
    const request = await store.prepare(id, action, evidence);
    return store.transition(request, actor);
  };
  const view = () => store.export(saved.candidateId);
  const adopt = () => call("adopt", { confirmed: true });
  const submit = async () => call("submit", { validation: await drafts.validateBytes(new TextEncoder().encode(JSON.stringify(saved))) });
  const start = async () => call("start", { reviewId: (await view()).item.review!.reviewId });
  const checks = async (items = checklist) => call("checklist", { reviewId: (await view()).item.review!.reviewId, items });
  const warn = async (index: number, decision = "ACCEPTED_WITH_JUSTIFICATION", rationale = warningRationale) => {
    const review = (await view()).item.review!;
    const finding = review.snapshot.validation.findings.filter((entry) => entry.severity === "WARNING")[index]!;
    return call("warning", { reviewId: review.reviewId, warning: { ruleId: finding.ruleId, path: finding.path, decision, rationale } });
  };
  const approve = async () => call("approve", { ...approveEvidence, reviewId: (await view()).item.review!.reviewId });
  const ready = async () => { await adopt(); await submit(); await start(); await checks(); await warn(0); await warn(1); };
  const approved = async () => { await ready(); await approve(); };
  const publish = async () => call("publish", { approvalId: (await view()).item.approval!.approvalId, target: "current-real-conversation", confirmed: true });
  const reject = async (action: "reject" | "request-changes" = "reject") => {
    await checks({ educationalPurpose: { decision: "NEEDS_REVISION", reason: "The synthetic test reviewer requests a clearer educational context." } });
    return call(action, { reviewId: (await view()).item.review!.reviewId, confirmed: true,
      reason: "The synthetic fixture needs a clarified educational explanation in a new revision.",
      failedItems: ["educationalPurpose"], findingPaths: [] });
  };
  const revision = async (version = "0.1.1", extra?: (candidate: AuthoringCandidate) => void) => {
    const edited = revisionProposalCandidate(JSON.stringify(saved.candidate), version);
    edited.details.premise += " This revision explicitly models unsolicited synthetic disclosure.";
    extra?.(edited);
    return call("revise", { candidate: edited, revisionReason: "Clarify synthetic-disclosure educational context in a fresh draft revision." });
  };
  const corrupt = async (mutate: (commit: Record<string, unknown>) => void) => {
    const names = (await readdir(join(store.directory, "commits"))).sort();
    const path = join(store.directory, "commits", names.at(-1)!);
    const commit = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    mutate(commit); await writeFile(path, JSON.stringify(commit));
  };
  return { root, saved, drafts, store, safety, options, call, view, adopt, submit, start, checks, warn, approve, ready, approved, publish, reject, revision, corrupt };
}
type H = Awaited<ReturnType<typeof harness>>;

test("Authoring revision preview verifies selected ancestors and replaces stale findings when a workflow export opens", async (t) => {
  const h = await harness(t);
  await h.adopt();
  const revised = (await h.revision()).item;
  const id = revised.record.candidateId;
  const submitted = await h.call("submit", { validation: revised.validation }, ids.AUTHOR, id);
  const reviewId = submitted.item.review!.reviewId;
  await h.call("start", { reviewId }, ids.REVIEWER, id);
  await h.call("checklist", { reviewId, items: checklist }, ids.REVIEWER, id);
  for (const { ruleId, path } of revised.validation.findings.filter((entry) => entry.severity === "WARNING")) {
    await h.call("warning", { reviewId, warning: { ruleId, path, decision: "ACCEPTED_WITH_JUSTIFICATION", rationale: warningRationale } }, ids.REVIEWER, id);
  }
  const approved = (await h.call("approve", { ...approveEvidence, reviewId }, ids.REVIEWER, id)).item.approval!;
  await h.call("publish", { approvalId: approved.approvalId, confirmed: true, target: "current-real-conversation" }, ids.PUBLISHER, id);
  const view = await h.store.export(id);
  const before = await h.store.status();

  const dom = new JSDOM("<main></main>", { url: "http://127.0.0.1" });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = dom.window.document.querySelector("main")!;
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  t.mock.method(globalThis, "fetch", () => assert.fail("Authoring preview should use selected files only"));
  await act(async () => root.render(<AuthoringPage />));

  async function select(label: string, value: unknown) {
    const input = [...container.querySelectorAll("label")].find((entry) => entry.textContent?.includes(label))?.querySelector<HTMLInputElement>("input[type=file]");
    assert.ok(input, label);
    Object.defineProperty(input, "files", { configurable: true, value: [new File([JSON.stringify(value)], "record.json")] });
    await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    for (let attempt = 0; input.disabled && attempt < 100; attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.equal(input.disabled, false, "file processing did not finish");
    return container.textContent ?? "";
  }

  assert.match(await select("Saved draft JSON", revised.record), /LINEAGE_INVALID/u);
  const tampered = structuredClone(h.saved);
  tampered.candidate.details.title = "Changed ancestor";
  assert.match(await select("Saved ancestor JSON files", tampered), /LINEAGE_INVALID/u);
  const withAncestor = await select("Saved ancestor JSON files", h.saved);
  assert.match(withAncestor, /Review eligible Yes/u);
  assert.doesNotMatch(withAncestor, /LINEAGE_INVALID/u);
  assert.match(await select("Saved draft JSON", revised.record), /LINEAGE_INVALID/u);
  const fromExport = await select("Workflow export JSON", view);
  for (const expected of ["APPROVED", "Review eligibility Yes", "Submitted validation current", "Runtime eligible false", "PUBLICATION_BLOCKED"]) {
    assert.ok(fromExport.includes(expected), expected);
  }
  assert.doesNotMatch(fromExport, /LINEAGE_INVALID|Human approval absent/u);
  assert.deepEqual(await h.store.status(), before);
});

const noChange = async (h: H, action: () => Promise<unknown>, codes: string | string[]) => {
  const before = await h.store.status();
  await assert.rejects(action(), failure(codes));
  assert.deepEqual(await h.store.status(), before);
};
const pending = async (h: H) => { await h.adopt(); await h.submit(); await h.start(); };

const lifecycleCases: [string, (h: H) => Promise<unknown>, string[]][] = [
  ["01 direct DRAFT approval", async (h) => h.call("approve", { ...approveEvidence, reviewId: randomUUID() }), ["REVIEW_REQUIRED"]],
  ["02 direct DRAFT publication", async (h) => h.call("publish", { approvalId: randomUUID(), target: "current-real-conversation", confirmed: true }), ["INVALID_REVIEW_STATE"]],
  ["06 invalid action", async (h) => { const request = await h.store.prepare(h.saved.candidateId, "adopt", { confirmed: true }); Reflect.set(request, "action", "teleport"); return h.store.transition(request, ids.AUTHOR); }, ["INVALID_REVIEW_REQUEST"]],
  ["08 stale expected lifecycle", async (h) => { const request = await h.store.prepare(h.saved.candidateId, "submit", { validation: await h.drafts.validateBytes(new TextEncoder().encode(JSON.stringify(h.saved))) }); request.expectedState = "APPROVED"; return h.store.transition(request, ids.AUTHOR); }, ["REVIEW_CONFLICT"]],
  ["16 missing review request", async (h) => h.call("start", { reviewId: randomUUID() }), ["REVIEW_REQUIRED"]],
  ["23 missing reviewer identity", async (h) => h.call("start", { reviewId: randomUUID() }, ""), ["UNAUTHORIZED_ACTOR"]],
  ["25 unauthorized reviewer", async (h) => h.call("approve", { ...approveEvidence, reviewId: randomUUID() }, ids.AUTHOR), ["UNAUTHORIZED_ACTOR"]],
  ["33 version collision", async (h) => h.revision("0.1.0"), ["VERSION_CONFLICT"]],
  ["35 expected hash mismatch", async (h) => { const request = await h.store.prepare(h.saved.candidateId, "submit", { validation: await h.drafts.validateBytes(new TextEncoder().encode(JSON.stringify(h.saved))) }); request.expectedContentHash = "0".repeat(64); return h.store.transition(request, ids.AUTHOR); }, ["REVIEW_CONFLICT"]],
  ["39 publish unapproved content", async (h) => h.call("publish", { approvalId: randomUUID(), target: "current-real-conversation", confirmed: true }), ["INVALID_REVIEW_STATE"]],
  ["46 publish without publisher", async (h) => h.call("publish", { approvalId: randomUUID(), target: "current-real-conversation", confirmed: true }, ids.REVIEWER), ["UNAUTHORIZED_ACTOR"]],
  ["61 browser role injection", async (h) => { const request = await h.store.prepare(h.saved.candidateId, "submit", { validation: await h.drafts.validateBytes(new TextEncoder().encode(JSON.stringify(h.saved))) }); Reflect.set(request, "role", "REVIEWER"); return h.store.transition(request, ids.AUTHOR); }, ["INVALID_REVIEW_REQUEST"]],
];
for (const [name, action, expected] of lifecycleCases) test("6C negative " + name, async (t) => {
  const h = await harness(t); await h.adopt(); await noChange(h, () => action(h), expected);
});

test("6C negative 03 cannot publish in SAFETY_REVIEW", async (t) => {
  const h = await harness(t); await h.adopt(); await h.submit();
  await noChange(h, () => h.call("publish", { approvalId: randomUUID(), target: "current-real-conversation", confirmed: true }), "INVALID_REVIEW_STATE");
});
for (const name of ["04 rejected approval bypass", "29 approval after rejection", "40 publishing rejected content"]) test("6C negative " + name, async (t) => {
  const h = await harness(t); await pending(h); await h.reject();
  assert.equal((await h.view()).item.lifecycle, "DRAFT");
  await noChange(h, () => name.startsWith("40") ? h.call("publish", { approvalId: randomUUID(), target: "current-real-conversation", confirmed: true }) : h.approve(),
    name.startsWith("40") ? "INVALID_REVIEW_STATE" : ["REVIEW_CONFLICT", "REVIEW_REQUIRED"]);
  await noChange(h, h.submit, "REVISION_REQUIRED");
});
test("6C negative 05 approval never auto-publishes and preserves exact artifact", async (t) => {
  const h = await harness(t); await h.approved();
  const item = (await h.view()).item;
  assert.equal(item.lifecycle, "APPROVED"); assert.equal(item.publications.length, 0);
  assert.equal(item.approval!.runtimeEligible, false);
  assert.deepEqual(item.approval!.record, h.saved);
});
test("6C negative 07/53 identical retries append no duplicate transition or audit event", async (t) => {
  const h = await harness(t);
  const request = await h.store.prepare(h.saved.candidateId, "adopt", { confirmed: true });
  const first = await h.store.transition(request, ids.AUTHOR), before = await h.store.status();
  const retry = await h.store.transition(request, ids.AUTHOR);
  assert.equal(first.duplicate, false); assert.equal(retry.duplicate, true);
  assert.deepEqual(await h.store.status(), before);
  assert.equal((await h.view()).audit.filter((event) => event.type === "DRAFT_CREATED").length, 1);
});
test("6C negative 09 structural failure blocks registry entry", async (t) => {
  const h = await harness(t);
  const changed = structuredClone(h.saved); Reflect.deleteProperty(changed.candidate.details, "title");
  await writeFile(h.drafts.pathFor(h.saved.candidateId), JSON.stringify(changed));
  await noChange(h, h.adopt, "VALIDATION_BLOCKED");
});
test("6C negative 10/22 blocking safety error cannot be submitted or overridden", async (t) => {
  const source = new (await import("@vaccine/scenario-schema")).DeterministicMockScenarioGenerator().generateDraft(
    (await import("@vaccine/scenario-schema")).parseMockDraftBrief(brief));
  source.details.debriefs[0]!.takeaway = "The learner was panicked.";
  const h = await harness(t, { candidate: source }); await h.adopt();
  assert.equal((await h.view()).item.validation.status, "FAIL");
  await noChange(h, h.submit, "VALIDATION_BLOCKED");
  await noChange(h, () => h.call("warning", { reviewId: randomUUID(), warning: {
    ruleId: "DEBRIEF_INFERENCE", path: "/", decision: "ACCEPTED_WITH_JUSTIFICATION", rationale: warningRationale,
  } }), "REVIEW_REQUIRED");
});
for (const name of ["11 forged validation", "14 stale validator version"]) test("6C negative " + name, async (t) => {
  const h = await harness(t); await h.adopt();
  const validation = await h.drafts.validateBytes(new TextEncoder().encode(JSON.stringify(h.saved)));
  if (name.startsWith("14")) validation.validationVersion = "0.0.0";
  else { validation.findings = []; validation.status = "PASS"; }
  await noChange(h, () => h.call("submit", { validation }), "VALIDATION_BLOCKED");
});
for (const name of ["12 stale candidate hash", "30 approval after content edit"]) test("6C negative " + name, async (t) => {
  const h = await harness(t); await h.ready();
  const changed = structuredClone(h.saved); changed.candidate.details.title = "Edited cache behind submitted snapshot";
  await writeFile(h.drafts.pathFor(h.saved.candidateId), JSON.stringify(changed));
  await noChange(h, h.approve, "REVIEW_CONFLICT");
});
test("6C negative 13 stale safety policy blocks approval", async (t) => {
  const h = await harness(t); await h.ready();
  h.safety.forbiddenOperationalPhrases.push("new policy-only phrase");
  await noChange(h, h.approve, "STALE_VALIDATION");
});
test("6C negative 15 invalid provenance fails closed", async (t) => {
  const h = await harness(t);
  const changed = structuredClone(h.saved); Reflect.set(changed.provenance, "source", "EVON_VERIFIED");
  await writeFile(h.drafts.pathFor(h.saved.candidateId), JSON.stringify(changed));
  await noChange(h, h.adopt, "VALIDATION_BLOCKED");
});
for (const name of ["17 incomplete checklist", "18 failed critical checklist", "19 missing warning acknowledgement", "21 warning requires changes"]) {
  test("6C negative " + name, async (t) => {
    const h = await harness(t); await pending(h);
    if (!name.startsWith("17")) await h.checks();
    if (name.startsWith("18")) await h.checks({ syntheticDataOnly: { decision: "FAIL", reason: "Synthetic fixture flags a safety condition for correction." } });
    if (!name.startsWith("19")) { await h.warn(0, name.startsWith("21") ? "REQUIRES_CHANGES" : "ACCEPTED_WITH_JUSTIFICATION"); await h.warn(1); }
    await noChange(h, h.approve, name.startsWith("17") || name.startsWith("18") ? "CHECKLIST_INCOMPLETE" : "WARNING_DECISION_REQUIRED");
  });
}
test("6C negative 20 blank warning rationale is rejected", async (t) => {
  const h = await harness(t); await pending(h);
  await noChange(h, () => h.warn(0, "ACCEPTED_WITH_JUSTIFICATION", " "), "INVALID_REVIEW_REQUEST");
});
test("6C negative 24 self-review is prohibited even when role exists in local policy", async (t) => {
  const h = await harness(t, { selfRole: true }); await h.adopt(); await h.submit();
  await noChange(h, () => h.call("start", { reviewId: (h.saved.candidateId.slice(0, 36)) }, ids.AUTHOR), "INVALID_REVIEW_REQUEST");
  await noChange(h, async () => h.call("start", { reviewId: (await h.view()).item.review!.reviewId }, ids.AUTHOR), "SELF_APPROVAL_BLOCKED");
});
test("6C negative 26 review targets the exact submitted request", async (t) => {
  const h = await harness(t); await pending(h);
  await noChange(h, () => h.call("checklist", { reviewId: randomUUID(), items: checklist }), "REVIEW_REQUIRED");
});
for (const name of ["27 snapshot mutation", "51 missing audit actor", "52 missing audit", "54 incorrect audit states", "55 malformed audit"]) {
  test("6C negative " + name, async (t) => {
    const h = await harness(t); await h.adopt(); await h.submit();
    await h.corrupt((commit) => {
      const item = commit.item as { review: { snapshotHash: string } };
      const audit = commit.audit as { actor: unknown; before: string }[];
      if (name.startsWith("27")) item.review.snapshotHash = "0".repeat(64);
      else if (name.startsWith("51")) Reflect.deleteProperty(audit[0]!, "actor");
      else if (name.startsWith("52")) commit.audit = [];
      else if (name.startsWith("54")) audit[0]!.before = "APPROVED";
      else audit[0]!.actor = "malformed";
    });
    await assert.rejects(h.store.status(), failure("REGISTRY_CORRUPT"));
  });
}
test("6C negative 28 duplicate approval creates one approval record", async (t) => {
  const h = await harness(t); await h.ready();
  const request = await h.store.prepare(h.saved.candidateId, "approve", { ...approveEvidence, reviewId: (await h.view()).item.review!.reviewId });
  const first = await h.store.transition(request, ids.REVIEWER), retry = await h.store.transition(request, ids.REVIEWER);
  assert.equal(first.item.approval!.approvalId, retry.item.approval!.approvalId);
  assert.equal((await h.view()).audit.filter((event) => event.type === "REVIEW_APPROVED").length, 1);
  await noChange(h, h.approve, "REVIEW_REQUIRED");
});
test("6C negative 31/32 immutable approved/runtime artifact cannot be edited in place", async (t) => {
  const h = await harness(t); await h.approved();
  const request = await h.store.prepare(h.saved.candidateId, "revise", { candidate: h.saved.candidate, revisionReason: "A test fixture requests a changed version." });
  Reflect.set(request, "action", "edit");
  await noChange(h, () => h.store.transition(request, ids.AUTHOR), "INVALID_REVIEW_REQUEST");
  Reflect.set(request, "action", "revise"); request.expectedState = "RUNTIME_ELIGIBLE";
  await noChange(h, () => h.store.transition(request, ids.AUTHOR), "REVIEW_CONFLICT");
});
test("6C negative 34 missing lineage cannot authorize review", async (t) => {
  const h = await harness(t);
  const changed = structuredClone(h.saved); changed.previousCandidateId = "mock-" + "a".repeat(64);
  await writeFile(h.drafts.pathFor(h.saved.candidateId), JSON.stringify(changed));
  await h.adopt();
  await noChange(h, h.submit, "VALIDATION_BLOCKED");
});
test("6C negative 36 missing parent cannot create a revision", async (t) => {
  const h = await harness(t);
  const request = await h.store.prepare(h.saved.candidateId, "revise", { candidate: h.saved.candidate, revisionReason: "Attempt to revise an unregistered parent fixture." });
  await noChange(h, () => h.store.transition(request, ids.AUTHOR), "CANDIDATE_NOT_MANAGED");
});
test("6C negative 37 revised content never inherits approval", async (t) => {
  const h = await harness(t); await h.approved();
  const parent = (await h.view()).item.approval;
  const next = await h.revision();
  assert.equal(next.item.lifecycle, "DRAFT"); assert.equal(next.item.approval, null);
  assert.equal(next.item.review, null); assert.equal(next.item.record.previousCandidateId, h.saved.candidateId);
  assert.notEqual(next.item.record.contentHash, h.saved.contentHash);
  assert.deepEqual((await h.view()).item.approval, parent);
});
test("6C negative 38 simultaneous revisions use compare-and-swap and retain a recoverable draft", async (t) => {
  const h = await harness(t); await h.adopt();
  const next = revisionProposalCandidate(JSON.stringify(h.saved.candidate), "0.1.1");
  const one = await h.store.prepare(h.saved.candidateId, "revise", { candidate: next, revisionReason: "First concurrent revision from a synthetic fixture." });
  const two = { ...one, operationId: randomUUID() };
  const results = await Promise.allSettled([h.store.transition(one, ids.AUTHOR), h.store.transition(two, ids.AUTHOR)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected");
  assert.equal(failed?.reason.code, "REVIEW_CONFLICT");
  assert.equal((await h.store.status()).candidates.length, 2);
});
test("6C negative 41 stale approval cannot be published", async (t) => {
  const h = await harness(t); await h.approved();
  h.safety.forbiddenOperationalPhrases.push("new publication policy phrase");
  const published = await h.publish();
  assert.ok(published.item.publications[0]!.reasons.includes("VALIDATION_STALE"));
  assert.equal(published.item.lifecycle, "APPROVED");
});
test("6C negative 42/43/44 incompatible runtime schema, terminal mapping and pressure are blocked", async (t) => {
  const h = await harness(t); await h.approved();
  const result = await h.publish(), publication = result.item.publications[0]!;
  for (const reason of ["REVIEWED_RUNTIME_PACKAGE_MISSING", "TERMINAL_MAPPING_NOT_INTEGRATED", "PRESSURE_PROFILE_UNSUPPORTED", "RUNTIME_SCENARIO_UNREGISTERED"]) {
    assert.ok(publication.reasons.some((value) => value === reason));
  }
  assert.equal(publication.status, "PUBLICATION_BLOCKED"); assert.equal(result.item.lifecycle, "APPROVED");
  const request = await h.store.prepare(h.saved.candidateId, "publish", { approvalId: result.item.approval!.approvalId, confirmed: true, target: "current-real-conversation" });
  Reflect.set(request.evidence as object, "content", { arbitrary: "injection" });
  await noChange(h, () => h.store.transition(request, ids.PUBLISHER), "INVALID_REVIEW_REQUEST");
});
test("6C negative 45 two-turn draft reviews but cannot claim three-turn runtime support", async (t) => {
  const h = await harness(t, { twoTurns: true }); await h.approved();
  assert.equal((await h.view()).item.record.candidate.draft.scenario.adaptive_policy!.max_turns, 2);
  assert.ok((await h.publish()).item.publications[0]!.reasons.includes("TURN_POLICY_UNSUPPORTED"));
});
test("6C negative 47 conflicting duplicate publication request is rejected", async (t) => {
  const h = await harness(t); await h.approved();
  const request = await h.store.prepare(h.saved.candidateId, "publish", { approvalId: (await h.view()).item.approval!.approvalId, confirmed: true, target: "current-real-conversation" });
  await h.store.transition(request, ids.PUBLISHER);
  Reflect.set(request.evidence as object, "approvalId", randomUUID());
  await noChange(h, () => h.store.transition(request, ids.PUBLISHER), "IDEMPOTENCY_CONFLICT");
});
test("6C negative 48/56 failed publication write has no phantom manifest or audit", async (t) => {
  let fail = false;
  const h = await harness(t, { options: { before(stage) { if (stage === "link" && fail) throw new Error("Injected local fixture failure"); } } });
  await h.approved(); const before = await h.store.status(); fail = true;
  await assert.rejects(h.publish(), failure("REVIEW_STORAGE_FAILED"));
  fail = false;
  assert.deepEqual(await h.store.status(), before);
  assert.equal((await h.view()).item.publications.length, 0);
});
test("6C negative 49 protected S-01 cannot be adopted", async (t) => {
  const h = await harness(t);
  const changed = structuredClone(h.saved);
  changed.candidate.draft.scenario.scenario_id = changed.candidate.draft.scenarioBrief.scenarioId = "S-01";
  await writeFile(h.drafts.pathFor(h.saved.candidateId), JSON.stringify(changed));
  await noChange(h, h.adopt, "VALIDATION_BLOCKED");
});
test("6C negative 50 no review-write endpoint or direct runtime content injection exists", async (t) => {
  const server = createApiServer({ environment: "test" }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const denied = await fetch(base + "/api/authoring/review/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "REVIEWER", status: "APPROVED" }) });
  assert.equal(denied.status, 404);
  const candidate = await fetch(base + "/api/sessions", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "S-90", scenarioVersion: "0.1.0", language: "hi-IN", runtimeMode: "REAL_CONVERSATION", demoMode: false }) });
  assert.equal((await candidate.json()).error.code, "SCENARIO_NOT_FOUND");
});
test("6C negative 57 notes cannot leak secret values into audit", async (t) => {
  const h = await harness(t); await h.ready();
  const secret = ["731", "482"].join("");
  await noChange(h, async () => h.call("approve", { ...approveEvidence, notes: "Negative fixture OTP is " + secret, reviewId: (await h.view()).item.review!.reviewId }), "UNSAFE_REVIEW_TEXT");
  assert.ok(!JSON.stringify((await h.view()).audit).includes(secret));
});
test("6C negative 58/59 UI capabilities fail closed on missing or stale persisted decisions", async (t) => {
  const h = await harness(t); await pending(h);
  const view = await h.view(), fresh = await validateAuthoringDraft(h.saved, { safety: h.safety });
  assert.equal(reviewUiCapabilities(view, fresh, true).approve, false);
  await h.checks(); await h.warn(0); await h.warn(1);
  const ready = await h.view();
  assert.equal(reviewUiCapabilities(ready, fresh, true).approve, true);
  assert.equal(reviewUiCapabilities(ready, fresh, false).approve, false);
  assert.equal(reviewUiCapabilities(ready, fresh, true).publish, false);
  const stale = createReviewProposal(view, "approve", { ...approveEvidence, reviewId: view.item.review!.reviewId });
  await noChange(h, () => h.store.transition(stale, ids.REVIEWER), "REVIEW_CONFLICT");
});
test("6C negative 60 forged browser-only approval fails integrity without granting authority", async (t) => {
  const h = await harness(t); await h.adopt();
  const view = await h.view(); view.item.lifecycle = "APPROVED";
  const { exportHash: _hash, ...body } = view;
  view.exportHash = await hashAuthoringData(body);
  await assert.rejects(verifyReviewExport(view, h.safety), failure("REGISTRY_CORRUPT"));
  assert.equal((await h.view()).item.lifecycle, "DRAFT");
});
test("6C negative 62 UI preserves both warning descriptions, rationales, roles and source metadata", async (t) => {
  const h = await harness(t); await pending(h); await h.warn(0);
  const view = await h.view(), fresh = await validateAuthoringDraft(h.saved, { safety: h.safety });
  const html = renderToStaticMarkup(<ReviewWorkflowDetails view={view} fresh={fresh} snapshotCurrent={true} renderCandidate={() => <div>Full content snapshot</div>} />);
  for (const text of ["DUMMY_CONTEXT", "COMPLIANCE_REVIEW", warningRationale, "Human review checklist", "Version and audit history",
    "local-author", "local-reviewer", "DETERMINISTIC_MOCK", "CLI"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<option[^>]*>REVIEWER|<option[^>]*>PUBLISHER/u);
});

test("6C complete test-only happy path, immutable artifact, explicit blocked publish and full event history", async (t) => {
  const h = await harness(t); await h.approved();
  const approval = (await h.view()).item.approval!;
  assert.equal(approval.humanReview.decision, "approved");
  assert.equal(approval.contentHash, h.saved.contentHash);
  assert.ok(approval.artifactHash);
  const result = await h.publish();
  assert.equal(result.item.lifecycle, "APPROVED");
  assert.equal(result.item.approval!.artifactHash, approval.artifactHash);
  const view = await verifyReviewExport(parseReviewJson(new TextEncoder().encode(JSON.stringify(await h.view()))), h.safety);
  for (const type of ["DRAFT_CREATED", "VALIDATION_COMPLETED", "REVIEW_SUBMITTED", "REVIEW_STARTED", "CHECKLIST_UPDATED",
    "WARNING_ACKNOWLEDGED", "REVIEW_APPROVED", "PUBLICATION_REQUESTED", "PUBLICATION_BLOCKED"]) assert.ok(view.audit.some((event) => event.type === type), type);
  assert.equal(view.audit.filter((event) => event.type === "WARNING_ACKNOWLEDGED").length, 2);
});
test("6C rejection and revision preserve history, require fresh validation and a fresh review", async (t) => {
  const h = await harness(t); await pending(h); await h.reject("request-changes");
  const reviewId = (await h.view()).item.review!.reviewId;
  assert.deepEqual((await h.view()).item.review!.decisionDetails, {
    action: "request-changes", failedItems: ["educationalPurpose"], findingPaths: [],
  });
  const next = await h.revision();
  const nextId = next.item.record.candidateId;
  assert.equal(next.item.record.candidate.draft.scenario.version, "0.1.1");
  assert.equal(next.item.lifecycle, "DRAFT"); assert.equal(next.item.approval, null);
  const submitted = await h.call("submit", { validation: next.item.validation }, ids.AUTHOR, nextId);
  assert.notEqual(submitted.item.review!.reviewId, reviewId);
  const history = (await h.store.export(nextId)).history;
  assert.equal(history.length, 2);
  assert.equal(history.find((entry) => entry.candidateId === h.saved.candidateId)!.reviewDecision, "rejected");
  assert.ok(history.find((entry) => entry.candidateId === nextId)!.changedPaths.some((path) => path.includes("premise")));
});
test("6C edit proposal handles every supported content group and synchronizes canonical copies", async (t) => {
  const h = await harness(t); await h.adopt();
  const candidate = structuredClone(h.saved.candidate);
  candidate.details.title = "A clearer fictional wellness exercise";
  candidate.details.premise += " This revision documents unsolicited synthetic disclosure.";
  candidate.draft.scenario.learning_objectives[0] = "Pause and independently check a fictional wellness request.";
  candidate.draft.scenario.fictional_organization.name = "Fictional Meghdoot Practice Works";
  candidate.draft.scenario.responses["system.opening"]!.text += " Practice ke liye hai.";
  candidate.draft.scenario.opening_line = candidate.draft.scenario.responses["system.opening"]!.text;
  candidate.draft.scenario.responses["authority.low"]!.text += " Yeh practice hai.";
  candidate.draft.scenario.responses["ending.verified"]!.text += " Dhanyavaad.";
  candidate.draft.behaviorTrainingExamples[0]!.utterance += " यह अभ्यास है।";
  candidate.details.redFlags[0]!.description += " Human author clarification.";
  candidate.details.safeActions[0] += " Take your own time.";
  candidate.details.decisionPoints[0]!.context += " Check the familiar directory.";
  candidate.draft.debriefTemplateVariants[0]!.text += " Apna known channel chunein.";
  const proposal = revisionProposalCandidate(JSON.stringify(candidate), "0.2.0");
  const next = await h.call("revise", { candidate: proposal, revisionReason: "Clarify the content groups through an explicit new revision." });
  assert.equal(next.item.lifecycle, "DRAFT");
  assert.equal(next.item.record.candidate.draft.scenario.version, "0.2.0");
  assert.equal((await h.view()).item.record.contentHash, h.saved.contentHash);
});

for (const stage of ["draft-load", "validation", "snapshot", "checklist", "warning", "decision", "approval-artifact", "audit", "publish-manifest", "version-lookup", "write", "link"] as const) {
  test("6C failure injection " + stage + " has no phantom decision or audit", async (t) => {
    let armed = false;
    const h = await harness(t, { options: { before(value) { if (armed && value === stage) throw new Error("Synthetic local failure"); } } });
    if (stage === "draft-load" || stage === "version-lookup") {
      armed = true; await assert.rejects(h.adopt(), failure("REVIEW_STORAGE_FAILED")); armed = false;
      assert.equal((await h.store.status()).sequence, 0); return;
    }
    await h.ready();
    if (stage === "publish-manifest") await h.approve();
    const before = await h.store.status();
    armed = true;
    const action = stage === "validation" || stage === "snapshot" ? async () => {
      const other = await h.drafts.generate({ ...brief, scenarioId: "S-91" });
      armed = false; await h.call("adopt", { confirmed: true }, ids.AUTHOR, other.candidateId);
      armed = true;
      return h.call("submit", { validation: await h.drafts.validateBytes(new TextEncoder().encode(JSON.stringify(other))) }, ids.AUTHOR, other.candidateId);
    } : stage === "checklist" ? h.checks : stage === "warning" ? () => h.warn(0)
      : stage === "publish-manifest" ? h.publish : h.approve;
    if (stage === "validation" || stage === "snapshot") {
      await assert.rejects(action(), failure("REVIEW_STORAGE_FAILED")); armed = false;
      assert.equal((await h.view()).item.lifecycle, "SAFETY_REVIEW");
    } else {
      await assert.rejects(action(), failure("REVIEW_STORAGE_FAILED")); armed = false;
      assert.deepEqual(await h.store.status(), before);
    }
  });
}
test("6C missing actors, policy spoofing and unsafe role configuration fail closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vv-phase6c-auth-")); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalReviewStore(root, references);
  await assert.rejects(store.configure({ ...actorTemplate, acknowledgedLocalTrust: false }), failure("LOCAL_POLICY_REQUIRED"));
});
test("6C review and publication hold never invoke provider, network or credit operations", async (t) => {
  const h = await harness(t);
  const forbidden = () => assert.fail("Review workflow attempted a provider, network or credit operation");
  t.mock.method(globalThis, "fetch", forbidden);
  t.mock.method(RuntimeCreditLedger.prototype, "reserve", forbidden);
  t.mock.method(RuntimeCreditLedger.prototype, "chargeSimulated", forbidden);
  const files = ["content/scenarios/S-01-urgent-account-verification.json", "content/authoring/S-01-hi-IN.package.json", "content/scenarios/S-02-insurance-refund-trap.json", "content/scenarios/S-03-telecom-kyc-lockout.json"];
  const before = await Promise.all(files.map((file) => readFile(file)));
  await h.approved();
  await h.call("hold", { approvalId: (await h.view()).item.approval!.approvalId, confirmed: true, reason: "Test publisher holds this artifact for future integration checks." });
  assert.ok((await h.publish()).item.publications[0]!.reasons.includes("PUBLICATION_HELD"));
  assert.deepEqual(await Promise.all(files.map((file) => readFile(file))), before);
  assert.ok((await h.view()).audit.every((event) => Boolean(event.actor.actorId && event.actor.role && event.eventHash)));
});
test("6C S-91 manual-import snapshot supports review and blocks incompatible publication", async (t) => {
  const candidate = JSON.parse(await readFile(new URL("../../../content/authoring/examples/benefits-import.json", import.meta.url), "utf8")) as AuthoringCandidate;
  const h = await harness(t, { candidate }); await h.approved();
  const item = (await h.view()).item;
  assert.equal(item.record.candidate.draft.scenario.scenario_id, "S-91");
  assert.equal(item.record.provenance.source, "MANUAL_IMPORT");
  assert.equal(item.record.candidate.draft.scenario.adaptive_policy!.max_turns, 2);
  assert.equal(item.review!.warnings.length, 2);
  assert.ok((await h.publish()).item.publications[0]!.reasons.includes("TURN_POLICY_UNSUPPORTED"));
});
test("6C one warning acceptance is insufficient, individual second acceptance allows approval", async (t) => {
  const h = await harness(t); await pending(h); await h.checks(); await h.warn(0);
  await noChange(h, h.approve, "WARNING_DECISION_REQUIRED");
  await h.warn(1); assert.equal((await h.approve()).item.lifecycle, "APPROVED");
});
test("6C critical checklist NA and resolved-in-new-revision warning cannot bypass approval", async (t) => {
  const h = await harness(t); await pending(h);
  await noChange(h, () => h.checks({ syntheticDataOnly: { decision: "NOT_APPLICABLE", reason: "A synthetic fixture attempts to skip a critical safety item." } }), "CHECKLIST_INCOMPLETE");
  await h.checks(); await h.warn(0, "RESOLVED_IN_NEW_REVISION"); await h.warn(1);
  await noChange(h, h.approve, "WARNING_DECISION_REQUIRED");
});

test("6C completed decisions remain pending until an explicit approval operation", async (t) => {
  const h = await harness(t); await h.ready();
  const { item } = await h.view();
  assert.equal(item.lifecycle, "SAFETY_REVIEW"); assert.equal(item.approval, null);
  for (const entry of Object.values(item.review!.checklist)) {
    assert.equal(entry!.contentHash, h.saved.contentHash); assert.equal(entry!.reviewId, item.review!.reviewId);
    assert.equal(entry!.actor.actorId, ids.REVIEWER); assert.equal(entry!.at, fixed);
  }
  for (const entry of item.review!.warnings) {
    assert.equal(entry.reviewId, item.review!.reviewId); assert.equal(entry.contentHash, h.saved.contentHash);
  }
});
test("6C simultaneous approvals create one artifact without last-write-wins", async (t) => {
  const h = await harness(t); await h.ready();
  const one = await h.store.prepare(h.saved.candidateId, "approve", { ...approveEvidence, reviewId: (await h.view()).item.review!.reviewId });
  const results = await Promise.allSettled([h.store.transition(one, ids.REVIEWER), h.store.transition({ ...one, operationId: randomUUID() }, ids.REVIEWER)]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(results.find((entry) => entry.status === "rejected")?.reason.code, "REVIEW_CONFLICT");
  assert.equal((await h.view()).audit.filter((entry) => entry.type === "REVIEW_APPROVED").length, 1);
});
test("6C a second configured reviewer cannot take over an assigned review", async (t) => {
  const h = await harness(t, { secondReviewer: true }); await h.ready();
  const request = await h.store.prepare(h.saved.candidateId, "approve", { ...approveEvidence, reviewId: (await h.view()).item.review!.reviewId });
  await noChange(h, () => h.store.transition(request, "local-reviewer-two"), "REVIEW_REQUIRED");
  assert.equal((await h.approve()).item.lifecycle, "APPROVED");
});
test("6C submit, checklist, individual warning and publication retries are idempotent", async (t) => {
  const h = await harness(t); await h.adopt();
  const retry = async (action: ReviewAction, evidence: unknown) => {
    const request = await h.store.prepare(h.saved.candidateId, action, evidence);
    await h.store.transition(request, role(action));
    const before = await h.view();
    assert.equal((await h.store.transition(request, role(action))).duplicate, true);
    const after = await h.view();
    assert.equal(after.sequence, before.sequence); assert.deepEqual(after.item, before.item); assert.deepEqual(after.audit, before.audit);
  };
  await retry("submit", { validation: (await h.view()).item.validation }); await h.start();
  const review = (await h.view()).item.review!;
  await retry("checklist", { reviewId: review.reviewId, items: checklist });
  for (const finding of review.snapshot.validation.findings.filter((entry) => entry.severity === "WARNING")) {
    await retry("warning", { reviewId: review.reviewId, warning: { ruleId: finding.ruleId, path: finding.path,
      decision: "ACCEPTED_WITH_JUSTIFICATION", rationale: warningRationale } });
  }
  await h.approve();
  await retry("publish", { approvalId: (await h.view()).item.approval!.approvalId, confirmed: true, target: "current-real-conversation" });
  assert.equal((await h.view()).item.publications.length, 1);
});
test("6C re-instantiated stores preserve decisions, approval, lineage, publication and audit", async (t) => {
  const h = await harness(t); await h.approved(); await h.publish(); const child = await h.revision();
  const parentBefore = await h.view(), childBefore = await h.store.export(child.item.record.candidateId);
  const restarted = new LocalReviewStore(h.root, h.safety, h.options);
  assert.deepEqual(await restarted.export(h.saved.candidateId), parentBefore);
  assert.deepEqual(await restarted.export(child.item.record.candidateId), childBefore);
  assert.equal(childBefore.item.review, null); assert.equal(childBefore.lineage[0]!.candidateId, h.saved.candidateId);
});
test("6C revision storage failure and post-save journal failure recover without phantom state", async (t) => {
  let armed = false;
  const h = await harness(t, { options: { before(stage) { if (armed && stage === "audit") throw new Error("Injected journal failure after draft save"); } } });
  await h.adopt();
  const request = await h.store.prepare(h.saved.candidateId, "revise", {
    candidate: revisionProposalCandidate(JSON.stringify(h.saved.candidate), "0.1.1"), revisionReason: "Offline recovery fixture creates a new version without inherited review.",
  });
  const mock = t.mock.method(LocalDraftStore.prototype, "createRevision", async () => { throw new Error("Injected draft storage failure"); });
  await noChange(h, () => h.store.transition(request, ids.AUTHOR), "REVIEW_STORAGE_FAILED"); mock.mock.restore();
  armed = true; await noChange(h, () => h.store.transition(request, ids.AUTHOR), "REVIEW_STORAGE_FAILED"); armed = false;
  assert.equal((await h.drafts.list()).length, 2); assert.equal((await h.store.status()).candidates.length, 1);
  const retry = await h.store.transition(request, ids.AUTHOR);
  assert.equal(retry.item.lifecycle, "DRAFT"); assert.equal(retry.item.approval, null);
  assert.equal((await h.drafts.list()).length, 2); assert.equal((await h.store.status()).candidates.length, 2);
});
test("6C revised S-92 resolves both content warnings through visible referenced guidance", async (t) => {
  const { DeterministicMockScenarioGenerator, parseMockDraftBrief } = await import("@vaccine/scenario-schema");
  const reviewBrief = JSON.parse(await readFile(new URL("../../../content/authoring/examples/phase6c-review-brief.json", import.meta.url), "utf8"));
  const original = new DeterministicMockScenarioGenerator().generateDraft(parseMockDraftBrief(reviewBrief));
  const h = await harness(t, { candidate: original }); await pending(h);
  assert.deepEqual((await h.view()).item.validation.findings.filter((entry) => entry.severity === "WARNING").map((entry) => entry.ruleId).sort(), ["COMPLIANCE_REVIEW", "DUMMY_CONTEXT"]);
  const revised = JSON.parse(await readFile(new URL("../../../content/authoring/examples/S-92-v0.1.1.candidate.json", import.meta.url), "utf8")) as AuthoringCandidate;
  const old = await h.view();
  const next = await h.call("revise", { candidate: revised, revisionReason: "Offline fixture verifies the owner-requested educational corrections only." });
  assert.equal(next.item.lifecycle, "DRAFT"); assert.equal(next.item.review, null); assert.equal(next.item.approval, null);
  assert.equal(next.item.validation.status, "PASS"); assert.equal(next.item.validation.summary.warnings, 0);
  assert.ok(next.item.validation.graph);
  assert.equal(next.item.validation.graph.maximumDepth, 3); assert.equal(next.item.validation.graph.terminalLeaves, 66);
  for (const key of ["variants", "examples", "decisionPoints", "terminalResponses"] as const) assert.deepEqual(revised.details[key], original.details[key]);
  assert.deepEqual(revised.draft.scenario.responses, original.draft.scenario.responses);
  assert.deepEqual(revised.draft.behaviorTrainingExamples, original.draft.behaviorTrainingExamples);
  assert.deepEqual(revised.draft.scenario.adaptive_policy, original.draft.scenario.adaptive_policy);
  const guidance = revised.details.debriefs.find((entry) => entry.behavior === "COMPLIED")!;
  assert.ok(revised.draft.debriefTemplateVariants.some((entry) => entry.templateId === guidance.templateId));
  assert.match(guidance.scoring, /remain unscored/u); assert.match(guidance.limitations, /DISCLOSED_DUMMY_SECRET/u);
  assert.match(revised.details.premise, /Unsolicited synthetic disclosure/u);
  assert.match(revised.details.premise, /real OTP, password ya account value nahi maangta/u);
  assert.deepEqual((await h.view()).item, old.item);
});
