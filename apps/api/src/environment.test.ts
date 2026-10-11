import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EnvironmentValidationError, parseServerEnvironment } from "./environment.js";
import { loadRootEnvironment, rootEnvironmentPath } from "./loadRootEnvironment.js";

test("environment defaults are safe and live Evon is disabled", () => {
  const environment = parseServerEnvironment({});
  assert.equal(environment.nodeEnvironment, "development");
  assert.equal(environment.liveEvonEnabled, false);
  assert.equal(environment.developmentCreditCap, 0);
  assert.equal(environment.publicDemoCreditCap, 0);
});

test("both independent flags are needed to enable live Evon", () => {
  const environment = parseServerEnvironment({ FEATURE_LIVE_EVON: "true", ENABLE_LIVE_EVON: "false" });
  assert.equal(environment.liveEvonEnabled, false);
});

test("invalid cap values fail without echoing a secret value", () => {
  assert.throws(
    () => parseServerEnvironment({ CREDIT_CAP: "not-a-number", SESSION_SIGNING_SECRET: "redacted" }),
    (error: unknown) => error instanceof EnvironmentValidationError
      && error.message.includes("CREDIT_CAP")
      && !error.message.includes("redacted"),
  );
});

test("unknown boolean syntax is rejected", () => {
  assert.throws(() => parseServerEnvironment({ ENABLE_LIVE_EVON: "enabled" }), EnvironmentValidationError);
});

test("server environment path resolves to the repository root from source or compiled API", () => {
  assert.equal(rootEnvironmentPath, fileURLToPath(new URL("../../../.env", import.meta.url)));
});

test("server env loader reads local configuration and preserves existing process overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vaccine-env-test-"));
  const key = "VACCINE_ENV_LOADER_TEST_ONLY";
  const previous = process.env[key];
  try {
    const path = join(directory, ".env");
    await writeFile(path, `${key}=offline-test-value\n`);
    delete process.env[key];
    loadRootEnvironment(path);
    assert.equal(process.env[key], "offline-test-value");
    process.env[key] = "existing-process-value";
    loadRootEnvironment(path);
    assert.equal(process.env[key], "existing-process-value");
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("server env loader tolerates a missing file and sanitizes other loading failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vaccine-env-test-"));
  try {
    assert.doesNotThrow(() => loadRootEnvironment(join(directory, "missing.env")));
    assert.throws(() => loadRootEnvironment(directory), { message: "Could not load the root server environment file." });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
