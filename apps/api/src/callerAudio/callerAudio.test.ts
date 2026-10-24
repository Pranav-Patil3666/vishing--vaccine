import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { CallerAudioAssetSchema } from "@vaccine/contracts";
import { ApprovedCallerCatalog } from "./catalog.js";
import { FileCallerAudioCache } from "./cache.js";
import { CallerAudioService, callerAudioKey } from "./service.js";
import { toSpeechSynthesisRequest } from "../adaptivePolicy.js";
import { TimbreSpeechSynthesizer } from "../providers/timbre/timbreSpeechSynthesizer.js";
import { TIMBRE_PROFILE, readTimbreRuntimeConfig } from "../providers/timbre/runtimeConfig.js";
import { callerWavFixture } from "../testing/callerWavFixture.js";
import { createApiServer } from "../health.js";
import { InMemorySessionStore } from "../sessionStore.js";
import { RuntimeCreditLedger } from "../runtimeCredit.js";
import { ApplicationError } from "../errors.js";

const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
function catalog(value = scenario) { return new ApprovedCallerCatalog(new Map([[value.scenario_id, value]]), TIMBRE_PROFILE.voice); }
const ref = () => toSpeechSynthesisRequest(catalog().resolveId("S-01", "0.2.0", "system.opening"));
const credits = (cap = 4) => new RuntimeCreditLedger({ mode: "development", developmentCap: cap, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 }, { stt: 1, tts: 1 }, 0, () => new Date("2026-10-20T00:00:00Z"));
async function directory(context: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "caller-audio-offline-")); context.after(() => rm(path, { recursive: true, force: true })); return path;
}
test("documented config is opt-in and absent config never prevents mock startup", () => {
  for (const input of [{}, { TIMBRE_RUNTIME_ENABLED: "true" }, { GNANI_API_KEY: "offline-test", TTS_COST_UNITS: "1" }]) assert.equal(readTimbreRuntimeConfig(input), undefined);
  assert.ok(readTimbreRuntimeConfig({ TIMBRE_RUNTIME_ENABLED: "true", GNANI_API_KEY: "offline-test", TTS_COST_UNITS: "1" }));
});
for (const id of Object.keys(scenario.responses)) test(`catalog resolves approved canonical caller content ${id}`, () => {
  const resolved = catalog().resolveId("S-01", "0.2.0", id);
  assert.equal(resolved.text, scenario.responses[id]!.text); assert.equal(resolved.voice, "Nalini");
  assert.equal(scenario.voice_id, "mock-only"); assert.equal(catalog().resolve(toSpeechSynthesisRequest(resolved)).text, resolved.text);
});
for (const kind of ["draft", "review", "language", "version", "scenario", "response", "unreviewed", "forged reference"] as const) test(`approved-content gate rejects ${kind}`, () => {
  const copy = structuredClone(scenario);
  if (kind === "draft") copy.lifecycle_status = "DRAFT";
  if (kind === "review") copy.review_status = "in_review";
  if (kind === "language") copy.language = "mr-IN";
  if (kind === "unreviewed") copy.responses["system.opening"]!.safety_status = "draft";
  const resolver = catalog(copy);
  assert.throws(() => kind === "forged reference" ? resolver.resolve({ ...ref(), voice: "forged-voice" })
    : resolver.resolveId(kind === "scenario" ? "S-02" : "S-01", kind === "version" ? "stale" : "0.2.0", kind === "response" ? "unknown" : "system.opening"));
});
test("adapter sends only server-resolved approved text and returns finalized observed streaming WAV", async () => {
  let calls = 0;
  const bytes = Buffer.from(callerWavFixture()); bytes.writeUInt32LE(0xffffffff, 4); bytes.writeUInt32LE(0xffffffff, 40);
  const adapter = new TimbreSpeechSynthesizer(catalog(), { apiKey: "offline-credential" }, async (url, init) => {
    calls++; assert.equal(url, "https://api.vachana.ai/api/v1/tts/inference"); assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)); assert.equal(body.text, scenario.responses["system.opening"]!.text.normalize("NFKC"));
    assert.equal(body.model, "timbre-v2.5"); assert.equal(body.voice, "Nalini"); assert.equal(body.language, "hi-IN");
    assert.deepEqual(body.audio_config, TIMBRE_PROFILE.audioConfig);
    return new Response(bytes, { headers: { "content-type": "audio/wav" } });
  });
  const result = await adapter.synthesize(ref()); assert.equal(calls, 1); assert.equal(result.durationMs, 10);
  assert.equal(Buffer.from(result.bytes).readUInt32LE(4), 996); assert.equal(result.mediaType, "audio/wav");
});
for (const kind of ["missing auth", "provider error", "wrong media", "zero bytes", "malformed WAV", "network", "cancel", "timeout"] as const) test(`adapter sanitizes ${kind} with no retry`, async () => {
  let calls = 0;
  const abort = new AbortController(); if (kind === "cancel") abort.abort();
  const adapter = new TimbreSpeechSynthesizer(catalog(), { apiKey: kind === "missing auth" ? "" : "offline-credential" }, async (_url, init) => {
    calls++;
    if (kind === "network") throw new Error("raw provider payload must not escape");
    if (kind === "timeout") return await new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture timeout")), 30);
      init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("timeout")); }, { once: true });
    });
    return new Response(kind === "zero bytes" ? new Uint8Array() : kind === "malformed WAV" ? new Uint8Array([1, 2, 3]) : callerWavFixture(), {
      status: kind === "provider error" ? 403 : 200, headers: { "content-type": kind === "wrong media" ? "application/json" : "audio/wav" } });
  }, 5);
  await assert.rejects(adapter.synthesize(ref(), { signal: abort.signal }), (error: unknown) => {
    assert.doesNotMatch(String(error), /offline-credential|raw provider payload/u); return true;
  });
  assert.equal(calls, ["missing auth", "cancel"].includes(kind) ? 0 : 1);
});
test("cache key depends on exact normalized synthesis inputs, not session or response alias", () => {
  const approved = catalog().resolveId("S-01", "0.2.0", "system.opening"), base = callerAudioKey(approved, TIMBRE_PROFILE);
  assert.equal(base, callerAudioKey({ ...approved, responseId: "another-reference-same-text" }, TIMBRE_PROFILE));
  assert.equal(base, callerAudioKey({ ...approved }, { ...TIMBRE_PROFILE }));
  for (const change of [{ model: "other" }, { provider: "other" }, { voice: "other" }, { language: "other" }, { speed: 0.9 }, { audioConfig: { ...TIMBRE_PROFILE.audioConfig, sample_rate: 24000 } }]) {
    assert.notEqual(base, callerAudioKey(approved, { ...TIMBRE_PROFILE, ...change }));
  }
  assert.notEqual(base, callerAudioKey({ ...approved, text: "Different reviewed text" }, TIMBRE_PROFILE));
});
test("cache MISS reserves/calls once, concurrent requests share it, HIT makes zero provider calls", async (context) => {
  const cache = new FileCallerAudioCache(await directory(context)); let calls = 0, reserves = 0;
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, cache, { async synthesize() { calls++; return { bytes: callerWavFixture(), mediaType: "audio/wav" }; } }, () => { reserves++; });
  const get = () => service.get("S-01", "0.2.0", "system.opening", "offline-session", new AbortController().signal);
  const [first, simultaneous] = await Promise.all([get(), get()]); assert.equal(first.cacheHit, false); assert.equal(simultaneous.cacheKey, first.cacheKey);
  const second = await get(); assert.equal(second.cacheHit, true); assert.equal(second.providerAttempts, 0); assert.equal(second.synthesisMs, null);
  assert.deepEqual(second.bytes, first.bytes); assert.equal(calls, 1); assert.equal(reserves, 1);
});

test("Timbre validates locally before requesting credit: missing config consumes zero units", async (context) => {
  const ledger = credits(); let attempts = 0;
  const adapter = new TimbreSpeechSynthesizer(catalog(), { apiKey: "" }, async () => { attempts++; throw new Error("Must not transport"); });
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, new FileCallerAudioCache(await directory(context)), adapter, (id) => ledger.reserve("tts", id));
  await assert.rejects(service.get("S-01", "0.2.0", "system.opening", "local", new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof ApplicationError); assert.equal(error.code, "TTS_UNAVAILABLE"); assert.equal(error.technical?.providerAttempted, false); return true;
  });
  assert.equal(attempts, 0); assert.equal(ledger.snapshot().tts.usedUnits, 0);
});

test("unapproved caller content fails before provider credit is reserved", async (context) => {
  const ledger = credits(); let attempts = 0;
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, new FileCallerAudioCache(await directory(context)), { synthesize: async () => { attempts++; throw new Error("No call"); } }, (id) => ledger.reserve("tts", id));
  await assert.rejects(service.get("S-01", "0.2.0", "not-approved", "local", new AbortController().signal), (error: unknown) => error instanceof ApplicationError && error.technical?.stage === "CALLER_AUDIO_RESOLUTION");
  assert.equal(attempts, 0); assert.equal(ledger.snapshot().tts.usedUnits, 0);
});

test("cancel while cache lookup is pending never consumes provider credit", async () => {
  const ledger = credits(), abort = new AbortController(); let release!: () => void, attempts = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, { get: async () => { await pending; return undefined; }, set: async () => {} },
    { synthesize: async () => { attempts++; return { bytes: callerWavFixture(), mediaType: "audio/wav" }; } }, (id) => ledger.reserve("tts", id));
  const result = service.get("S-01", "0.2.0", "system.opening", "cancelled", abort.signal); abort.abort(); release();
  await assert.rejects(result); assert.equal(attempts, 0); assert.equal(ledger.snapshot().tts.usedUnits, 0);
});

test("real Timbre transport boundary charges once; subsequent cache HIT adds no charge or attempt", async (context) => {
  const ledger = credits(); let attempts = 0;
  const adapter = new TimbreSpeechSynthesizer(catalog(), { apiKey: "offline-placeholder" }, async () => { attempts++; return new Response(callerWavFixture(), { headers: { "content-type": "audio/wav" } }); });
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, new FileCallerAudioCache(await directory(context)), adapter, (id) => ledger.reserve("tts", id));
  const request = () => service.get("S-01", "0.2.0", "system.opening", "once", new AbortController().signal);
  const [first, duplicate] = await Promise.all([request(), request()]); assert.equal(first.cacheKey, duplicate.cacheKey);
  assert.equal((await request()).cacheHit, true); assert.equal(attempts, 1);
  assert.equal(ledger.snapshot().tts.usedUnits, 1); assert.equal(ledger.snapshot().tts.providerAttempts, 1); assert.equal(ledger.snapshot().events.length, 1);
});

test("local TTS credit denial is identified separately from an actual provider-originated 429", async (context) => {
  for (const allowed of [false, true]) {
    const ledger = credits(allowed ? 1 : 0); let attempts = 0;
    const adapter = new TimbreSpeechSynthesizer(catalog(), { apiKey: "offline-placeholder" }, async () => { attempts++; return new Response("{}", { status: 429, headers: { "content-type": "application/json" } }); });
    const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, new FileCallerAudioCache(await directory(context)), adapter, (id) => ledger.reserve("tts", id));
    await assert.rejects(service.get("S-01", "0.2.0", "system.opening", "denied", new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof ApplicationError); assert.equal(error.code, allowed ? "TTS_PROVIDER_FAILED" : "CREDIT_LIMIT_REACHED");
      assert.equal(error.technical?.stage, allowed ? "TTS_PROVIDER" : "TTS_CREDIT_GUARD"); assert.equal(error.technical?.providerAttempted, allowed); return true;
    });
    assert.equal(attempts, Number(allowed)); assert.equal(ledger.snapshot().tts.usedUnits, Number(allowed));
  }
});

test("duplicate provider boundary callbacks cannot reserve twice", async (context) => {
  const ledger = credits(); let attempts = 0;
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, new FileCallerAudioCache(await directory(context)), {
    reportsProviderRequestBoundary: true, synthesize: async (_request, options) => { options!.beforeRequest!(); options!.beforeRequest!(); attempts++; return { bytes: callerWavFixture(), mediaType: "audio/wav" }; },
  }, (id) => ledger.reserve("tts", id));
  await service.get("S-01", "0.2.0", "system.opening", "double", new AbortController().signal);
  assert.equal(attempts, 1); assert.equal(ledger.snapshot().tts.usedUnits, 1); assert.equal(ledger.snapshot().events.length, 1);
});
test("corrupt/zero cache is removed, never returned as playable", async (context) => {
  const path = await directory(context), cache = new FileCallerAudioCache(path), key = `tts-${"a".repeat(64)}`;
  await writeFile(join(path, `${key}.json`), JSON.stringify({ key, mediaType: "audio/wav", sha256: "bad", audio: "" }));
  assert.equal(await cache.get(key), undefined); assert.deepEqual(await readdir(path), []); await assert.rejects(cache.get("../../escape"));
});
test("bounded filesystem cache evicts oldest entries and serializes concurrent writes", async (context) => {
  const path = await directory(context), cache = new FileCallerAudioCache(path, 6000, 2);
  const keys = ["a", "b", "c"].map((value) => `tts-${value.repeat(64)}`);
  await Promise.all(keys.map((key) => cache.set(key, callerWavFixture())));
  assert.equal((await readdir(path)).length, 2); assert.equal(await cache.get(keys[0]!), undefined); assert.ok(await cache.get(keys[2]!));
});

async function api(context: TestContext, enabled = true, delayed = false) {
  const path = await directory(context); await writeFile(join(path, "S-01.json"), JSON.stringify(scenario));
  const store = new InMemorySessionStore(); let calls = 0;
  let release!: () => void, began!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { began = resolve; });
  const server = createApiServer({ environment: "test", scenarioDirectory: path, sessionStore: store, ttsUnits: 1,
    budget: { mode: "development", developmentCap: 1, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 },
    ...(enabled ? { callerAudio: (scenarios: ReadonlyMap<string, ScenarioDocument>, reserve: (id: string) => void) => new CallerAudioService(new ApprovedCallerCatalog(scenarios, TIMBRE_PROFILE.voice), TIMBRE_PROFILE,
      new FileCallerAudioCache(join(path, "cache")), { async synthesize() { calls++; began(); if (delayed) await pending; return { bytes: callerWavFixture(), mediaType: "audio/wav" }; } }, reserve) } : {}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const create = async () => {
    const created = await post("/api/sessions", { scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", runtimeMode: "REAL_STT", demoMode: false });
    return (await created.json() as { session: { sessionId: string } }).session.sessionId;
  };
  const consent = (id: string) => post(`/api/sessions/${id}/consent`, { consentVersion: "training-consent-v1" });
  return { base, post, create, consent, store, started, release, count: () => calls };
}
test("session routes resolve opening, deduplicate, deliver bytes, and serve cross-session HIT at exhausted credit cap", async (context) => {
  const h = await api(context), id = await h.create(); await h.consent(id);
  const path = `/api/sessions/${id}/caller-audio`, body = { turnNumber: 0, responseId: "system.opening" };
  const results = await Promise.all([h.post(path, body), h.post(path, body)]);
  const first = CallerAudioAssetSchema.parse(await results[0]!.json()), duplicate = CallerAudioAssetSchema.parse(await results[1]!.json());
  assert.equal(first.audioUrl, duplicate.audioUrl); assert.equal(first.cacheHit, false); assert.equal(h.count(), 1);
  assert.equal(h.store.get(id).cache.misses, 1);
  const audio = await fetch(h.base + first.audioUrl); assert.equal(audio.headers.get("content-type"), "audio/wav"); assert.equal((await audio.arrayBuffer()).byteLength, 1004);
  const secondId = await h.create(); await h.consent(secondId);
  const second = CallerAudioAssetSchema.parse(await (await h.post(`/api/sessions/${secondId}/caller-audio`, body)).json());
  assert.equal(second.cacheHit, true); assert.equal(h.count(), 1);
  assert.equal(h.store.get(secondId).cache.hits, 1);
  assert.equal((await fetch(h.base + first.audioUrl.replace(id, secondId))).ok, false);
  await h.post(`/api/sessions/${id}/end`, {}); assert.equal((await fetch(h.base + first.audioUrl)).ok, false);
});
test("route rejects arbitrary text, unselected response, stale turn, missing consent, disabled gate, cross-origin", async (context) => {
  const h = await api(context), id = await h.create(), path = `/api/sessions/${id}/caller-audio`;
  assert.equal((await h.post(path, { turnNumber: 0, responseId: "system.opening" })).status, 409);
  await h.consent(id);
  for (const body of [{ turnNumber: 0, responseId: "system.opening", text: "arbitrary" }, { turnNumber: 0, responseId: "authority" }, { turnNumber: 1, responseId: "system.opening" }, { turnNumber: 0, responseId: "unknown" }]) assert.equal((await h.post(path, body)).ok, false);
  const cross = await fetch(h.base + path, { method: "POST", headers: { origin: "https://other.invalid" } }); assert.equal(cross.status, 400); assert.equal(h.count(), 0);
  const off = await api(context, false), offId = await off.create(); await off.consent(offId);
  assert.equal((await off.post(`/api/sessions/${offId}/caller-audio`, { turnNumber: 0, responseId: "system.opening" })).status, 503);
});
test("selected response can use shared path; credit cap blocks a later miss before another call", async (context) => {
  const h = await api(context), id = await h.create(); await h.consent(id);
  const path = `/api/sessions/${id}/caller-audio`;
  assert.equal((await h.post(path, { turnNumber: 0, responseId: "system.opening" })).status, 200);
  const current = h.store.get(id);
  h.store.update({ ...current, currentResponseId: "system.safe-ending", turnNumber: 1, state: "COMPLETED", terminalState: "SAFE_VERIFIED", recordingEnabled: false });
  assert.equal((await h.post(path, { turnNumber: 1, responseId: "system.safe-ending" })).status, 429); assert.equal(h.count(), 1);
});
test("session end during synthesis rejects late audio and leaves session ended", async (context) => {
  const h = await api(context, true, true), id = await h.create(); await h.consent(id);
  const pending = h.post(`/api/sessions/${id}/caller-audio`, { turnNumber: 0, responseId: "system.opening" });
  await h.started; await h.post(`/api/sessions/${id}/end`, {}); h.release();
  assert.equal((await pending).status, 409); assert.equal(h.store.get(id).state, "ENDED_BY_LEARNER"); assert.equal(h.count(), 1);
});
test("policy-selected approved safe ending uses the same session audio route without a new learner turn", async (context) => {
  const h = await api(context), id = await h.create(); await h.consent(id);
  const current = h.store.get(id);
  h.store.update({ ...current, currentResponseId: "system.safe-ending", turnNumber: 1, state: "COMPLETED", terminalState: "SAFE_VERIFIED", recordingEnabled: false });
  const response = await h.post(`/api/sessions/${id}/caller-audio`, { turnNumber: 1, responseId: "system.safe-ending" });
  assert.equal(response.status, 200); const asset = CallerAudioAssetSchema.parse(await response.json());
  assert.equal(asset.responseId, "system.safe-ending"); assert.equal((await fetch(h.base + asset.audioUrl)).status, 200);
  assert.equal(h.store.get(id).turnNumber, 1); assert.equal(h.store.get(id).state, "COMPLETED"); assert.equal(h.count(), 1);
  await h.post(`/api/sessions/${id}/end`, {});
  assert.equal((await h.post(`/api/sessions/${id}/caller-audio`, { turnNumber: 1, responseId: "system.safe-ending" })).status, 409);
  assert.equal((await fetch(h.base + asset.audioUrl)).ok, false);
});
test("corrupt cache causes at most one permitted regeneration, then a hit", async (context) => {
  const path = await directory(context), cache = new FileCallerAudioCache(path); let calls = 0;
  const approved = catalog().resolveId("S-01", "0.2.0", "system.opening"), key = callerAudioKey(approved, TIMBRE_PROFILE);
  await writeFile(join(path, `${key}.json`), "corrupt");
  const service = new CallerAudioService(catalog(), TIMBRE_PROFILE, cache, { async synthesize() { calls++; return { bytes: callerWavFixture(), mediaType: "audio/wav" }; } }, () => {});
  const first = await service.get("S-01", "0.2.0", "system.opening", "s", new AbortController().signal);
  const next = await service.get("S-01", "0.2.0", "system.opening", "s", new AbortController().signal);
  assert.equal(first.cacheHit, false); assert.equal(next.cacheHit, true); assert.equal(calls, 1);
});
