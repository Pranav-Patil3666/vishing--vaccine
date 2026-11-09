import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isScenarioRuntimeEligible, verifyReviewExport, type ScenarioSafetyOptions } from "@vaccine/scenario-schema";
import { draftFingerprint, LocalDraftStore } from "../apps/api/src/authoring/draftStore.js";
import { LocalReviewStore } from "../apps/api/src/authoring/reviewStore.js";
import { createApiServer } from "../apps/api/src/health.js";
import { RuntimeCatalog } from "../apps/api/src/runtimeCatalog.js";

const root = process.cwd();
const registryPath = "content/authoring/review-registry";
const manualPath = "content/authoring/examples/S-92-v0.1.1.candidate.json";
const exportPath = ".cache/authoring/S-92-v0.1.1-approved.workflow.json";
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const safety = await readJson("content/safety/review-reference-lists.json") as ScenarioSafetyOptions;

async function protectedWorkspace() {
  const prior = await readJson("docs/evidence/phase6d-runtime-isolation.json");
  const historical = await readJson("docs/evidence/phase6c-final-acceptance.json");
  const compare = async ({ path, expected }: { path: string; expected: string }) => {
    const actual = draftFingerprint(await readFile(path));
    assert.equal(actual, expected, path);
    return { path, expected, actual };
  };
  const originals = await Promise.all(prior.protected.originals.map(compare));
  const phase5 = await Promise.all(prior.protected.phase5.map(compare));
  const lines = await compare(prior.protected.lines);
  const drafts = new LocalDraftStore(root, safety);
  const reviews = new LocalReviewStore(root, safety);
  const registry = await reviews.status();
  assert.equal(registry.sequence, historical.registrySequence);
  assert.equal(registry.headHash, historical.headHash);
  const registered = await reviews.export(historical.approval.candidateId);
  const preview = await verifyReviewExport(await readJson(exportPath), safety);
  assert.deepEqual(preview.item, registered.item);
  assert.deepEqual(preview.audit, registered.audit);
  assert.deepEqual(preview.lineage, registered.lineage);
  assert.equal(preview.sequence, registry.sequence);
  assert.equal(preview.headHash, registry.headHash);
  assert.equal(preview.item.lifecycle, "APPROVED");
  assert.equal(preview.item.validation.status, "PASS");
  assert.deepEqual(preview.item.validation.summary, { errors: 0, warnings: 0, info: 1 });
  assert.equal(preview.item.approval?.runtimeEligible, false);
  assert.deepEqual(preview.item.approval, historical.approval);
  assert.deepEqual(preview.item.publications, [historical.publication]);
  assert.deepEqual(registered.audit, historical.audit);
  assert.deepEqual(await drafts.load(historical.approval.candidateId), historical.approval.record);
  const savedDrafts = await Promise.all(historical.protected.drafts.map(async ({ id, candidateId }: { id: string; candidateId: string }) => {
    const saved = await drafts.load(candidateId);
    assert.equal(saved.candidate.draft.scenario.scenario_id, id);
    assert.equal(saved.candidate.draft.scenario.lifecycle_status, "DRAFT");
    assert.equal(saved.candidate.draft.runtimeEligible, false);
    const report = await drafts.validateBytes(await readFile(drafts.pathFor(candidateId)));
    const graph = report.graph;
    if (id === "S-91") {
      assert.ok(graph?.complete);
      assert.deepEqual([graph.reachablePrefixes, graph.terminalLeaves, graph.maximumDepth], [25, 21, 2]);
    }
    return { id, candidateId, contentHash: saved.contentHash, lifecycle: "DRAFT", runtimeEligible: false,
      validation: report.status, findings: report.summary, graph };
  }));
  const catalog = new RuntimeCatalog(root);
  const playable = (await catalog.playable()).map(({ scenario_id, version }) => ({ id: scenario_id, version }));
  assert.deepEqual(playable, [{ id: "S-01", version: "0.2.0" }]);
  const legacy = [...catalog.legacyScenarios().values()].map((scenario) => ({
    id: scenario.scenario_id, lifecycle: scenario.lifecycle_status, runtimeEligible: isScenarioRuntimeEligible(scenario),
  }));
  assert.deepEqual(legacy, historical.protected.scenarios);
  const commits = await readdir(join(registryPath, "commits"));
  const mutablePaths = [...commits.sort().map((name) => join(registryPath, "commits", name)),
    join(registryPath, "actors.json"), manualPath, exportPath, drafts.pathFor(historical.approval.candidateId)];
  const currentFiles = await Promise.all(mutablePaths.map(async (path) => ({ path, sha256: draftFingerprint(await readFile(path)) })));
  return {
    originals, phase5, lines, currentFiles, registry, playable, legacy, savedDrafts,
    s92: { exportPath, exportHash: preview.exportHash, lifecycle: preview.item.lifecycle,
      approvalId: preview.item.approval!.approvalId, artifactHash: preview.item.approval!.artifactHash,
      reviewId: preview.item.review!.reviewId, contentHash: preview.item.record.contentHash, runtimeEligible: false,
      validation: preview.item.validation.status, findings: preview.item.validation.summary, publication: preview.item.publications[0] },
  };
}

const before = await protectedWorkspace();
const server = createApiServer({ environment: "test", runtimeWorkspace: root });
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const denied: Record<string, unknown> = {};
  for (const scenarioId of ["S-90", "S-91", "S-92", "S-93"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId, scenarioVersion: "0.1.1", language: "hi-en", demoMode: false }),
    });
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "SCENARIO_NOT_FOUND");
    denied[scenarioId] = { status: response.status, code: body.error.code };
  }
  console.log("PHASE6E " + JSON.stringify({ id: "REAL-CATALOG-DENIAL", denied }));
} finally {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

const suites = [
  "packages/scenario-schema/src/authoring.test.ts",
  "apps/web/src/authoringDraft.test.ts",
  "apps/web/src/phase6Authoring.test.tsx",
  "apps/web/src/phase6Validation.test.tsx",
  "apps/web/src/phase6Review.test.tsx",
  "apps/api/src/phase6Runtime.test.ts",
  "apps/api/src/phase6Acceptance.test.ts",
];
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...suites], {
  stdio: "inherit",
  env: { ...process.env, TSX_TSCONFIG_PATH: resolve("apps/web/tsconfig.app.json") },
});
const after = await protectedWorkspace();
assert.deepEqual(after, before);
console.log("PHASE6E " + JSON.stringify({ id: "WORKSPACE", beforeAfterEqual: true, ...after }));
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
