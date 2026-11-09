import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  benefitsTemplate, canonicalDraftJson, DeterministicMockScenarioGenerator, draftJsonFilename, draftJsonLimit, DraftAuthoringError,
  offlineAdaptiveMockGeneratorVersion, parseAuthoringCandidate, parseDraftJson, parseMockDraftBrief, parseSavedDraft,
  validateAuthoringDraft,
  type AuthoringCandidate, type SavedDraft, type ScenarioSafetyOptions,
} from "@vaccine/scenario-schema";
import { OfflineAdaptiveMockGenerator } from "./offlineAdaptiveMockGenerator.js";

const savedId = /^(?:mock|import)-[0-9a-f]{64}$/u;
export const draftFingerprint = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function assertCandidateId(candidateId: string) {
  if (!savedId.test(candidateId)) throw new DraftAuthoringError("INVALID_DRAFT_PATH");
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

async function readRegularJson(path: string): Promise<Uint8Array> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  if (before.size > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
  const file = await open(path, "r");
  try {
    const current = await file.stat();
    if (!current.isFile() || current.ino !== before.ino || current.dev !== before.dev) {
      throw new DraftAuthoringError("INVALID_DRAFT_PATH");
    }
    const buffer = Buffer.alloc(draftJsonLimit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

export async function readAuthorSelectedJson(inputPath: string) {
  const originalFilename = basename(inputPath);
  // Local file selection can be absolute. Device, network, alternate streams and symlink inputs are excluded.
  const localPath = resolve(inputPath);
  if (inputPath.split(/[\\/]/u).includes("..") || /^[\\/]{2}/u.test(localPath) || /^[\\/]{2}/u.test(inputPath)
    || localPath.replace(/^[a-z]:/iu, "").includes(":")
    || extname(originalFilename).toLowerCase() !== ".json" || !draftJsonFilename.test(originalFilename)) {
    throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  }
  try {
    const bytes = await readRegularJson(localPath);
    return { originalFilename, bytes };
  } catch (error) {
    if (error instanceof DraftAuthoringError) throw error;
    throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  }
}

export class LocalDraftStore {
  private readonly cache: string;
  private readonly directory: string;

  constructor(workspace: string, private readonly safety: ScenarioSafetyOptions) {
    this.cache = resolve(workspace, ".cache");
    this.directory = join(this.cache, "authoring");
  }

  pathFor(candidateId: string) {
    assertCandidateId(candidateId);
    return join(this.directory, `${candidateId}.json`);
  }

  private async checkDirectories(create: boolean) {
    for (const path of [this.cache, this.directory]) {
      if (create) await mkdir(path).catch((error: unknown) => {
        if (errorCode(error) !== "EEXIST") throw error;
      });
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DraftAuthoringError("INVALID_DRAFT_PATH");
    }
  }

  async generate(briefValue: unknown, previousCandidateId: string | null = null) {
    const brief = parseMockDraftBrief(briefValue);
    const generator = brief.runtimeProfile === "offline-adaptive-v1"
      ? new OfflineAdaptiveMockGenerator() : new DeterministicMockScenarioGenerator();
    const candidate = generator.generateDraft(brief);
    const generatorVersion = brief.runtimeProfile === "offline-adaptive-v1"
      ? offlineAdaptiveMockGeneratorVersion : benefitsTemplate.generatorVersion;
    return this.save(candidate, {
      source: "DETERMINISTIC_MOCK", templateFamily: benefitsTemplate.family, templateVersion: benefitsTemplate.version,
      generatorVersion, briefFingerprint: draftFingerprint(canonicalDraftJson(brief)),
    }, previousCandidateId);
  }

  async importFile(inputPath: string, previousCandidateId: string | null = null) {
    const { bytes, originalFilename } = await readAuthorSelectedJson(inputPath);
    const candidate = parseAuthoringCandidate(parseDraftJson(bytes), this.safety);
    return this.save(candidate, {
      source: "MANUAL_IMPORT", originalFilename, sourceFingerprint: draftFingerprint(bytes),
      declaredOrigin: candidate.declaredOrigin ?? null, verification: "UNVERIFIED",
    }, previousCandidateId);
  }

  async createRevision(parent: SavedDraft, input: unknown) {
    const candidate = parseAuthoringCandidate(input, this.safety);
    const prior = await this.load(parent.candidateId);
    if (canonicalDraftJson(prior) !== canonicalDraftJson(parent)
      || candidate.draft.scenario.scenario_id !== prior.candidate.draft.scenario.scenario_id
      || candidate.draft.scenario.version === prior.candidate.draft.scenario.version) {
      throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", "previousCandidateId");
    }
    try {
      return await this.save(candidate, {
        source: "MANUAL_IMPORT", originalFilename: "revision.json",
        sourceFingerprint: draftFingerprint(canonicalDraftJson(input)),
        declaredOrigin: candidate.declaredOrigin ?? null, verification: "UNVERIFIED",
      }, parent.candidateId);
    } catch (error) {
      if (!(error instanceof DraftAuthoringError) || error.code !== "CANDIDATE_ALREADY_EXISTS") throw error;
      const existing = await this.load(`import-${draftFingerprint(canonicalDraftJson(candidate))}`);
      if (existing.previousCandidateId !== parent.candidateId || canonicalDraftJson(existing.candidate) !== canonicalDraftJson(candidate)) throw error;
      return existing;
    }
  }

  private async save(input: AuthoringCandidate, provenance: SavedDraft["provenance"], previousCandidateId: string | null) {
    const candidate = parseAuthoringCandidate(input, this.safety);
    if (previousCandidateId !== null) {
      const previous = await this.load(previousCandidateId);
      const { scenario } = candidate.draft;
      const prior = previous.candidate.draft.scenario;
      if (scenario.scenario_id !== prior.scenario_id || scenario.version === prior.version) {
        throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", "previousCandidateId");
      }
    }
    const contentHash = draftFingerprint(canonicalDraftJson(candidate));
    const candidateId = `${provenance.source === "DETERMINISTIC_MOCK" ? "mock" : "import"}-${contentHash}`;
    const saved: SavedDraft = {
      candidateId, createdAt: new Date().toISOString(), contentHash, previousCandidateId,
      structuralValidation: "PASS", provenance, candidate,
    };
    const serialized = `${JSON.stringify(saved, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > draftJsonLimit) throw new DraftAuthoringError("IMPORT_TOO_LARGE");
    const destination = this.pathFor(candidateId);
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    let staged = false;
    try {
      await this.checkDirectories(true);
      const file = await open(temporary, "wx", 0o600);
      staged = true;
      try {
        await file.writeFile(serialized, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      // An exclusive hard link publishes the fully written file without replacing a concurrent winner.
      await link(temporary, destination);
    } catch (error) {
      if (error instanceof DraftAuthoringError) throw error;
      if (errorCode(error) === "EEXIST") throw new DraftAuthoringError("CANDIDATE_ALREADY_EXISTS");
      throw new DraftAuthoringError("DRAFT_STORAGE_FAILED");
    } finally {
      if (staged) await unlink(temporary).catch(() => undefined);
    }
    return saved;
  }

  async load(candidateId: string): Promise<SavedDraft> {
    const file = this.pathFor(candidateId);
    try {
      await this.checkDirectories(false);
      const saved = parseSavedDraft(parseDraftJson(await readRegularJson(file)), this.safety);
      if (saved.candidateId !== candidateId || saved.contentHash !== draftFingerprint(canonicalDraftJson(saved.candidate))) {
        throw new DraftAuthoringError("INVALID_CANDIDATE_REFERENCE", "contentHash");
      }
      return saved;
    } catch (error) {
      if (error instanceof DraftAuthoringError) throw error;
      throw new DraftAuthoringError("DRAFT_STORAGE_FAILED");
    }
  }

  async validateBytes(bytes: Uint8Array) {
    let input: unknown;
    try { input = parseDraftJson(bytes); }
    catch { return validateAuthoringDraft(bytes, { safety: this.safety }); }
    const lineage: SavedDraft[] = [];
    const seen = new Set<string>();
    let previous = input && typeof input === "object" && "previousCandidateId" in input ? input.previousCandidateId : null;
    while (typeof previous === "string" && !seen.has(previous) && seen.size < 32) {
      seen.add(previous);
      try {
        const ancestor = await this.load(previous);
        lineage.push(ancestor);
        previous = ancestor.previousCandidateId;
      } catch { break; }
    }
    return validateAuthoringDraft(input, { safety: this.safety, lineage });
  }

  async list() {
    try {
      await this.checkDirectories(false);
      const entries = await readdir(this.directory, { withFileTypes: true });
      const ids = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -5)).filter((id) => savedId.test(id)).sort();
      const result: SavedDraft[] = [];
      for (const id of ids) result.push(await this.load(id));
      return result;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      if (error instanceof DraftAuthoringError) throw error;
      throw new DraftAuthoringError("DRAFT_STORAGE_FAILED");
    }
  }
}
