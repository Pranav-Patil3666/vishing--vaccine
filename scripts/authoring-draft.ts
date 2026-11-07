import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DraftAuthoringError, parseAuthoringCandidate, parseDraftJson, type SavedDraft } from "@vaccine/scenario-schema";
import { LocalDraftStore, readAuthorSelectedJson } from "../apps/api/src/authoring/draftStore.js";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const safety = JSON.parse(await readFile(new URL("../content/safety/review-reference-lists.json", import.meta.url), "utf8"));
const store = new LocalDraftStore(workspace, safety);

function summary(saved: SavedDraft) {
  const { candidate, ...metadata } = saved;
  return {
    ...metadata, title: candidate.details.title, scenarioId: candidate.draft.scenario.scenario_id,
    version: candidate.draft.scenario.version, status: candidate.draft.status,
    runtimeEligible: candidate.draft.runtimeEligible, path: store.pathFor(saved.candidateId),
    tactics: candidate.details.variants.length, examples: candidate.draft.behaviorTrainingExamples.length,
    debriefs: candidate.details.debriefs.length,
  };
}

async function main() {
  const [command, input, previous, ...extra] = process.argv.slice(2);
  if (extra.length || (previous && command !== "generate" && command !== "import")) throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  if (command === "list" && input === undefined) return (await store.list()).map(summary);
  if (command === "help" || command === undefined) {
    return "authoring:draft <generate brief.json | import candidate.json | list | show ID | export ID | validate candidate.json>\n"
      + "generate and import accept an optional previous candidate ID.";
  }
  if (!input) throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  switch (command) {
    case "generate": return summary(await store.generate(parseDraftJson((await readAuthorSelectedJson(input)).bytes), previous));
    case "import": return summary(await store.importFile(input, previous));
    case "show": return summary(await store.load(input));
    case "export": return (await store.load(input)).candidate;
    case "validate": {
      const candidate = parseAuthoringCandidate(parseDraftJson((await readAuthorSelectedJson(input)).bytes), safety);
      return { structuralValidation: "PASS", status: candidate.draft.status, runtimeEligible: candidate.draft.runtimeEligible };
    }
    default: throw new DraftAuthoringError("INVALID_DRAFT_PATH");
  }
}

try {
  const result = await main();
  process.stdout.write(typeof result === "string" ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const known = error instanceof DraftAuthoringError ? error : new DraftAuthoringError("DRAFT_STORAGE_FAILED");
  process.stderr.write(`${known.code}: ${known.message}\n`);
  process.exitCode = 1;
}
