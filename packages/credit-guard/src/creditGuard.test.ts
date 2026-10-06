import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCreditRequest, createCreditUsageEvent } from "./creditGuard.js";

const date = new Date("2026-10-06T00:00:00.000Z");

test("configured cap and reserve reject an over-cap billable request before calling a provider", () => {
  const decision = evaluateCreditRequest(
    { mode: "development", developmentCap: 10, publicDemoCap: 20, reserveCap: 2, usedUnits: 7 },
    { operation: "speech-recognition", estimatedUnits: 2, cacheAvailable: false },
    date,
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.usableCap, 8);
  assert.equal(decision.fallback, "demo-safe");
  assert.equal(decision.event.kind, "rejected");
});

test("cache is preferred over demo-safe fallback after a cap rejection", () => {
  const decision = evaluateCreditRequest(
    { mode: "public-demo", developmentCap: 10, publicDemoCap: 5, reserveCap: 0, usedUnits: 5 },
    { operation: "synthesis", estimatedUnits: 1, cacheAvailable: true, sessionId: "session-1" },
    date,
  );
  assert.equal(decision.fallback, "cache");
  assert.equal(decision.event.sessionId, "session-1");
});

test("request within configured budget is allowed and ledger event is provider neutral", () => {
  const decision = evaluateCreditRequest(
    { mode: "development", developmentCap: 10, publicDemoCap: 1, reserveCap: 2, usedUnits: 3 },
    { operation: "transcription", estimatedUnits: 1, cacheAvailable: false },
    date,
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.event.configuredUnits, 1);
  assert.equal(decision.event.kind, "projected");
});

test("ledger event can record a configured actual-use measurement", () => {
  const event = createCreditUsageEvent({ operation: "synthesis", kind: "used", configuredUnits: 0, occurredAt: date });
  assert.equal(event.kind, "used");
  assert.equal(event.configuredUnits, 0);
});

test("invalid configured cost values fail closed", () => {
  assert.throws(() => evaluateCreditRequest(
    { mode: "development", developmentCap: 1, publicDemoCap: 1, reserveCap: 0, usedUnits: 0 },
    { operation: "transcription", estimatedUnits: Number.NaN, cacheAvailable: false },
  ), /finite/);
});
