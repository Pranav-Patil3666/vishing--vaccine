import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { createApiServer } from "../../../api/src/health.js";
import { createApiClient } from "../sessionApi.js";
import { BrowserAudioSummarySchema } from "@vaccine/contracts";

const clock = "00000000-0000-4000-8000-000000000001";
async function setup(context: TestContext, environment = "test") {
  const server = createApiServer({ environment }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`, api = createApiClient(base);
  const session = await api.createDemoSession({ scenarioId: "S-02", scenarioVersion: "0.1.0-draft", language: "pending-verification" });
  const path = `${base}/api/sessions/${session.sessionId}/audio/`;
  const start = () => fetch(`${path}start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioClockId: clock, turnNumber: 1 }) });
  return { api, session, path, start };
}
test("audio ingress requires consent, session state and a private development window", async (context) => {
  const h = await setup(context); assert.equal((await h.start()).status, 409);
  await h.api.grantConsent(h.session.sessionId);
  const response = await h.start(); assert.equal(response.status, 200);
  assert.equal((await h.start()).status, 429);
  const { token } = await response.json() as { token: string };
  const badToken = await fetch(`${h.path}frame`, { method: "POST", headers: { "x-audio-token": clock }, body: new Uint8Array(1024) });
  assert.equal(badToken.status, 409);
  await h.api.endSession(h.session.sessionId);
  const ended = await fetch(`${h.path}frame`, { method: "POST", headers: { "x-audio-token": token }, body: new Uint8Array(1024) });
  assert.equal(ended.status, 409);
});
test("safe PCM forwarding reaches backend counts and facts without retaining audio or transcript", async (context) => {
  const h = await setup(context); await h.api.grantConsent(h.session.sessionId);
  const forwarder = h.api.createAudioForwarder(h.session.sessionId, () => assert.fail("unexpected audio error"));
  await forwarder.open(clock, 1);
  const bytes = new Uint8Array(1024).fill(1);
  forwarder.frame(bytes, { sessionId: h.session.sessionId, turnNumber: 1, audioClockId: clock, sequence: 0, producedAtMonotonicMs: 32,
    sampleRateHz: 16000, channels: 1, encoding: "PCM_S16LE", byteLength: 1024, paddedSamples: 0 });
  const result = await forwarder.finish({ sessionId: h.session.sessionId, turnNumber: 1, audioClockId: clock, timingValid: true, events: [] });
  assert.equal(result.frameCount, 1); assert.equal(result.receivedBytes, 1024); assert.ok(bytes.every((value) => value === 0));
  assert.equal(BrowserAudioSummarySchema.safeParse(result).success, true);
  const stored = await h.api.getSession(h.session.sessionId); assert.equal(stored.timelineEvents.length, 0);
  assert.equal(JSON.stringify(stored).includes('"audio"'), false); assert.equal(JSON.stringify(result).includes('"bytes"'), false);
});
test("ingress rejects malformed frames, wrong sequence, cross-origin requests and mismatched facts", async (context) => {
  const h = await setup(context); await h.api.grantConsent(h.session.sessionId);
  const origin = await fetch(`${h.path}start`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ audioClockId: clock, turnNumber: 1 }) });
  assert.equal(origin.status, 400);
  const rebound = await fetch(`${h.path}start`, { method: "POST", headers: { host: "attacker.invalid", origin: "http://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ audioClockId: clock, turnNumber: 1 }) });
  assert.equal(rebound.status, 400);
  const { token } = await (await h.start()).json() as { token: string };
  const headers = { "content-type": "application/octet-stream", "x-audio-token": token, "x-audio-sequence": "0", "x-audio-produced-at": "32" };
  for (const length of [3, 1023, 1025]) assert.equal((await fetch(`${h.path}frame`, { method: "POST", headers, body: new Uint8Array(length) })).status, 400);
  assert.equal((await fetch(`${h.path}frame`, { method: "POST", headers: { ...headers, "x-audio-sequence": "1" }, body: new Uint8Array(1024) })).status, 400);
  const wrong = await fetch(`${h.path}finish`, { method: "POST", headers: { "content-type": "application/json", "x-audio-token": token },
    body: JSON.stringify({ sessionId: h.session.sessionId, turnNumber: 1, audioClockId: "00000000-0000-4000-8000-000000000002", timingValid: true, events: [] }) });
  assert.equal(wrong.status, 400);
});
test("audio ingress is unavailable in production even with session consent", async (context) => {
  const h = await setup(context, "production"); await h.api.grantConsent(h.session.sessionId);
  assert.equal((await h.start()).status, 409);
});
