import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiServer } from "./health.js";
import { InMemorySessionStore } from "./sessionStore.js";

test("mock session API requires consent and only serves the draft-safe fallback", async (context) => {
  const server = createApiServer({ environment: "test", now: () => new Date("2026-10-06T00:00:00.000Z") });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const create = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "S-02", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true }) });
  assert.equal(create.status, 201);
  const created = await create.json() as { session: { sessionId: string; state: string; recordingEnabled: boolean }; draftFallbackOnly: boolean };
  assert.equal(created.session.state, "CONSENT_REQUIRED");
  assert.equal(created.session.recordingEnabled, false);
  assert.equal(created.draftFallbackOnly, true);
  const preConsent = await fetch(`${base}/api/sessions/${created.session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "I will verify independently." }) });
  assert.equal(preConsent.status, 409);
  const consent = await fetch(`${base}/api/sessions/${created.session.sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  assert.equal(consent.status, 200);
  const emptyText = await fetch(`${base}/api/sessions/${created.session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "   " }) });
  assert.equal(emptyText.status, 400);
  const duplicate = await fetch(`${base}/api/sessions/${created.session.sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  assert.equal(duplicate.status, 409);
  const turn = await fetch(`${base}/api/sessions/${created.session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "I will verify this through the official channel." }) });
  assert.equal(turn.status, 200);
  const result = await turn.json() as { branch: { responseId: string; matched: boolean; reason: string }; transcript: { text: string }; session: { turnNumber: number; state: string; timelineEvents: Array<Record<string, unknown>> }; response: { cacheHit: boolean; playable: boolean }; debriefEvent: { callerTesting: string } };
  assert.equal(result.branch.responseId, "system.safe-fallback");
  assert.equal(result.branch.matched, false);
  assert.equal(result.branch.reason, "no_approved_tactic");
  assert.equal(result.transcript.text, "I will verify this through the official channel.");
  assert.equal(result.session.turnNumber, 1);
  assert.equal(result.session.state, "LISTENING");
  assert.equal(result.response.playable, false);
  assert.equal(result.response.cacheHit, false);
  assert.match(result.debriefEvent.callerTesting, /system-safe fallback/);
  assert.equal(result.session.timelineEvents.length, 1);
  assert.equal(result.session.timelineEvents[0]?.interruption && typeof result.session.timelineEvents[0].interruption, "object");
  assert.equal("transcriptText" in (result.session.timelineEvents[0] ?? {}), false);
  const repeat = await fetch(`${base}/api/sessions/${created.session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "I will verify this through the official channel." }) });
  const repeatedResult = await repeat.json() as { response: { cacheHit: boolean } };
  assert.equal(repeatedResult.response.cacheHit, true);
  const get = await fetch(`${base}/api/sessions/${created.session.sessionId}`);
  const stored = await get.json() as { session: Record<string, unknown>; debriefEvents: Array<Record<string, unknown>> };
  assert.equal("audio" in stored.session, false);
  assert.equal(stored.debriefEvents.length, 2);
  const timeline = stored.session.timelineEvents as Array<Record<string, unknown>>;
  assert.equal(timeline.length, 2);
  assert.equal(timeline.every((event) => !("rawAudio" in event) && !("transcriptText" in event)), true);
  const ended = await fetch(`${base}/api/sessions/${created.session.sessionId}/end`, { method: "POST" });
  const endResult = await ended.json() as { session: { state: string; recordingEnabled: boolean }; transientAudioCleared: boolean };
  assert.equal(endResult.session.state, "ENDED_BY_LEARNER");
  assert.equal(endResult.session.recordingEnabled, false);
  assert.equal(endResult.transientAudioCleared, true);
  const afterEndTurn = await fetch(`${base}/api/sessions/${created.session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "try again" }) });
  assert.equal(afterEndTurn.status, 409);
});

test("API errors are structured and do not leak configuration", async (context) => {
  const server = createApiServer({ environment: "test", version: "secret-test-marker" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions/missing`);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.match(body, /SESSION_NOT_FOUND/);
  assert.equal(body.includes("secret-test-marker"), false);
});

test("unknown and credential-like mock input falls back safely without storing transcript snippets", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "S-02", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true }) });
  const { session } = await created.json() as { session: { sessionId: string } };
  await fetch(`${base}/api/sessions/${session.sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  const turn = await fetch(`${base}/api/sessions/${session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "My OTP is 123456, unrelated thing" }) });
  const result = await turn.json() as { branch: { responseId: string }; transcript: { text: string }; debriefEvent: { evidenceSnippet?: string } };
  assert.equal(result.branch.responseId, "system.safe-fallback");
  assert.equal(result.transcript.text.includes("123456"), false);
  assert.equal(result.debriefEvent.evidenceSnippet, undefined);
});

test("session creation rate limit returns typed retry metadata", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/sessions`;
  const body = JSON.stringify({ scenarioId: "S-02", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true });
  let last: Response | undefined;
  for (let index = 0; index < 6; index += 1) last = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal(last?.status, 429);
  const payload = await last?.json() as { error?: { code?: string; retryAfterSeconds?: number } };
  assert.equal(payload.error?.code, "RATE_LIMITED");
  assert.ok((payload.error?.retryAfterSeconds ?? 0) > 0);
});

test("turn processing rate limit is enforced per remote address", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const created = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: "S-02", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true }) });
  const { session } = await created.json() as { session: { sessionId: string } };
  await fetch(`${base}/api/sessions/${session.sessionId}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentVersion: "training-consent-v1" }) });
  let last: Response | undefined;
  for (let index = 0; index < 13; index += 1) {
    last = await fetch(`${base}/api/sessions/${session.sessionId}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "unmatched learner response" }) });
  }
  assert.equal(last?.status, 429);
  const payload = await last?.json() as { error?: { code?: string; retryAfterSeconds?: number } };
  assert.equal(payload.error?.code, "RATE_LIMITED");
});

test("7A End cannot be overwritten by a typed turn already in flight", async (context) => {
  const store = new InMemorySessionStore();
  let entered!: () => void, release!: () => void;
  const enteredSynthesis = new Promise<void>((resolve) => { entered = resolve; });
  const pendingSynthesis = new Promise<void>((resolve) => { release = resolve; });
  const server = createApiServer({ environment: "test", sessionStore: store, synthesizer: { async synthesize() {
    entered(); await pendingSynthesis;
    return { bytes: new Uint8Array(), mediaType: "application/x-offline-test" };
  } } });
  context.after(() => {
    release();
    return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/sessions`;
  const post = (path: string, body: unknown) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const created = await post("", { scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", demoMode: false });
  assert.equal(created.status, 201);
  const { session: { sessionId } } = await created.json() as { session: { sessionId: string } };
  const path = "/" + sessionId;
  await post(path + "/consent", { consentVersion: "training-consent-v1" });
  const turn = post(path + "/turn", { text: "I need more time." });
  await enteredSynthesis;
  const endArrived = new Promise<void>((resolve) => {
    server.on("request", (request) => {
      if (request.url?.endsWith("/end")) request.once("end", () => setImmediate(resolve));
    });
  });
  const end = post(path + "/end", {});
  await endArrived;
  assert.equal(store.get(sessionId).state, "GENERATING_RESPONSE");
  const late = await post(path + "/turn", { text: "I need more time." });
  assert.equal(late.status, 409);
  release();
  assert.equal((await turn).status, 200);
  assert.equal((await end).status, 200);
  assert.equal(store.get(sessionId).state, "ENDED_BY_LEARNER");
  assert.equal(store.get(sessionId).recordingEnabled, false);
  assert.equal(store.get(sessionId).timelineEvents.length, 1);
  assert.equal((await post(path + "/turn", { text: "try again" })).status, 409);
});
