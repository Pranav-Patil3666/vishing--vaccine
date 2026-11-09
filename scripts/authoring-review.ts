import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AuthoringReviewError, parseDraftJson, ReviewOperationSchema, canonicalDraftJson,
  type ReviewAction,
} from "@vaccine/scenario-schema";
import { LocalDraftStore, readAuthorSelectedJson } from "../apps/api/src/authoring/draftStore.js";
import { LocalReviewStore } from "../apps/api/src/authoring/reviewStore.js";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const safety = JSON.parse(await readFile(new URL("../content/safety/review-reference-lists.json", import.meta.url), "utf8"));
const store = new LocalReviewStore(workspace, safety);
const drafts = new LocalDraftStore(workspace, safety);
const readJson = async (path: string) => parseDraftJson((await readAuthorSelectedJson(path)).bytes);
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function main() {
  const [command, candidateId, actionOrActor, file, ...extra] = process.argv.slice(2);
  if (extra.length) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
  if (command === "help" || command === undefined) return [
    "authoring:review init-local-demo",
    "authoring:review status",
    "authoring:review inspect <candidate-id>",
    "authoring:review export <candidate-id>",
    "authoring:review edit <candidate-id>",
    "authoring:review prepare <candidate-id> <action> [evidence.json]",
    "authoring:review apply <operation.json> <configured-actor-id>",
    "Use --silent with npm and redirect export/prepare output to UTF-8 JSON.",
    "Local OS demo actors are not authenticated enterprise identities.",
  ].join("\n");
  if (command === "init-local-demo" && !candidateId) {
    return store.configure(JSON.parse(await readFile(new URL("../content/authoring/examples/review-actors.example.json", import.meta.url), "utf8")));
  }
  if (command === "status" && !candidateId) return store.status();
  if (!candidateId) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
  if (command === "apply" && actionOrActor && !file) {
    const result = await store.transition(await readJson(candidateId), actionOrActor);
    return {
      duplicate: result.duplicate, sequence: result.sequence, operationSequence: result.operationSequence,
      candidateId: result.item.record.candidateId, lifecycle: result.item.lifecycle,
      reviewId: result.item.review?.reviewId ?? null, reviewDecision: result.item.review?.decision ?? null,
      approvalId: result.item.approval?.approvalId ?? null, publication: result.item.publications.at(-1) ?? null,
      persisted: true,
    };
  }
  if (command === "export" && !actionOrActor) return store.export(candidateId);
  if (command === "inspect" && !actionOrActor) {
    const view = await store.export(candidateId);
    return {
      sequence: view.sequence, candidateId, lifecycle: view.item.lifecycle,
      review: view.item.review, approvalId: view.item.approval?.approvalId ?? null,
      publications: view.item.publications, history: view.history, audit: view.audit,
    };
  }
  if (command === "edit" && !actionOrActor) {
    const view = await store.export(candidateId);
    return view.item.record.candidate;
  }
  if (command === "prepare" && actionOrActor) {
    const action = actionOrActor as ReviewAction;
    let evidence: unknown = file ? await readJson(file) : {};
    if (!file) {
      if (action === "adopt") evidence = { confirmed: true };
      else if (action === "submit") {
        const saved = await drafts.load(candidateId);
        evidence = { validation: await drafts.validateBytes(new TextEncoder().encode(canonicalDraftJson(saved))) };
      } else if (action === "start") evidence = { reviewId: (await store.export(candidateId)).item.review?.reviewId };
      else if (action === "publish") evidence = {
        approvalId: (await store.export(candidateId)).item.approval?.approvalId,
        confirmed: true, target: "current-real-conversation",
      };
    } else if (["checklist", "warning", "approve", "reject", "request-changes"].includes(action)) {
      const data = object(evidence);
      evidence = { ...data, reviewId: data.reviewId ?? (await store.export(candidateId)).item.review?.reviewId };
    }
    const request = await store.prepare(candidateId, action, evidence);
    const parsed = ReviewOperationSchema.safeParse(request);
    if (!parsed.success) throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
    return parsed.data;
  }
  throw new AuthoringReviewError("INVALID_REVIEW_REQUEST");
}

try {
  const result = await main();
  process.stdout.write(typeof result === "string" ? result + "\n" : JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const known = error instanceof AuthoringReviewError ? error : new AuthoringReviewError("REVIEW_STORAGE_FAILED");
  process.stderr.write(known.code + ": " + known.message + "\n");
  process.exitCode = 1;
}
