import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const skippedDirectories = new Set([".git", "node_modules", "coverage", ".next"]);
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".html", ".css", ".example", ".toml"]);
const highConfidencePatterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];
const credentialAssignmentPattern = /\b(GNANI_API_KEY(?:_ID)?|SESSION_SIGNING_SECRET|PUBLIC_DEMO_ACCESS_CODE)\s*[:=]\s*["']([^"']{24,})["']/g;
const failures = [];

const gitignorePath = join(root, ".gitignore");
const gitignore = await readFile(gitignorePath, "utf8").catch(() => "");
if (!/^\.env\s*$/m.test(gitignore)) failures.push(".env is not explicitly ignored by .gitignore");
if (execFileSync("git", ["ls-files", "--", ".env"], { cwd: root, encoding: "utf8" }).trim()) {
  failures.push(".env is tracked by Git; keep local server configuration untracked.");
}

const examplePath = join(root, ".env.example");
const example = await readFile(examplePath, "utf8").catch(() => "");
for (const line of example.split(/\r?\n/)) {
  const match = line.match(/^(GNANI_API_KEY(?:_ID)?|SESSION_SIGNING_SECRET|PUBLIC_DEMO_ACCESS_CODE)=(.*)$/);
  if (match?.[2]?.trim()) failures.push(`.env.example has a non-empty secret placeholder for ${match[1]}`);
}

await scanDirectory(root);

if (failures.length > 0) {
  process.stderr.write(`Secret scan failed (${failures.length} finding(s)):\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret scan passed: no high-confidence key patterns, non-empty secret examples, or web-bundle credential values found.\n");
}

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) await scanDirectory(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.toLowerCase().endsWith(".env.example") ? ".example" : entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (!scannedExtensions.has(extension)) continue;
    const content = await readFile(path, "utf8").catch(() => "");
    const filename = relative(root, path);
    for (const pattern of highConfidencePatterns) {
      if (pattern.test(content)) failures.push(`${filename} matches a high-confidence secret pattern`);
    }
    for (const match of content.matchAll(credentialAssignmentPattern)) {
      failures.push(`${filename} has a non-placeholder value assigned to ${match[1]}`);
    }
    if (filename.startsWith(`apps${process.platform === "win32" ? "\\" : "/"}web${process.platform === "win32" ? "\\" : "/"}`)) {
      if (/\bVITE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN)\s*=\s*["']?[^\s"']{8,}/i.test(content)) {
        failures.push(`${filename} contains a VITE_ variable that appears to expose a credential`);
      }
    }
  }
}
