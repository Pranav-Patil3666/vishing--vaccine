import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentValidationError, parseServerEnvironment } from "./environment.js";

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
