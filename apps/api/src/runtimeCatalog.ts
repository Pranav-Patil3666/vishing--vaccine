import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ApprovedScenarioPackageSchema, isScenarioRuntimeEligible, validateScenarioDocument, validateScenarioForRelease,
  validateScenarioSafety, type ScenarioDocument, type ScenarioSafetyOptions,
} from "@vaccine/scenario-schema";
import { LocalReviewStore } from "./authoring/reviewStore.js";
import { ApplicationError } from "./errors.js";

const legacy = {
  "content/scenarios/S-01-urgent-account-verification.json": "0f589bbba4987d6e1d9f28f79ae3b38a8cb99fdb3babaf83390865366b3fb686",
  "content/authoring/S-01-hi-IN.package.json": "aea62488777054921bbd3527fe1f2366e02d81d2ee0a6c0990c6e4163a8c3e46",
  "content/scenarios/S-02-insurance-refund-trap.json": "77a042e097f54260270446d090d213de464191af4693551a5e079e8db3636051",
  "content/scenarios/S-03-telecom-kyc-lockout.json": "9f756fd605aa791c8c6ff01083685ee8220cdcc1cae260ba7d51bee18d516b38",
} as const;
const [scenarioPath, approvalPath, ...fallbackPaths] = Object.keys(legacy) as (keyof typeof legacy)[];
const unavailable = () => new ApplicationError("INVALID_SCENARIO", "Trusted runtime content is unavailable or has changed.");

function readBounded(root: string, path: string, expectedHash?: string): unknown {
  const segments = path.split("/");
  let target = root;
  for (const segment of segments.slice(0, -1)) {
    target = join(target, segment);
    const directory = lstatSync(target);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw unavailable();
  }
  target = join(target, segments.at(-1)!);
  const stat = lstatSync(target);
  const maximum = 256 * 1024;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw unavailable();
  const file = openSync(target, "r");
  try {
    const opened = fstatSync(file);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > maximum) throw unavailable();
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const count = readSync(file, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    const content = bytes.subarray(0, size);
    if (size > maximum || (expectedHash && createHash("sha256").update(content).digest("hex") !== expectedHash)) throw unavailable();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } finally { closeSync(file); }
}

export class RuntimeCatalog {
  constructor(private readonly workspace: string) {}

  private safety(): ScenarioSafetyOptions {
    return readBounded(this.workspace, "content/safety/review-reference-lists.json") as ScenarioSafetyOptions;
  }

  legacyRelease() {
    try {
      const scenario = validateScenarioForRelease(readBounded(this.workspace, scenarioPath!, legacy[scenarioPath!]));
      const approval = ApprovedScenarioPackageSchema.parse(readBounded(this.workspace, approvalPath!, legacy[approvalPath!]));
      if (!isDeepStrictEqual(approval.scenario, scenario) || !validateScenarioSafety(scenario, this.safety()).passed) throw unavailable();
      return { scenario, templates: approval.debriefTemplateVariants, packageHash: legacy[approvalPath!] };
    } catch { throw unavailable(); }
  }

  legacyScenarios(): Map<string, ScenarioDocument> {
    const records = new Map<string, ScenarioDocument>();
    try { const { scenario } = this.legacyRelease(); records.set(scenario.scenario_id, scenario); } catch { /* unavailable */ }
    for (const path of fallbackPaths) {
      try {
        const scenario = validateScenarioDocument(readBounded(this.workspace, path, legacy[path]));
        if (!isScenarioRuntimeEligible(scenario)) records.set(scenario.scenario_id, scenario);
      } catch { /* unavailable */ }
    }
    return records;
  }

  async published() {
    try { return await new LocalReviewStore(this.workspace, this.safety()).runtimeReleases(); }
    catch { throw unavailable(); }
  }

  async playable() {
    const catalog = [...this.legacyScenarios().values()].filter(isScenarioRuntimeEligible);
    try { catalog.push(...(await this.published()).map((release) => release.scenario)); }
    catch { /* Leave only verified legacy content available. */ }
    return catalog.sort((left, right) => left.scenario_id.localeCompare(right.scenario_id)
      || left.version.localeCompare(right.version, "en", { numeric: true }));
  }
}
