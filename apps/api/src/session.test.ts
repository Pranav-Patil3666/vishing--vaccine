import assert from "node:assert/strict";
import test from "node:test";
import { createSessionState, transitionConsent } from "./session.js";

test("session state begins without consent and contains no audio field", () => {
  const state = createSessionState({
    sessionId: "session-1",
    scenarioId: "S-01",
    scenarioVersion: "0.1.0",
    language: "pending-verification",
    startingNodeId: "start",
  });
  assert.equal(state.consent.status, "not-requested");
  assert.equal(state.mode, "demo");
  assert.equal("audio" in state, false);
});

test("consent must be granted before it can be withdrawn", () => {
  const state = createSessionState({
    sessionId: "session-1",
    scenarioId: "S-01",
    scenarioVersion: "0.1.0",
    language: "pending-verification",
    startingNodeId: "start",
  });
  assert.throws(() => transitionConsent(state, "withdrawn", new Date()), /not allowed/);
  const granted = transitionConsent(state, "granted", new Date("2026-10-06T00:00:00.000Z"));
  assert.equal(granted.consent.status, "granted");
  assert.equal(transitionConsent(granted, "withdrawn", new Date()).consent.status, "withdrawn");
});
