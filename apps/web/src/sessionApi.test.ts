import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiServer } from "../../api/src/health.js";
import { scenarioById } from "./scenarioCatalog.js";
import { createApiClient, SessionApiError } from "./sessionApi.js";

test("web API client completes the disclosed mock session and authoring flow", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const api = createApiClient(`http://127.0.0.1:${address.port}`);
  const scenario = scenarioById("S-02");
  assert.ok(scenario);

  const created = await api.createDemoSession({ scenarioId: scenario.scenario_id, scenarioVersion: scenario.version, language: "pending-verification" });
  assert.equal(created.state, "CONSENT_REQUIRED");
  assert.equal(created.mode, "demo");
  assert.equal(created.recordingEnabled, false);
  assert.deepEqual(created.pressureTimeline, []);

  const consented = await api.grantConsent(created.sessionId);
  assert.equal(consented.consent.status, "granted");
  const turn = await api.submitMockTurn(created.sessionId, "I will pause and verify with the official number.", {
    callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1000, learnerSpeechStartedAtMs: 1450, learnerSpeechEndedAtMs: 2200,
  });
  assert.equal(turn.response.playable, false);
  assert.equal(turn.session.pressureTimeline.length, 1);
  assert.equal(turn.session.timelineEvents.length, 1);

  const stored = await api.getSession(created.sessionId);
  assert.equal(stored.sessionId, created.sessionId);
  assert.equal(stored.timelineEvents.length, 1);
  const ended = await api.endSession(created.sessionId);
  assert.equal(ended.state, "ENDED_BY_LEARNER");

  const draft = await api.generateMockDraft({ scenarioId: "S-90", learningObjective: "Practice independent verification.", redFlags: ["RF-01"], language: "hi-en" });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.runtimeEligible, false);
  assert.ok(draft.tacticPool.every((item) => item.status === "DRAFT"));
});

test("web API client reports contract failures without exposing payload content", async () => {
  const api = createApiClient("", async () => new Response(JSON.stringify({ secret: "raw body" }), { status: 200 }));
  await assert.rejects(api.createDemoSession({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "pending-verification" }),
    (error: unknown) => error instanceof SessionApiError && error.message.includes("shared contract") && !error.message.includes("raw body"));
});

for (const [code, status, stage] of [
  ["CREDIT_LIMIT_REACHED", 429, "TTS_CREDIT_GUARD"], ["RATE_LIMITED", 429, "CALLER_AUDIO_RESOLUTION"],
  ["TTS_PROVIDER_FAILED", 502, "TTS_PROVIDER"], ["TTS_PROVIDER_FAILED", 502, "TTS_CACHE"],
] as const) test(`caller client retains sanitized ${code} at ${stage}, regardless of HTTP status`, async () => {
  const technical = { stage, causeCode: code, providerAttempted: code === "TTS_PROVIDER_FAILED", cacheResult: "MISS" };
  const api = createApiClient("", async () => new Response(JSON.stringify({ error: { code, message: "PRIVATE provider payload", technical } }), { status }));
  await assert.rejects(api.getCallerAudio!("session", 1, "authority", new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof SessionApiError); assert.equal(error.code, code); assert.equal(error.technical?.stage, stage);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE|provider payload/u); return true;
  });
});

test("caller client labels network failure at the correct stage without retaining raw exception text", async () => {
  const api = createApiClient("", async () => { throw new Error("PRIVATE transport detail"); });
  await assert.rejects(api.getCallerAudio!("session", 1, "authority", new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof SessionApiError); assert.equal(error.technical?.causeCode, "NETWORK_ERROR");
    assert.equal(error.technical?.stage, "CALLER_AUDIO_RESOLUTION"); assert.doesNotMatch(error.message, /PRIVATE/u); return true;
  });
});
