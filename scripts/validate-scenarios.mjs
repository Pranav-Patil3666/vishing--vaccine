import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { ScenarioDocumentSchema } from "@vaccine/scenario-schema";

const workspaceRoot = process.cwd();
const scenarioRoot = join(workspaceRoot, "content", "scenarios");
const files = await listJsonFiles(scenarioRoot);
if (files.length === 0) throw new Error("No scenario JSON files were found.");

for (const file of files) {
  const source = await readFile(file, "utf8");
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error(`Invalid JSON in ${relative(workspaceRoot, file)}.`);
  }
  const parsed = ScenarioDocumentSchema.safeParse(document);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Scenario validation failed for ${relative(workspaceRoot, file)} at: ${paths}`);
  }
  if (parsed.data.review_status === "approved") {
    throw new Error(`${relative(workspaceRoot, file)} is marked approved; Phase 1 content must remain draft until human review.`);
  }
  process.stdout.write(`PASS ${relative(workspaceRoot, file)} (${parsed.data.review_status})\n`);
}

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.isFile() && extname(entry.name).toLowerCase() === ".json" ? [path] : [];
  }));
  return nested.flat();
}
