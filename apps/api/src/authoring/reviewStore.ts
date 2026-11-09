import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AuthoringReviewError, ReviewActorPolicySchema, ReviewCommitSchema, ReviewExportSchema, ReviewOperationSchema,
  DraftAuthoringError,
  canSubmitForSafetyReview, canonicalDraftJson, checklistAllowsApproval, currentPublicationCompatibility,
  hashAuthoringData, legacyApprovalChecklist, parseReviewJson, reviewChangedPaths, reviewChecklist,
  reviewJsonLimit, validateAuthoringDraft, verifyReviewItem, warningAllowsApproval, warningIdentity, scanAuthoringText,
  type ActorStamp, type ReviewAction, type ReviewActorPolicy, type ReviewAuditEvent,
  type ReviewCommit, type ReviewExport, type ReviewItem, type ReviewOperation, type SavedDraft, type ScenarioSafetyOptions,
  type RuntimeRelease,
} from "@vaccine/scenario-schema";
import { LocalDraftStore } from "./draftStore.js";
import { compileOfflineRelease } from "./compileRelease.js";

type FailureStage = "draft-load" | "validation" | "snapshot" | "checklist" | "warning" | "decision"
  | "approval-artifact" | "audit" | "publish-manifest" | "version-lookup" | "write" | "link";
export interface ReviewStoreOptions {
  now?: () => Date;
  before?: (stage: FailureStage) => void | Promise<void>;
}
interface Registry {
  commits: ReviewCommit[];
  items: Map<string, ReviewItem>;
  sequence: number;
  headHash: string | null;
  audit: ReviewAuditEvent[];
  bytes: number;
}
const same = (a: unknown, b: unknown) => canonicalDraftJson(a) === canonicalDraftJson(b);
const roles: Record<ReviewAction, ActorStamp["role"]> = {
  adopt: "AUTHOR", submit: "AUTHOR", revise: "AUTHOR", start: "REVIEWER", checklist: "REVIEWER",
  warning: "REVIEWER", approve: "REVIEWER", reject: "REVIEWER", "request-changes": "REVIEWER",
  publish: "PUBLISHER", hold: "PUBLISHER",
};
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
const stateError = () => new AuthoringReviewError("INVALID_REVIEW_STATE");
function requireCondition(condition: unknown, failure: keyof typeof import("@vaccine/scenario-schema").reviewErrors): asserts condition {
  if (!condition) throw new AuthoringReviewError(failure);
}

async function readOwnedFile(path: string, maximum = reviewJsonLimit) {
  const before = await lstat(path);
  requireCondition(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, "REGISTRY_CORRUPT");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    requireCondition(stat.isFile() && stat.ino === before.ino && stat.dev === before.dev && stat.size <= maximum, "REGISTRY_CORRUPT");
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, count);
      if (!read.bytesRead) break;
      count += read.bytesRead;
    }
    requireCondition(count <= maximum, "REGISTRY_CORRUPT");
    return bytes.subarray(0, count);
  } finally { await file.close(); }
}

export class LocalReviewStore {
  readonly directory: string;
  private readonly directories: string[];
  private readonly draftStore: LocalDraftStore;
  constructor(
    workspace: string,
    private readonly safety: ScenarioSafetyOptions,
    private readonly options: ReviewStoreOptions = {},
  ) {
    const root = resolve(workspace);
    this.directory = join(root, "content", "authoring", "review-registry");
    this.directories = [join(root, "content"), join(root, "content", "authoring"), this.directory, join(this.directory, "commits")];
    this.draftStore = new LocalDraftStore(root, safety);
  }
  private now() { return (this.options.now?.() ?? new Date()).toISOString(); }
  private async before(stage: FailureStage) { await this.options.before?.(stage); }

  private async directoriesExist(create: boolean) {
    for (const directory of this.directories) {
      if (create) await mkdir(directory).catch((error: unknown) => { if (code(error) !== "EEXIST") throw error; });
      const stat = await lstat(directory);
      requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "REVIEW_STORAGE_FAILED");
    }
  }
  private async writeExclusive(destination: string, value: unknown) {
    const serialized = JSON.stringify(value, null, 2) + "\n";
    requireCondition(Buffer.byteLength(serialized) <= reviewJsonLimit, "REVIEW_STORAGE_FAILED");
    const temporary = join(this.directory, "." + randomUUID() + ".tmp");
    let staged = false;
    try {
      await this.before("write");
      const file = await open(temporary, "wx", 0o600);
      staged = true;
      try { await file.writeFile(serialized, "utf8"); await file.sync(); }
      finally { await file.close(); }
      await this.before("link");
      await link(temporary, destination);
    } finally { if (staged) await unlink(temporary).catch(() => undefined); }
  }
  async configure(input: unknown) {
    const parsed = ReviewActorPolicySchema.safeParse(input);
    requireCondition(parsed.success, "LOCAL_POLICY_REQUIRED");
    try {
      await this.directoriesExist(true);
      await this.writeExclusive(join(this.directory, "actors.json"), parsed.data);
      return { mode: parsed.data.mode, path: join(this.directory, "actors.json") };
    } catch { throw new AuthoringReviewError("LOCAL_POLICY_REQUIRED"); }
  }
  private async policy(): Promise<ReviewActorPolicy> {
    try {
      await this.directoriesExist(false);
      return ReviewActorPolicySchema.parse(parseReviewJson(await readOwnedFile(join(this.directory, "actors.json"), 16_384)));
    } catch { throw new AuthoringReviewError("LOCAL_POLICY_REQUIRED"); }
  }

  private async read(): Promise<Registry> {
    const registry: Registry = { commits: [], items: new Map(), sequence: 0, headHash: null, audit: [], bytes: 0 };
    try { await this.directoriesExist(false); }
    catch (error) {
      if (code(error) === "ENOENT") return registry;
      throw new AuthoringReviewError("REGISTRY_CORRUPT");
    }
    try {
      const entries = await readdir(join(this.directory, "commits"), { withFileTypes: true });
      const names = entries.filter((entry) => entry.name.endsWith(".json")).map((entry) => entry.name).sort();
      requireCondition(names.length <= 256, "REGISTRY_CORRUPT");
      let lastEventHash: string | null = null;
      for (const name of names) {
        requireCondition(name === String(registry.sequence + 1).padStart(8, "0") + ".json", "REGISTRY_CORRUPT");
        const bytes = await readOwnedFile(join(this.directory, "commits", name));
        registry.bytes += bytes.length;
        requireCondition(registry.bytes <= 64 * 1024 * 1024, "REGISTRY_CORRUPT");
        const commit = ReviewCommitSchema.parse(parseReviewJson(bytes));
        const { commitHash, ...body } = commit;
        requireCondition(commit.sequence === registry.sequence + 1 && commit.expectedSequence === registry.sequence
          && commit.previousCommitHash === registry.headHash && commitHash === await hashAuthoringData(body)
          && !registry.commits.some((prior) => prior.operationId === commit.operationId), "REGISTRY_CORRUPT");
        await verifyReviewItem(commit.item, this.safety);
        const previous = registry.items.get(commit.item.record.candidateId);
        if (previous) {
          requireCondition(same(previous.record, commit.item.record) && same(previous.author, commit.item.author), "REGISTRY_CORRUPT");
          if (previous.approval) requireCondition(same(previous.approval, commit.item.approval), "REGISTRY_CORRUPT");
          if (previous.review) requireCondition(same(previous.review.snapshot, commit.item.review?.snapshot), "REGISTRY_CORRUPT");
          if (commit.action !== "hold") requireCondition(same(previous.publicationHold, commit.item.publicationHold), "REGISTRY_CORRUPT");
        } else {
          requireCondition(["adopt", "revise"].includes(commit.action), "REGISTRY_CORRUPT");
          requireCondition(![...registry.items.values()].some((item) =>
            item.record.candidate.draft.scenario.scenario_id === commit.item.record.candidate.draft.scenario.scenario_id
            && item.record.candidate.draft.scenario.version === commit.item.record.candidate.draft.scenario.version), "REGISTRY_CORRUPT");
        }
        const priorPublications = previous?.publications ?? [];
        const addedPublication = commit.action === "publish" ? commit.item.publications.at(-1) : undefined;
        requireCondition(commit.item.publications.length === priorPublications.length + (commit.action === "publish" ? 1 : 0)
          && same(commit.item.publications.slice(0, priorPublications.length), priorPublications)
          && (commit.action !== "publish" || (previous?.lifecycle === "APPROVED" && addedPublication)), "REGISTRY_CORRUPT");
        const expectedBefore = previous?.lifecycle ?? null;
        for (const event of commit.audit) {
          const { eventHash, ...content } = event;
          requireCondition(event.sequence === registry.audit.length + 1 && event.previousEventHash === lastEventHash
            && eventHash === await hashAuthoringData(content)
            && event.actor.role === roles[commit.action]
            && event.candidateId === commit.item.record.candidateId
            && event.contentHash === commit.item.record.contentHash
            && event.before === expectedBefore && event.after === commit.item.lifecycle
            && (commit.action !== "publish" || (event.publicationId === addedPublication?.publicationId
              && event.approvalId === addedPublication.approvalId && same(event.actor, addedPublication.actor)))
            && event.actorPolicyHash === await hashAuthoringData(commit.actorPolicy)
            && commit.actorPolicy.actors.some((actor) => actor.actorId === event.actor.actorId && actor.roles.includes(event.actor.role)), "REGISTRY_CORRUPT");
          lastEventHash = eventHash; registry.audit.push(event);
        }
        requireCondition(same(commit.audit.map((event) => event.type), this.eventFor(commit.action, addedPublication?.status === "PUBLISHED")), "REGISTRY_CORRUPT");
        registry.commits.push(commit);
        registry.items.set(commit.item.record.candidateId, commit.item);
        registry.sequence = commit.sequence; registry.headHash = commitHash;
      }
      return registry;
    } catch {
      throw new AuthoringReviewError("REGISTRY_CORRUPT");
    }
  }

  private eventFor(action: ReviewAction, published = false): ReviewAuditEvent["type"][] {
    const events: Record<ReviewAction, ReviewAuditEvent["type"][]> = {
      adopt: ["DRAFT_CREATED", "VALIDATION_COMPLETED"], submit: ["REVIEW_SUBMITTED"], start: ["REVIEW_STARTED"],
      checklist: ["CHECKLIST_UPDATED"], warning: ["WARNING_ACKNOWLEDGED"], approve: ["REVIEW_APPROVED"],
      reject: ["REVIEW_REJECTED"], "request-changes": ["CHANGES_REQUESTED"], revise: ["DRAFT_REVISED", "VALIDATION_COMPLETED"],
      publish: ["PUBLICATION_REQUESTED", published ? "SCENARIO_PUBLISHED" : "PUBLICATION_BLOCKED"], hold: ["PUBLICATION_HELD"],
    };
    return events[action];
  }
  private lineage(record: SavedDraft, registry: Registry) {
    const lineage: SavedDraft[] = [];
    let id = record.previousCandidateId;
    const seen = new Set<string>();
    while (id && !seen.has(id) && seen.size < 32) {
      seen.add(id);
      const prior = registry.items.get(id)?.record;
      if (!prior) break;
      lineage.push(prior); id = prior.previousCandidateId;
    }
    return lineage;
  }
  private async validation(record: SavedDraft, registry: Registry) {
    await this.before("validation");
    return validateAuthoringDraft(record, { safety: this.safety, lineage: this.lineage(record, registry) });
  }
  private async unchanged(item: ReviewItem) {
    await this.before("draft-load");
    try {
      const current = await this.draftStore.load(item.record.candidateId);
      requireCondition(same(current, item.record), "REVIEW_CONFLICT");
    } catch { throw new AuthoringReviewError("REVIEW_CONFLICT"); }
  }
  private safeText(value: string) {
    let unsafe = false;
    scanAuthoringText([{ text: value, path: [] }], this.safety, (rule) => {
      if (rule === "SENSITIVE_VALUE" || rule === "CONTACT_DATA") unsafe = true;
    });
    requireCondition(!unsafe, "UNSAFE_REVIEW_TEXT");
  }
  private assertVersion(record: SavedDraft, registry: Registry) {
    const scenario = record.candidate.draft.scenario;
    requireCondition(!["S-01", "S-02", "S-03"].includes(scenario.scenario_id), "PROTECTED_SCENARIO");
    requireCondition(![...registry.items.values()].some((item) =>
      item.record.candidate.draft.scenario.scenario_id === scenario.scenario_id
      && item.record.candidate.draft.scenario.version === scenario.version), "VERSION_CONFLICT");
  }
  private requireReview(item: ReviewItem, actor: ActorStamp, reviewId: string) {
    requireCondition(item.lifecycle === "SAFETY_REVIEW" && item.review?.reviewId === reviewId
      && item.review.decision === "pending", "REVIEW_REQUIRED");
    requireCondition(actor.actorId !== item.author.actorId, "SELF_APPROVAL_BLOCKED");
    return item.review!;
  }
  private requireAssigned(item: ReviewItem, actor: ActorStamp, reviewId: string) {
    const review = this.requireReview(item, actor, reviewId);
    requireCondition(review.startedBy?.actorId === actor.actorId, "REVIEW_REQUIRED");
    return review;
  }

  async transition(input: unknown, actorId: string) {
    try { return await this.perform(input, actorId); }
    catch (error) {
      if (error instanceof AuthoringReviewError) throw error;
      if (error instanceof DraftAuthoringError) throw new AuthoringReviewError("VALIDATION_BLOCKED");
      throw new AuthoringReviewError("REVIEW_STORAGE_FAILED");
    }
  }

  private async perform(input: unknown, actorId: string) {
    const parsed = ReviewOperationSchema.safeParse(input);
    requireCondition(parsed.success, "INVALID_REVIEW_REQUEST");
    const request = parsed.data!;
    const policy = await this.policy();
    const configured = policy.actors.find((actor) => actor.actorId === actorId);
    requireCondition(configured?.roles.includes(roles[request.action]), "UNAUTHORIZED_ACTOR");
    const actor: ActorStamp = { actorId, role: roles[request.action] };
    const registry = await this.read();
    const requestHash = await hashAuthoringData({ request, actorId });
    const duplicate = registry.commits.find((commit) => commit.operationId === request.operationId);
    if (duplicate) {
      requireCondition(duplicate.requestHash === requestHash, "IDEMPOTENCY_CONFLICT");
      return { duplicate: true, sequence: registry.sequence, operationSequence: duplicate.sequence, item: registry.items.get(duplicate.item.record.candidateId)! };
    }
    requireCondition(registry.sequence === request.expectedSequence && registry.sequence < 256, "REVIEW_CONFLICT");
    let item = registry.items.get(request.candidateId);
    if (request.action === "adopt") {
      requireCondition(!item && request.expectedState === "DRAFT", "INVALID_REVIEW_STATE");
      await this.before("draft-load");
      const saved = await this.draftStore.load(request.candidateId);
      requireCondition(saved.contentHash === request.expectedContentHash, "REVIEW_CONFLICT");
      await this.before("version-lookup"); this.assertVersion(saved, registry);
      item = {
        record: saved, author: actor, createdAt: this.now(), lifecycle: "DRAFT", revisionReason: null,
        validation: await this.validation(saved, registry), review: null, approval: null, publications: [], publicationHold: null,
      };
    } else {
      requireCondition(item, "CANDIDATE_NOT_MANAGED");
      requireCondition(item!.lifecycle === request.expectedState && item!.record.contentHash === request.expectedContentHash, "REVIEW_CONFLICT");
      item = structuredClone(item!);
      await this.apply(request, item, actor, registry);
      if (request.action === "revise") item = await this.revise(request, item, actor, registry);
    }
    const before = registry.items.get(item.record.candidateId)?.lifecycle ?? null;
    const actorPolicyHash = await hashAuthoringData(policy);
    let eventHash: string | null = registry.audit.at(-1)?.eventHash ?? null;
    const events: ReviewAuditEvent[] = [];
    await this.before("audit");
    for (const type of this.eventFor(request.action, item.publications.at(-1)?.status === "PUBLISHED")) {
      const body = {
        eventId: randomUUID(), sequence: registry.audit.length + events.length + 1, type, actor, actorPolicyHash,
        candidateId: item.record.candidateId, scenarioId: item.record.candidate.draft.scenario.scenario_id,
        scenarioVersion: item.record.candidate.draft.scenario.version, contentHash: item.record.contentHash,
        before, after: item.lifecycle, at: this.now(), reviewId: item.review?.reviewId ?? null,
        approvalId: item.approval?.approvalId ?? null,
        publicationId: request.action === "publish" ? item.publications.at(-1)?.publicationId ?? null : null,
        reasonCode: type, validationVersion: item.validation.validationVersion, policyHash: item.validation.policyHash,
        previousEventHash: eventHash,
      };
      eventHash = await hashAuthoringData(body); events.push({ ...body, eventHash });
    }
    const body = {
      schemaVersion: 1 as const, sequence: registry.sequence + 1, operationId: request.operationId, requestHash,
      action: request.action, expectedSequence: registry.sequence, sourceCandidateId: request.candidateId,
      previousCommitHash: registry.headHash, actorPolicy: policy, item, audit: events,
    };
    const commit = ReviewCommitSchema.parse({ ...body, commitHash: await hashAuthoringData(body) });
    await verifyReviewItem(commit.item, this.safety);
    requireCondition(registry.bytes + Buffer.byteLength(JSON.stringify(commit, null, 2) + "\n") <= 64 * 1024 * 1024, "REVIEW_STORAGE_FAILED");
    try {
      await this.writeExclusive(join(this.directory, "commits", String(commit.sequence).padStart(8, "0") + ".json"), commit);
    } catch (error) {
      if (error instanceof AuthoringReviewError) throw error;
      throw new AuthoringReviewError(code(error) === "EEXIST" ? "REVIEW_CONFLICT" : "REVIEW_STORAGE_FAILED");
    }
    return { duplicate: false, sequence: commit.sequence, operationSequence: commit.sequence, item: commit.item };
  }

  private async apply(request: ReviewOperation, item: ReviewItem, actor: ActorStamp, registry: Registry) {
    switch (request.action) {
      case "adopt": return;
      case "revise":
        requireCondition(actor.actorId === item.author.actorId, "UNAUTHORIZED_ACTOR");
        return;
      case "submit": {
        requireCondition(item.lifecycle === "DRAFT" && item.review === null, item.review?.decision === "rejected" ? "REVISION_REQUIRED" : "INVALID_REVIEW_STATE");
        requireCondition(actor.actorId === item.author.actorId, "UNAUTHORIZED_ACTOR");
        await this.unchanged(item);
        const gate = await canSubmitForSafetyReview(item.record, request.evidence.validation, { safety: this.safety, lineage: this.lineage(item.record, registry) });
        requireCondition(gate.eligible, "VALIDATION_BLOCKED");
        item.validation = await this.validation(item.record, registry);
        await this.before("snapshot");
        const snapshot = {
          recordHash: await hashAuthoringData(item.record), contentHash: item.record.contentHash,
          validation: item.validation, submittedBy: actor, submittedAt: this.now(),
        };
        item.review = {
          reviewId: randomUUID(), snapshot, snapshotHash: await hashAuthoringData(snapshot),
          startedBy: null, reviewStartedAt: null, reviewCompletedAt: null, checklist: {}, warnings: [],
          decision: "pending", notes: "", decisionReason: "",
        };
        item.lifecycle = "SAFETY_REVIEW";
        return;
      }
      case "start": {
        const review = this.requireReview(item, actor, request.evidence.reviewId);
        requireCondition(!review.startedBy, "REVIEW_CONFLICT");
        review.startedBy = actor; review.reviewStartedAt = this.now(); return;
      }
      case "checklist": {
        const review = this.requireAssigned(item, actor, request.evidence.reviewId);
        requireCondition(Object.keys(request.evidence.items).length > 0, "CHECKLIST_INCOMPLETE");
        for (const [name, proposal] of Object.entries(request.evidence.items)) {
          if (!proposal) continue;
          const key = name as keyof typeof reviewChecklist;
          requireCondition(!(reviewChecklist[key].critical && proposal.decision === "NOT_APPLICABLE")
            && (proposal.decision === "PASS" || proposal.reason.trim().length >= 10), "CHECKLIST_INCOMPLETE");
          this.safeText(proposal.reason);
          review.checklist[key] = { ...proposal, actor, at: this.now(), contentHash: item.record.contentHash, reviewId: review.reviewId };
        }
        await this.before("checklist"); return;
      }
      case "warning": {
        const review = this.requireAssigned(item, actor, request.evidence.reviewId);
        const proposal = request.evidence.warning;
        requireCondition(review.snapshot.validation.findings.some((finding) => finding.severity === "WARNING"
          && warningIdentity(finding) === warningIdentity(proposal)), "WARNING_DECISION_REQUIRED");
        this.safeText(proposal.rationale);
        review.warnings = review.warnings.filter((warning) => warningIdentity(warning) !== warningIdentity(proposal));
        review.warnings.push({ ...proposal, actor, at: this.now(), contentHash: item.record.contentHash, reviewId: review.reviewId });
        await this.before("warning"); return;
      }
      case "approve": {
        const review = this.requireAssigned(item, actor, request.evidence.reviewId);
        await this.unchanged(item);
        const gate = await canSubmitForSafetyReview(item.record, review.snapshot.validation, { safety: this.safety, lineage: this.lineage(item.record, registry) });
        requireCondition(gate.eligible, gate.reasons.some((reason) => reason.startsWith("STALE")) ? "STALE_VALIDATION" : "VALIDATION_BLOCKED");
        requireCondition(checklistAllowsApproval(review.checklist), "CHECKLIST_INCOMPLETE");
        requireCondition(warningAllowsApproval(review), "WARNING_DECISION_REQUIRED");
        this.safeText(request.evidence.notes); this.safeText(request.evidence.decisionReason);
        await this.before("decision");
        review.notes = request.evidence.notes; review.decisionReason = request.evidence.decisionReason;
        review.decision = "approved"; review.reviewCompletedAt = this.now();
        const artifact = {
          approvalId: randomUUID(), status: "APPROVED" as const, runtimeEligible: false as const,
          candidateId: item.record.candidateId, contentHash: item.record.contentHash, snapshotHash: review.snapshotHash,
          validationVersion: review.snapshot.validation.validationVersion, policyHash: review.snapshot.validation.policyHash!,
          reviewId: review.reviewId, reviewer: actor, approvedAt: review.reviewCompletedAt,
          humanReview: {
            decision: "approved" as const, reviewerId: actor.actorId, reviewedAt: review.reviewCompletedAt,
            checklist: legacyApprovalChecklist(review.checklist),
            notes: [...review.notes.match(/[\s\S]{1,500}/gu) ?? [], ...review.decisionReason.match(/[\s\S]{1,500}/gu) ?? []],
          },
          record: structuredClone(item.record),
        };
        await this.before("approval-artifact");
        item.approval = { ...artifact, artifactHash: await hashAuthoringData(artifact) };
        item.lifecycle = "APPROVED"; return;
      }
      case "reject":
      case "request-changes": {
        const review = this.requireAssigned(item, actor, request.evidence.reviewId);
        requireCondition(request.evidence.failedItems.length + request.evidence.findingPaths.length > 0
          && request.evidence.failedItems.every((key) => ["FAIL", "NEEDS_REVISION"].includes(review.checklist[key]?.decision ?? ""))
          && request.evidence.findingPaths.every((path) => review.snapshot.validation.findings.some((finding) => finding.path === path)), "CHECKLIST_INCOMPLETE");
        this.safeText(request.evidence.reason);
        await this.before("decision");
        review.decision = "rejected"; review.reviewCompletedAt = this.now();
        review.decisionReason = request.evidence.reason; review.notes = request.evidence.reason;
        review.decisionDetails = {
          action: request.action, failedItems: [...request.evidence.failedItems], findingPaths: [...request.evidence.findingPaths],
        };
        item.lifecycle = "DRAFT"; return;
      }
      case "publish": {
        requireCondition(item.lifecycle === "APPROVED" && item.approval?.approvalId === request.evidence.approvalId, "INVALID_REVIEW_STATE");
        requireCondition(actor.actorId !== item.author.actorId && actor.actorId !== item.approval!.reviewer.actorId, "SELF_APPROVAL_BLOCKED");
        const compatibility = currentPublicationCompatibility(item.approval!, item.publicationHold !== null);
        const fresh = await this.validation(item.record, registry);
        const gate = await canSubmitForSafetyReview(item.record, item.review!.snapshot.validation, { safety: this.safety, lineage: this.lineage(item.record, registry) });
        const offline = request.evidence.target === "offline-adaptive";
        const reasons = offline ? compatibility.reasons.filter((reason) => reason === "PUBLICATION_HELD") : compatibility.reasons;
        if (!gate.eligible) reasons.push("VALIDATION_STALE");
        item.validation = fresh;
        requireCondition(item.publications.length < 32, "REVIEW_STORAGE_FAILED");
        const publicationId = randomUUID();
        const identity = { publicationId, approvalId: request.evidence.approvalId, actor, requestedAt: this.now() };
        await this.before("publish-manifest");
        if (offline && reasons.length === 0) {
          requireCondition(!item.publications.some((entry) => entry.status === "PUBLISHED"), "ALREADY_PUBLISHED");
          const result = await compileOfflineRelease(item.approval!, publicationId, this.safety);
          if ("release" in result) {
            item.publications.push({ ...identity, target: "offline-adaptive", status: "PUBLISHED",
              compatibilityVersion: "offline-adaptive-v1", reasons: [], release: result.release });
            return;
          }
          reasons.push(result.reason);
        }
        item.publications.push({
          ...identity, target: request.evidence.target, status: "PUBLICATION_BLOCKED",
          compatibilityVersion: offline ? "offline-adaptive-v1" : compatibility.compatibilityVersion, reasons: [...new Set(reasons)],
        });
        return;
      }
      case "hold":
        requireCondition(item.lifecycle === "APPROVED" && item.approval?.approvalId === request.evidence.approvalId, "INVALID_REVIEW_STATE");
        requireCondition(actor.actorId !== item.author.actorId && actor.actorId !== item.approval!.reviewer.actorId, "SELF_APPROVAL_BLOCKED");
        this.safeText(request.evidence.reason);
        item.publicationHold = { actor, at: this.now(), reason: request.evidence.reason }; return;
      default: throw stateError();
    }
  }

  private async revise(request: Extract<ReviewOperation, { action: "revise" }>, parent: ReviewItem, actor: ActorStamp, registry: Registry): Promise<ReviewItem> {
    const candidate = request.evidence.candidate;
    this.safeText(request.evidence.revisionReason);
    const oldScenario = parent.record.candidate.draft.scenario, nextScenario = candidate.draft.scenario;
    const oldVersion = oldScenario.version.split(".").map(Number), nextVersion = nextScenario.version.split(".").map(Number);
    const differing = oldVersion.findIndex((part, index) => part !== nextVersion[index]);
    requireCondition(nextScenario.scenario_id === oldScenario.scenario_id && differing >= 0
      && nextVersion[differing]! > oldVersion[differing]!, "VERSION_CONFLICT");
    await this.before("version-lookup");
    requireCondition(![...registry.items.values()].some((item) => item.record.candidate.draft.scenario.scenario_id === nextScenario.scenario_id
      && item.record.candidate.draft.scenario.version === nextScenario.version), "VERSION_CONFLICT");
    const saved = await this.draftStore.createRevision(parent.record, candidate);
    return {
      record: saved, author: actor, createdAt: this.now(), lifecycle: "DRAFT",
      revisionReason: request.evidence.revisionReason, validation: await this.validation(saved, registry),
      review: null, approval: null, publications: [], publicationHold: null,
    };
  }

  async status() {
    const registry = await this.read();
    return {
      sequence: registry.sequence, headHash: registry.headHash,
      candidates: [...registry.items.values()].map((item) => ({
        candidateId: item.record.candidateId, scenarioId: item.record.candidate.draft.scenario.scenario_id,
        version: item.record.candidate.draft.scenario.version, lifecycle: item.lifecycle,
        reviewDecision: item.review?.decision ?? null, approvalId: item.approval?.approvalId ?? null,
      })),
    };
  }

  /** Runtime reads the committed journal, never a draft cache or user-selected export. */
  async runtimeReleases(): Promise<RuntimeRelease[]> {
    const registry = await this.read();
    const releases: RuntimeRelease[] = [];
    for (const item of registry.items.values()) {
      const publication = item.publications.find((entry) => entry.status === "PUBLISHED");
      if (publication?.status !== "PUBLISHED" || item.publicationHold || !item.approval || !item.review) continue;
      const gate = await canSubmitForSafetyReview(item.record, item.review.snapshot.validation, {
        safety: this.safety, lineage: this.lineage(item.record, registry),
      });
      if (!gate.eligible) continue;
      const verified = await compileOfflineRelease(item.approval, publication.publicationId, this.safety);
      requireCondition("release" in verified && same(verified.release, publication.release), "REGISTRY_CORRUPT");
      releases.push(publication.release);
    }
    return releases;
  }
  async prepare(candidateId: string, action: ReviewAction, evidence: unknown) {
    try {
      const registry = await this.read();
      const item = registry.items.get(candidateId);
      const record = item?.record ?? await this.draftStore.load(candidateId);
      return {
        operationId: randomUUID(), expectedSequence: registry.sequence, candidateId,
        expectedContentHash: record.contentHash, expectedState: item?.lifecycle ?? "DRAFT", action, evidence,
      };
    } catch (error) {
      if (error instanceof AuthoringReviewError) throw error;
      if (error instanceof DraftAuthoringError) throw new AuthoringReviewError("VALIDATION_BLOCKED");
      throw new AuthoringReviewError("REVIEW_STORAGE_FAILED");
    }
  }
  async export(candidateId: string): Promise<ReviewExport> {
    const registry = await this.read();
    const item = registry.items.get(candidateId);
    requireCondition(item, "CANDIDATE_NOT_MANAGED");
    const current = item!;
    const sameScenario = [...registry.items.values()].filter((entry) =>
      entry.record.candidate.draft.scenario.scenario_id === current.record.candidate.draft.scenario.scenario_id);
    const history = sameScenario.map((entry) => ({
      candidateId: entry.record.candidateId, parentCandidateId: entry.record.previousCandidateId,
      scenarioVersion: entry.record.candidate.draft.scenario.version, contentHash: entry.record.contentHash,
      authorId: entry.author.actorId, revisionReason: entry.revisionReason, lifecycle: entry.lifecycle,
      reviewDecision: entry.review?.decision ?? null, approvalId: entry.approval?.approvalId ?? null,
      changedPaths: entry.record.previousCandidateId && registry.items.has(entry.record.previousCandidateId)
        ? reviewChangedPaths(registry.items.get(entry.record.previousCandidateId)!.record.candidate, entry.record.candidate) : [],
    }));
    const body = {
      kind: "LOCAL_REVIEW_EXPORT" as const, schemaVersion: 1 as const, exportedAt: this.now(),
      sequence: registry.sequence, headHash: registry.headHash, item: current, history,
      lineage: this.lineage(current.record, registry), audit: registry.audit,
    };
    const view = ReviewExportSchema.parse({ ...body, exportHash: await hashAuthoringData(body) });
    requireCondition(Buffer.byteLength(JSON.stringify(view, null, 2)) <= reviewJsonLimit, "REVIEW_STORAGE_FAILED");
    return view;
  }
}
