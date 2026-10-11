import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiServer } from "./health.js";

test("GET /health returns structured status without exposing configuration", async (context) => {
  const server = createApiServer({
    environment: "test",
    version: "0.1.0",
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    environment: "test",
    timestamp: "2026-10-06T00:00:00.000Z",
    version: "0.1.0",
  });
});

test("health version is omitted when unavailable and non-health paths are not exposed", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  const body = await health.json() as Record<string, unknown>;
  assert.equal("version" in body, false);
  const unknown = await fetch(`http://127.0.0.1:${address.port}/secret`);
  assert.equal(unknown.status, 404);
});

test("mock authoring endpoint returns a contract-validated draft only in development environments", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/authoring/mock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "S-90", learningObjective: "Practice independent verification.", redFlags: ["RF-01"], language: "hi-en" }),
  });
  assert.equal(response.status, 200);
  const draft = await response.json() as { status: string; runtimeEligible: boolean; scenario: { lifecycle_status: string }; tacticPool: Array<{ status: string }>; candidateApprovedResponses: Array<{ status: string }> };
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.runtimeEligible, false);
  assert.equal(draft.scenario.lifecycle_status, "DRAFT");
  assert.ok(draft.tacticPool.every((tactic) => tactic.status === "DRAFT"));
  assert.ok(draft.candidateApprovedResponses.every((candidate) => candidate.status === "DRAFT"));

  const productionServer = createApiServer({ environment: "production" });
  context.after(() => new Promise<void>((resolve, reject) => productionServer.close((error) => error ? reject(error) : resolve())));
  productionServer.listen(0, "127.0.0.1");
  await once(productionServer, "listening");
  const productionAddress = productionServer.address();
  assert.ok(productionAddress && typeof productionAddress !== "string");
  const productionResponse = await fetch(`http://127.0.0.1:${productionAddress.port}/api/authoring/mock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "S-90", learningObjective: "Practice independent verification.", redFlags: ["RF-01"], language: "hi-en" }),
  });
  assert.equal(productionResponse.status, 409);
});

test("mock turn API accepts development timing fixtures and exposes structured pressure events", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true }) });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { session: { sessionId: string } };
  const sessionId = createdBody.session.sessionId;
  const consent = await fetch(`${base}/api/sessions/${sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  assert.equal(consent.status, 200);
  const turn = await fetch(`${base}/api/sessions/${sessionId}/turn`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Um, I will pause and verify through the official channel.", timingFixture: { callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1_000, learnerSpeechStartedAtMs: 1_450, learnerSpeechEndedAtMs: 2_450 } }),
  });
  assert.equal(turn.status, 200);
  const result = await turn.json() as { learnerTurnEvent: { responseLatency: { valueMs: number } | null; fillerCount: number }; session: { scenarioRuntimeStatus: string; pressureTimeline: unknown[]; pressureDebrief: { pressureTimeline: unknown[] } } };
  assert.equal(result.learnerTurnEvent.responseLatency?.valueMs, 450);
  assert.equal(result.learnerTurnEvent.fillerCount, 1);
  assert.equal(result.session.scenarioRuntimeStatus, "DRAFT");
  assert.equal(result.session.pressureTimeline.length, 1);
  assert.equal(result.session.pressureDebrief.pressureTimeline.length, 1);
});

test("mock turn API rejects timing fixtures outside development and arbitrary caller response text", async (context) => {
  const server = createApiServer({ environment: "production" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true }) });
  const createdBody = await created.json() as { session: { sessionId: string } };
  const sessionId = createdBody.session.sessionId;
  await fetch(`${base}/api/sessions/${sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  const fixture = await fetch(`${base}/api/sessions/${sessionId}/turn`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", timingFixture: { learnerSpeechStartedAtMs: 1 } }),
  });
  assert.equal(fixture.status, 400);
  const arbitraryResponse = await fetch(`${base}/api/sessions/${sessionId}/turn`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello", callerResponseText: "arbitrary" }),
  });
  assert.equal(arbitraryResponse.status, 400);
});
