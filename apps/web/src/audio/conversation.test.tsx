import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter, once } from "node:events";
import WebSocket from "ws";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { RealVoiceTurnResultSchema, TranscriptEventSchema, type BrowserAudioTimingFacts, type SafeSession, type SpeechRecognizer } from "@vaccine/contracts";
import { validateScenarioDocument } from "@vaccine/scenario-schema";
import { createApiServer } from "../../../api/src/health.js";
import { InMemorySessionStore } from "../../../api/src/sessionStore.js";
import { CallerAudioService, callerAudioKey } from "../../../api/src/callerAudio/service.js";
import { ApprovedCallerCatalog } from "../../../api/src/callerAudio/catalog.js";
import { FileCallerAudioCache } from "../../../api/src/callerAudio/cache.js";
import { TIMBRE_PROFILE } from "../../../api/src/providers/timbre/runtimeConfig.js";
import { callerWavFixture } from "../../../api/src/testing/callerWavFixture.js";
import { applyConversationAction } from "../../../api/src/conversationRuntime.js";
import { readConversationTemplates, conversationDebrief } from "../../../api/src/conversationDebrief.js";
import { createApiClient } from "../sessionApi.js";
import { BoundedConversationController } from "./conversationController.js";
import type { CaptureConnection, CaptureHealth } from "./browserCapture.js";
import type { CallerPlayback } from "./callerPlayback.js";
import { BrowserAudioError } from "./errors.js";
import { PressureLatencyCurve } from "../components/PressureLatencyCurve.js";
import { ApplicationError } from "../../../api/src/errors.js";
import { SessionApiError } from "../sessionApi.js";
import { PrismaRealtimeSpeechRecognizer } from "../../../api/src/providers/prisma/prismaRealtimeRecognizer.js";
import { AdaptivePolicyEngine } from "../../../api/src/adaptivePolicy.js";
import { endSession } from "../../../api/src/session.js";
import { BrowserAudioController, type AudioControllerOptions, type AudioDiagnostics } from "./controller.js";
import { assertRuntimeInvariants } from "../../../api/src/testing/runtimeInvariants.js";
import { LearnerBehaviorClassifier } from "../../../api/src/behaviorClassifier.js";

const clock = "00000000-0000-4000-8000-000000000003";
const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
async function setup(context: TestContext, options: { texts?: string[]; cap?: number; sttUnits?: number; sttFailureAt?: number; sttStartFailureAt?: number; sttFrameFailureAt?: number; sttConnectFailure?: boolean; sttLocalFailure?: boolean; ttsFailureAt?: number; delayFinish?: boolean; initialTtsUsedUnits?: number; cachedResponses?: string[]; runtimeRecognizer?: SpeechRecognizer } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "conversation-offline-"));
  const cache = new FileCallerAudioCache(directory), catalog = new ApprovedCallerCatalog(new Map([[scenario.scenario_id, scenario]]), TIMBRE_PROFILE.voice);
  for (const id of options.cachedResponses ?? []) await cache.set(callerAudioKey(catalog.resolveId("S-01", scenario.version, id), TIMBRE_PROFILE), callerWavFixture());
  let opened = 0, cancelled = 0, finished = 0, tts = 0, released: (() => void) | undefined;
  const gate = options.delayFinish ? new Promise<void>((resolve) => { released = resolve; }) : Promise.resolve();
  const store = new InMemorySessionStore();
  const recognizer: SpeechRecognizer = { transcribe: async () => { throw new Error("No text/mock transcription"); },
    openStream: (request) => {
      if (options.sttLocalFailure) throw new ApplicationError("INVALID_REQUEST", "Offline local validation failure");
      if (options.sttStartFailureAt === opened + 1) throw new ApplicationError("STT_CONNECTION_FAILED", "Offline start failure");
      opened++; const index = opened; let stopped = false;
      const ready = options.sttConnectFailure ? Promise.reject(new Error("Offline connection failure")) : Promise.resolve();
      void ready.catch(() => {});
      return { ready, sendFrame: async (bytes) => { assert.equal(bytes.length, 1024); if (index === options.sttFrameFailureAt) throw new ApplicationError("STT_CONNECTION_FAILED", "Offline stream failure"); },
        finish: async () => { finished++; await gate;
          if (index === options.sttFailureAt) throw new Error("Sanitized offline failure");
          return TranscriptEventSchema.parse({ ...request, eventId: `offline-${index}`, text: options.texts?.[index - 1] ?? "थोड़ा समय चाहिए",
            normalizationStatus: "normalized", segments: [{ text: options.texts?.[index - 1] ?? "थोड़ा समय चाहिए", segmentIndex: 1,
              providerTimestamp: "2099-01-01T00:00:00.000Z", providerAudioDurationMs: 999999 }] }); },
        cancel: () => { if (!stopped) { stopped = true; cancelled++; } } };
    } };
  const server = createApiServer({ environment: "test", sessionStore: store, runtimeRecognizer: options.runtimeRecognizer ?? recognizer,
    ...(options.initialTtsUsedUnits === undefined ? {} : { initialTtsUsedUnits: options.initialTtsUsedUnits }),
    sttUnits: options.sttUnits ?? 1, ttsUnits: 1, budget: { mode: "development", developmentCap: options.cap ?? 30, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 },
    callerAudio: (scenarios, reserve) => new CallerAudioService(new ApprovedCallerCatalog(scenarios, TIMBRE_PROFILE.voice), TIMBRE_PROFILE,
      cache, { synthesize: async () => { tts++; if (tts === options.ttsFailureAt) throw new Error("offline TTS failure"); return { bytes: callerWavFixture(), mediaType: "audio/wav" }; } }, reserve) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(async () => { released?.(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`, api = createApiClient(base);
  const create = async () => {
    const session = await api.createDemoSession({ scenarioId: "S-01", scenarioVersion: scenario.version, language: "hi-IN", runtimeMode: "REAL_CONVERSATION" });
    return api.grantConsent(session.sessionId);
  };
  const session = await create();
  const post = (id: string, action: string, body: unknown, token?: string) => fetch(`${base}/api/sessions/${id}/real-audio/${action}`, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-audio-token": token } : {}) }, body: JSON.stringify(body) });
  const action = (id: string, kind: "start" | "caller-start" | "caller-ended" | "fail", body: unknown) => api.conversationAction!(id, kind, body);
  const playback = async (state: SafeSession, start: number, end: number) => {
    const value = { turnNumber: state.turnNumber, responseId: state.currentResponseId, audioClockId: clock };
    await api.getCallerAudio!(state.sessionId, state.turnNumber, state.currentResponseId!, new AbortController().signal);
    await action(state.sessionId, "caller-start", { ...value, atMs: start });
    return action(state.sessionId, "caller-ended", { ...value, atMs: end });
  };
  const facts = (state: SafeSession, callerStart: number, callerEnd: number, latency = 400): BrowserAudioTimingFacts => ({
    sessionId: state.sessionId, turnNumber: state.turnNumber + 1, audioClockId: clock, timingValid: true,
    events: ([ ["CALLER_AUDIO_START", callerStart], ["CALLER_AUDIO_END", callerEnd], ["LEARNER_SPEECH_START", callerEnd + latency], ["LEARNER_SPEECH_END", callerEnd + latency + 1000] ] as const).map(([kind, monotonicMs]) => ({
      sessionId: state.sessionId, turnNumber: state.turnNumber + 1, kind, availability: "available",
      at: { monotonicMs, audioClockId: clock, source: kind.startsWith("CALLER") ? "CLIENT_AUDIO_CLOCK" : "LOCAL_VAD", precision: "instant" },
      ...(kind.startsWith("LEARNER") ? { segmentNumber: 1 } : {}) })) });
  const open = async (state: SafeSession) => {
    const response = await post(state.sessionId, "start", { audioClockId: clock, turnNumber: state.turnNumber + 1, microphoneConsent: true });
    assert.equal(response.status, 200); const { token } = await response.json() as { token: string };
    const frame = await fetch(`${base}/api/sessions/${state.sessionId}/real-audio/frame`, { method: "POST", headers: {
      "content-type": "application/octet-stream", "x-audio-token": token, "x-audio-sequence": "0", "x-audio-produced-at": String(state.conversation!.caller!.endedAtMs! + 32) }, body: new Uint8Array(1024) });
    assert.equal(frame.status, 200); return token;
  };
  const turn = async (state: SafeSession, start: number, latency = 400) => {
    const listening = await playback(state, start, start + 1000), token = await open(listening);
    const response = await post(state.sessionId, "finish", facts(listening, start, start + 1000, latency), token);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return RealVoiceTurnResultSchema.parse(await response.json());
  };
  return { api, session, create, store, base, post, action, playback, facts, open, turn, release: () => released?.(), counts: () => ({ opened, cancelled, finished, tts }) };
}

for (const [name, texts, labels, outcome, pressures] of [
  ["two turns stalled then verified", ["थोड़ा समय चाहिए", "Main independently verify karunga"], ["STALLED", "VERIFIED_INDEPENDENTLY"], "SAFE_VERIFIED", [0, 1]],
  ["three turns refused stalled verified", ["main share nahi karunga", "थोड़ा समय चाहिए", "Main independently verify karunga"], ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY"], "SAFE_VERIFIED", [0, 1, 1]],
  ["repeated compliance stops at exact max", ["main share karunga", "main share karunga", "main share karunga"], ["COMPLIED", "COMPLIED", "COMPLIED"], "MAX_TURNS", [0, 1, 1]],
  ["disclosure on turn two", ["थोड़ा समय चाहिए", "DUMMY-4821"], ["STALLED", "DISCLOSED_DUMMY_SECRET"], "DUMMY_SECRET_DISCLOSED", [0, 1]],
  ["unknown safe fallback", ["a quiet blue sky"], ["UNKNOWN"], "SAFE_FALLBACK", [0]],
] as const) test(`HTTP automatic conversation: ${name}`, async (context) => {
  const h = await setup(context, { texts: [...texts] }); let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  for (let index = 0; index < texts.length; index++) {
    const result = await h.turn(state, index * 5000, 400 + index * 100); state = result.turn.session;
    assert.equal(state.timelineEvents[index]!.behavior.label, labels[index]);
    assert.equal(state.timelineEvents[index]!.responseLatency!.valueMs, 400 + index * 100);
    assert.equal(state.timelineEvents[index]!.callerAudioStartedAt!.audioClockId, clock);
    assert.equal(state.timelineEvents[index]!.callerResponseId, index === 0 ? "system.opening" : state.timelineEvents[index - 1]!.selectedNextResponseId);
    assert.equal(state.timelineEvents.length, index + 1); assert.equal(state.pressureTimeline.length, index + 1);
    assert.notEqual(state.state, "COMPLETED");
  }
  assert.equal(state.terminalState, outcome); assert.deepEqual(state.pressureTimeline.map((point) => point.callerPressureLevel), pressures);
  assert.equal(state.conversation?.phase, "TERMINAL_CALLER_PREPARING");
  assert.equal(state.currentResponseId, outcome === "SAFE_FALLBACK" ? "system.safe-fallback" : "system.safe-ending");
  assert.equal(state.pressureDebrief?.completionKind, "in_progress");
  const completed = await h.playback(state, 20000, 21000);
  assert.equal(completed.state, "COMPLETED"); assert.equal(completed.pressureDebrief?.completionKind, "complete");
  assert.equal(completed.timelineEvents.length, texts.length); assert.equal(h.counts().opened, texts.length); assert.equal(h.counts().cancelled, texts.length);
  assert.equal((await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: texts.length + 1, microphoneConsent: true })).status, 503);
  if (outcome === "DUMMY_SECRET_DISCLOSED") {
    assert.equal(completed.pressureDebrief?.firstComplianceMoment?.turnId, `${state.sessionId}:turn-2`);
    assert.equal(completed.timelineEvents.filter((event) => event.complianceMoment).length, 1);
    assert.doesNotMatch(JSON.stringify(completed), /DUMMY-4821/u);
  }
  const again = await h.api.getSession(state.sessionId); assert.deepEqual(again.pressureDebrief, completed.pressureDebrief);
});

test("STT cannot open before matching actual caller end; provider reference cannot replace local clock", async (context) => {
  const h = await setup(context);
  await h.action(h.session.sessionId, "start", { audioClockId: clock });
  assert.equal((await h.post(h.session.sessionId, "start", { audioClockId: clock, turnNumber: 1, microphoneConsent: true })).status, 503);
  const state = await h.playback(h.session, 100, 1000);
  assert.equal((await h.post(h.session.sessionId, "start", { audioClockId: "00000000-0000-4000-8000-000000000099", turnNumber: 1, microphoneConsent: true })).status, 400);
  assert.equal(h.counts().opened, 0);
  const token = await h.open(state), invalid = h.facts(state, 100, 999);
  assert.equal((await h.post(state.sessionId, "finish", invalid, token)).status, 400);
  assert.equal(h.store.get(state.sessionId).timelineEvents.length, 0);
});

test("duplicate concurrent Finish coalesces; late finish cannot append again", async (context) => {
  const h = await setup(context, { delayFinish: true }); await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const state = await h.playback(h.session, 0, 1000), token = await h.open(state);
  const first = h.post(state.sessionId, "finish", h.facts(state, 0, 1000), token);
  await until(() => h.counts().finished === 1);
  const second = h.post(state.sessionId, "finish", h.facts(state, 0, 1000), token);
  await new Promise((resolve) => setTimeout(resolve, 20)); h.release();
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  assert.equal(h.store.get(state.sessionId).timelineEvents.length, 1); assert.equal(h.counts().finished, 1);
  assert.equal((await h.post(state.sessionId, "finish", h.facts(state, 0, 1000), token)).status, 409);
});

test("End during provider settle ignores late final and retains only earlier committed events", async (context) => {
  const h = await setup(context, { delayFinish: true }); await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const state = await h.playback(h.session, 0, 1000), token = await h.open(state);
  const pending = h.post(state.sessionId, "finish", h.facts(state, 0, 1000), token);
  await until(() => h.counts().finished === 1); await h.api.endSession(state.sessionId); h.release(); await pending;
  const stopped = h.store.get(state.sessionId); assert.equal(stopped.conversation?.phase, "STOPPED"); assert.equal(stopped.timelineEvents.length, 0);
  assert.equal(h.counts().cancelled, 1);
});

test("safe word commits once then stops with no terminal caller audio", async (context) => {
  const h = await setup(context, { texts: ["stop simulation"] }); let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session;
  assert.equal(state.terminalState, "SAFE_WORD"); assert.equal(state.conversation?.phase, "STOPPED"); assert.equal(state.timelineEvents.length, 1);
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 1, state.currentResponseId!, new AbortController().signal));
  assert.equal(h.counts().tts, 1);
});

test("caller cache is reused across automatic sessions without additional synthesis", async (context) => {
  const h = await setup(context); const second = await h.create();
  for (const state of [h.session, second]) { await h.action(state.sessionId, "start", { audioClockId: clock }); await h.playback(state, 0, 1000); }
  assert.equal(h.counts().tts, 1); assert.equal(h.counts().opened, 0);
});

for (const kind of ["clock", "response", "turn", "order", "duplicate-ended"] as const) test(`caller observation gate: ${kind}`, async (context) => {
  const h = await setup(context); await h.action(h.session.sessionId, "start", { audioClockId: clock });
  await h.playback(h.session, 100, 1000);
  const state = h.store.get(h.session.sessionId), value = { audioClockId: clock, turnNumber: 0, responseId: "system.opening", atMs: 1000 };
  if (kind === "duplicate-ended") assert.deepEqual(applyConversationAction(state, "caller-ended", value), state);
  else {
    if (kind === "clock") value.audioClockId = "00000000-0000-4000-8000-000000000099";
    if (kind === "response") value.responseId = "authority";
    if (kind === "turn") value.turnNumber = 1;
    if (kind === "order") value.atMs = 99;
    assert.throws(() => applyConversationAction(state, "caller-ended", value));
  }
  assert.equal(state.timelineEvents.length, 0); assert.equal(h.counts().opened, 0);
});

test("reviewed debrief placeholders use their own turn, deterministic source log, and honest nulls", async (context) => {
  const h = await setup(context, { texts: ["थोड़ा समय चाहिए", "Main independently verify karunga"] });
  let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0, 444)).turn.session; state = (await h.turn(state, 5000, 888)).turn.session;
  const templates = readConversationTemplates("content/authoring/S-01-hi-IN.package.json", scenario), canonical = h.store.get(state.sessionId);
  const output = conversationDebrief(canonical, templates)!;
  assert.match(output.reviewedEntries![0]!.text, /444 ms.*1\.44 s/u); assert.match(output.reviewedEntries![1]!.text, /888 ms.*6\.89 s/u);
  assert.deepEqual(output, conversationDebrief(canonical, templates));
  canonical.timelineEvents[1]!.responseLatency = null; canonical.timelineEvents[1]!.responseLatencySource = "UNKNOWN"; canonical.timelineEvents[1]!.responseLatencyPrecision = "unknown";
  assert.match(conversationDebrief(canonical, templates)!.reviewedEntries![1]!.text, /latency unavailable/u);
  const stale = structuredClone(scenario); stale.version = "stale";
  assert.throws(() => readConversationTemplates("content/authoring/S-01-hi-IN.package.json", stale));
});

test("curve renders three ordered 0/1/2 points, associated null latency, and first compliance marker only", async (context) => {
  const h = await setup(context); let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session;
  const template = state.pressureTimeline[0]!;
  const points = [0, 1, 2].map((pressure, index) => ({ ...template, turnId: `synthetic:turn-${index + 1}`, callerPressureLevel: pressure,
    responseLatency: index === 1 ? null : template.responseLatency,
    complianceMoment: index > 0 ? { turnId: "synthetic:turn-2", segmentIndex: 1, source: "synthetic_dummy_secret_detector" as const,
      precision: "segment" as const, timingSource: "UNKNOWN" as const, approximate: true as const } : null }));
  const markup = renderToStaticMarkup(<PressureLatencyCurve points={points} />);
  assert.equal((markup.match(/data-pressure-point="true"/gu) ?? []).length, 3);
  assert.equal((markup.match(/data-compliance-marker="true"/gu) ?? []).length, 1);
  assert.match(markup, /data-turn-id="synthetic:turn-2" data-latency-ms="unavailable"/u);
  assert.ok(markup.indexOf("synthetic:turn-1") < markup.indexOf("synthetic:turn-2"));
});

async function until(predicate: () => boolean) { for (let count = 0; count < 1500; count++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); } assert.fail("Offline condition did not settle"); }

async function browser(context: TestContext, options: Parameters<typeof setup>[1] = {}, callbacks: { onTurn?: () => void } = {}) {
  const h = await setup(context, options); let now = 100000, acquired = 0, driverStopped = 0, flushes = 0;
  let receive: ((samples: Float32Array) => void) | undefined, driverError: ((error: BrowserAudioError) => void) | undefined;
  const players: { start(): void; end(): void; fail(): void; stopped: boolean }[] = [];
  const health: CaptureHealth = { streamActive: true, audioTrackCount: 1, tracksLive: true, tracksEnabled: true, audioContextState: "running", workletState: "running" };
  const driver: CaptureConnection = { sampleRate: 16000, settings: {}, health: () => ({ ...health }), start: async (samples, error) => { receive = samples; driverError = error; },
    flush: async (options) => { assert.equal(options?.keepAlive, true); flushes++; },
    stop: () => { driverStopped++; receive = undefined; health.tracksLive = false; health.audioContextState = "closed"; health.workletState = "stopped"; }, playMockCaller: () => assert.fail("No mock cues") };
  const sessions: SafeSession[] = [], completed: SafeSession[] = [];
  const controller = new BoundedConversationController({ session: h.session, api: h.api, now: () => now, newClockId: () => clock,
    acquire: async () => { acquired++; return driver; }, onChange: () => {}, onSession: (session) => sessions.push(session), onTurn: () => callbacks.onTurn?.(), onFinished: (session) => completed.push(session),
    makePlayback: (asset): CallerPlayback => { const value = { start: () => {}, end: () => {}, fail: () => {}, stopped: false }; players.push(value);
      return { asset, play: (start, end, fail) => { value.start = start; value.end = end; value.fail = fail; }, stop: () => { value.stopped = true; } }; } });
  context.after(() => controller.dispose());
  const samples = (count: number, level = 0) => { for (let index = 0; index < count; index++) { now += 20; const block = new Float32Array(320).fill(level); receive?.(block); if (receive) assert.equal(block[0], 0); } };
  const speak = async () => { for (const level of [0.1, 0]) for (let index = 0; index < 20; index++) { samples(1, level); await new Promise((resolve) => setTimeout(resolve, 3)); } };
  const callerReady = async (number: number) => {
    await until(() => controller.snapshot().state === "CALLER_PREPARING" || controller.snapshot().state === "ERROR");
    if (controller.snapshot().state === "ERROR") return;
    await until(() => players.length >= number || controller.snapshot().state === "ERROR");
  };
  const beginCallerEnd = async (number: number) => { const player = players[number - 1]!; now += 100; player.start(); now += 1000; player.end();
    await until(() => ["LEARNER_PREPARING", "COMPLETED", "ERROR"].includes(controller.snapshot().state));
    await Promise.resolve(); };
  const endCaller = async (number: number) => { await beginCallerEnd(number); samples(40);
    await until(() => ["LEARNER_LISTENING", "COMPLETED", "ERROR"].includes(controller.snapshot().state)); };
  return { ...h, controller, samples, speak, players, sessions, completed, callerReady, endCaller, beginCallerEnd, health, flushes: () => flushes, error: () => driverError?.(new BrowserAudioError("PCM_PIPELINE_FAILED")),
    start: async () => { controller.start(); await callerReady(1); }, countsBrowser: () => ({ acquired, driverStopped }), advance: (ms: number) => { now += ms; } };
}

test("browser drives two turns automatically, one microphone, stable clock, real ended gates and one terminal callback", async (context) => {
  const h = await browser(context, { texts: ["थोड़ा समय चाहिए", "Main independently verify karunga"] }); await h.start();
  h.controller.start(); h.samples(15, 0.1); assert.equal(h.counts().opened, 0);
  await h.endCaller(1); const firstEnd = h.players[0]!.end; firstEnd();
  await h.speak(); await h.callerReady(2);
  assert.equal(h.controller.snapshot().session.timelineEvents.length, 1); assert.equal(h.counts().opened, 1);
  h.samples(20, 0.1); assert.equal(h.counts().opened, 1); await h.endCaller(2);
  await h.speak(); await h.callerReady(3);
  assert.equal(h.controller.snapshot().session.timelineEvents.length, 2); assert.notEqual(h.controller.snapshot().state, "COMPLETED");
  assert.equal(h.completed.length, 0); assert.equal(h.countsBrowser().driverStopped, 1);
  await h.endCaller(3); h.players[2]!.end(); await until(() => h.completed.length === 1);
  assert.equal(h.controller.snapshot().state, "COMPLETED"); assert.equal(h.countsBrowser().acquired, 1); assert.equal(h.counts().opened, 2);
  assert.deepEqual(h.controller.snapshot().callers.map((value) => value.audioClockId), [clock, clock, clock]);
  const events = h.completed[0]!.timelineEvents; assert.equal(events.length, 2);
  assert.ok(events[1]!.callerAudioStartedAt!.monotonicMs > events[0]!.learnerSpeechEndedAt!.monotonicMs);
});

test("caller discard to fresh second calibration is idempotent, then two committed turns reach terminal debrief", async (context) => {
  const h = await browser(context, { texts: ["थोड़ा समय चाहिए", "Main independently verify karunga"] }); await h.start();
  h.samples(50, 0.8); assert.equal(h.controller.snapshot().microphone?.calibrationCount, 0); assert.equal(h.counts().opened, 0);
  await h.endCaller(1); await h.speak(); await h.callerReady(2);
  assert.equal(h.controller.snapshot().session.timelineEvents.length, 1); assert.equal(h.health.tracksLive, true);
  assert.equal(h.health.audioContextState, "running"); assert.equal(h.countsBrowser().driverStopped, 0);
  assert.equal(h.controller.snapshot().microphone?.mode, "DISCARD"); assert.equal(h.flushes(), 2);
  h.samples(50, 0.8); assert.equal(h.counts().opened, 1); assert.equal(h.controller.snapshot().microphone?.calibrationCount, 1);
  await h.beginCallerEnd(2); h.players[1]!.end(); h.players[0]!.end();
  assert.equal(h.controller.snapshot().microphone?.calibrationCount, 2); assert.equal(h.controller.snapshot().microphone?.turnNumber, 2);
  h.samples(36); assert.equal(h.controller.snapshot().state, "LEARNER_PREPARING"); assert.equal(h.counts().opened, 1);
  h.samples(2); await until(() => h.controller.snapshot().state === "LEARNER_LISTENING");
  assert.equal(h.controller.snapshot().diagnostics?.segmentCount, 0); assert.equal(h.controller.snapshot().diagnostics?.latestStartMs, null);
  assert.equal(h.controller.snapshot().diagnostics?.frameCount, 0); assert.equal(h.counts().opened, 2);
  await h.speak(); await h.callerReady(3); await h.endCaller(3);
  const state = h.controller.snapshot().session;
  assert.deepEqual(state.timelineEvents.map((event) => event.behavior.label), ["STALLED", "VERIFIED_INDEPENDENTLY"]);
  assert.equal(state.timelineEvents.length, 2); assert.equal(state.pressureTimeline.length, 2); assert.equal(state.state, "COMPLETED");
  assert.equal(state.pressureDebrief?.completionKind, "complete"); assert.equal(h.counts().opened, 2); assert.equal(h.completed.length, 1);
  assert.equal(h.countsBrowser().acquired, 1); assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.health.workletState, "stopped");
});

test("End during second calibration stops the session without a second provider window or duplicate event", async (context) => {
  const h = await browser(context); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2); await h.beginCallerEnd(2);
  assert.equal(h.controller.snapshot().state, "LEARNER_PREPARING");
  h.controller.stop(); await h.api.endSession(h.session.sessionId); h.samples(50); h.players[1]!.end();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.controller.snapshot().state, "STOPPED"); assert.equal(h.counts().opened, 1); assert.equal(h.countsBrowser().driverStopped, 1);
  const state = await h.api.getSession(h.session.sessionId); assert.equal(state.timelineEvents.length, 1); assert.equal(state.pressureTimeline.length, 1);
  assert.equal(state.pressureDebrief?.completionKind, "partial"); assert.equal((await h.create()).timelineEvents.length, 0);
});

for (const [change, expected] of [
  [{ tracksLive: false }, "MEDIA_STREAM_ENDED"], [{ audioContextState: "closed" }, "AUDIO_CONTEXT_CLOSED"], [{ workletState: "failed" }, "WORKLET_UNAVAILABLE"],
] as const) test(`second calibration ${expected} preserves turn one and cannot start Prisma`, async (context) => {
  const h = await browser(context); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2);
  Object.assign(h.health, change); await h.beginCallerEnd(2);
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  await until(() => h.controller.snapshot().session.conversation?.failure?.causeCode === expected);
  const snapshot = h.controller.snapshot(); assert.equal(snapshot.error, "LEARNER_AUDIO_FAILED");
  assert.equal(snapshot.technical?.stage, "CALIBRATION"); assert.equal(snapshot.technical?.causeCode, expected);
  assert.equal(h.counts().opened, 1); assert.equal(h.countsBrowser().driverStopped, 1);
  assert.equal(snapshot.session.timelineEvents.length, 1); assert.equal(snapshot.session.pressureTimeline.length, 1);
  assert.equal(snapshot.session.conversation?.failure?.causeCode, expected);
  const ended = await h.api.endSession(h.session.sessionId); assert.equal(ended.pressureDebrief?.completionKind, "partial"); assert.equal(ended.timelineEvents.length, 1);
});

test("second calibration with no blocks records its timeout and keeps the committed turn intact", async (context) => {
  const h = await browser(context); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2); await h.beginCallerEnd(2);
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  assert.equal(h.controller.snapshot().technical?.causeCode, "CALIBRATION_TIMEOUT");
  assert.equal(h.controller.snapshot().error, "LEARNER_AUDIO_FAILED"); assert.equal(h.counts().opened, 1);
  assert.equal(h.controller.snapshot().session.timelineEvents.length, 1); assert.equal(h.controller.snapshot().session.pressureTimeline.length, 1);
  assert.equal(h.countsBrowser().driverStopped, 1);
});

test("browser automatically runs all three ordered turns without a fourth learner window", async (context) => {
  const h = await browser(context, { texts: ["main share nahi karunga", "थोड़ा समय चाहिए", "Main independently verify karunga"] }); await h.start();
  for (let turn = 1; turn <= 3; turn++) { await h.endCaller(turn); await h.speak(); await h.callerReady(turn + 1); }
  assert.equal(h.controller.snapshot().session.turnNumber, 3); assert.equal(h.counts().opened, 3);
  assert.deepEqual(h.controller.snapshot().session.timelineEvents.map((event) => event.behavior.label), ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY"]);
  assert.deepEqual(h.controller.snapshot().session.pressureTimeline.map((point) => point.callerPressureLevel), [0, 1, 1]);
  await h.endCaller(4); assert.equal(h.completed.length, 1); assert.equal(h.players.length, 4); assert.equal(h.counts().opened, 3);
});

test("browser safe word stops shared microphone without preparing terminal audio", async (context) => {
  const h = await browser(context, { texts: ["stop simulation"] }); await h.start(); await h.endCaller(1); await h.speak();
  await until(() => h.controller.snapshot().state === "STOPPED");
  assert.equal(h.controller.snapshot().session.terminalState, "SAFE_WORD"); assert.equal(h.players.length, 1);
  assert.equal(h.counts().opened, 1); assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.completed.length, 1);
});

test("late caller observation from previous turn cannot overwrite the next caller phase", async (context) => {
  const h = await setup(context); let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session;
  await assert.rejects(h.action(state.sessionId, "caller-ended", { audioClockId: clock, turnNumber: 0, responseId: "system.opening", atMs: 1000 }));
  assert.equal(h.store.get(state.sessionId).conversation?.phase, "CALLER_PREPARING"); assert.equal(h.store.get(state.sessionId).timelineEvents.length, 1);
});

test("new conversation has a distinct session and browser clock and cannot resume a started clock", async (context) => {
  const h = await setup(context), fresh = await h.create(); assert.notEqual(h.session.sessionId, fresh.sessionId);
  await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const other = "00000000-0000-4000-8000-000000000077";
  await assert.rejects(h.action(h.session.sessionId, "start", { audioClockId: other }));
  const second = await h.action(fresh.sessionId, "start", { audioClockId: other });
  assert.equal(second.conversation?.audioClockId, other); assert.equal(second.timelineEvents.length, 0);
});

test("session timeout cancels playback, blocks future callbacks and records typed failure", async (context) => {
  const h = await browser(context); await h.start(); h.advance(600001); h.players[0]!.start();
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR"); h.players[0]!.end();
  assert.equal(h.controller.snapshot().error, "SESSION_TIMEOUT"); assert.equal(h.counts().opened, 0);
  assert.equal(h.countsBrowser().driverStopped, 1);
});

test("Finish with learner activity before actual caller end fails closed without policy/event", async (context) => {
  const h = await setup(context); await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const state = await h.playback(h.session, 0, 1000), token = await h.open(state), input = h.facts(state, 0, 1000);
  input.events[2]!.at.monotonicMs = 999;
  assert.equal((await h.post(state.sessionId, "finish", input, token)).status, 400);
  assert.equal(h.store.get(state.sessionId).timelineEvents.length, 0); assert.equal(h.counts().finished, 0);
});

test("credit: cached opening costs zero TTS even when configured prior TTS use exceeds the cap", async (context) => {
  const h = await setup(context, { cap: 0, initialTtsUsedUnits: 5, cachedResponses: ["system.opening"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const result = await h.api.getCallerAudio!(state.sessionId, 0, "system.opening", new AbortController().signal);
  assert.equal(result.asset.cacheHit, true); assert.equal(result.asset.providerAttempts, 0);
  await h.playback(state, 0, 1000); await h.api.getSession(state.sessionId);
  assert.deepEqual(h.counts(), { opened: 0, cancelled: 0, finished: 0, tts: 0 });
});

test("credit: one cache miss reserves exactly one configured TTS unit and a later miss is rejected before synthesis", async (context) => {
  const h = await setup(context, { cap: 1 }); const state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const first = (await h.turn(state, 0)).turn.session;
  assert.equal(h.counts().tts, 1); assert.equal(first.timelineEvents.length, 1);
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 1, "authority", new AbortController().signal), (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 429);
  assert.equal(h.counts().tts, 1); assert.equal(h.counts().opened, 1);
});

test("credit: one Prisma window costs one STT unit; Finish/classifier/policy/event/debrief cost zero extra", async (context) => {
  const h = await setup(context, { cap: 1, cachedResponses: ["system.opening", "authority"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  const first = (await h.turn(state, 0)).turn.session;
  assert.equal(first.timelineEvents.length, 1); assert.equal(first.pressureTimeline.length, 1); assert.ok(first.pressureDebrief);
  await h.api.getSession(state.sessionId); await h.api.getSession(state.sessionId);
  const second = await h.playback(first, 5000, 6000);
  const denied = await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 2, microphoneConsent: true });
  assert.equal(denied.status, 429); assert.match(JSON.stringify(await denied.json()), /Configured stt project-unit cap reached/u);
  assert.deepEqual(h.counts(), { opened: 1, cancelled: 1, finished: 1, tts: 0 });
  assert.equal(second.maxTurns, 3, "max-turn metadata does not reserve three turns upfront");
});

test("credit: controlled two-turn flow with cap four covers two STT and two TTS misses plus configured prior TTS use", async (context) => {
  const h = await setup(context, { cap: 4, initialTtsUsedUnits: 1, cachedResponses: ["system.opening"], texts: ["थोड़ा समय चाहिए", "Main independently verify karunga"] });
  let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session; state = (await h.turn(state, 5000)).turn.session;
  state = await h.playback(state, 10000, 11000);
  assert.equal(state.state, "COMPLETED"); assert.equal(state.turnNumber, 2); assert.equal(state.pressureDebrief?.completionKind, "complete");
  assert.deepEqual(h.counts(), { opened: 2, cancelled: 2, finished: 2, tts: 2 });
  await h.api.getSession(state.sessionId); await h.api.endSession(state.sessionId);
  assert.equal(h.counts().opened, 2); assert.equal(h.counts().tts, 2);
});

test("credit: exhausted STT allocation denies before the first actual provider connection", async (context) => {
  const h = await setup(context, { cap: 0, cachedResponses: ["system.opening"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); await h.playback(state, 0, 1000);
  const result = await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 1, microphoneConsent: true });
  assert.equal(result.status, 429); assert.match(JSON.stringify(await result.json()), /Configured stt/u);
  assert.equal(h.counts().opened, 0); assert.equal(h.counts().tts, 0); assert.equal(h.store.get(state.sessionId).timelineEvents.length, 0);
});

test("credit: exhausted TTS allocation denies cache miss before an actual synthesis request", async (context) => {
  const h = await setup(context, { cap: 0 }); const state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 0, "system.opening", new AbortController().signal), (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 429);
  assert.equal(h.counts().tts, 0); assert.equal(h.counts().opened, 0);
});

test("credit: failed Prisma connection consumes its one reservation conservatively and is never retried automatically", async (context) => {
  const h = await setup(context, { cap: 1, sttConnectFailure: true, cachedResponses: ["system.opening"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); await h.playback(state, 0, 1000);
  const body = { audioClockId: clock, turnNumber: 1, microphoneConsent: true };
  assert.equal((await h.post(state.sessionId, "start", body)).ok, false); assert.equal(h.counts().opened, 1);
  assert.equal((await h.post(state.sessionId, "start", body)).status, 429); assert.equal(h.counts().opened, 1);
  assert.equal(h.store.get(state.sessionId).timelineEvents.length, 0);
});

test("credit: failed Timbre synthesis consumes one reservation, with no hidden synthesis retry", async (context) => {
  const h = await setup(context, { cap: 1, ttsFailureAt: 1 }); const state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 0, "system.opening", new AbortController().signal)); assert.equal(h.counts().tts, 1);
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 0, "system.opening", new AbortController().signal), (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 429);
  assert.equal(h.counts().tts, 1); assert.equal(h.counts().opened, 0);
});

test("credit: prior uncommitted windows across sessions exhaust process STT credit before a new session's first learner turn", async (context) => {
  const h = await setup(context, { cap: 2, cachedResponses: ["system.opening"] });
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = attempt === 0 ? h.session : await h.create();
    const state = await h.action(fresh.sessionId, "start", { audioClockId: clock }); await h.playback(state, 0, 1000);
    if (attempt < 2) { const token = await h.open(await h.api.getSession(state.sessionId)); await h.post(state.sessionId, "cancel", {}, token); }
    else {
      const denied = await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 1, microphoneConsent: true });
      assert.equal(denied.status, 429); assert.match(JSON.stringify(await denied.json()), /Configured stt/u);
    }
    assert.equal(h.store.get(state.sessionId).turnNumber, 0); await h.api.endSession(state.sessionId);
  }
  assert.equal(h.counts().opened, 2); assert.equal(h.counts().finished, 0); assert.equal(h.counts().tts, 0);
});

test("read-only credit telemetry exposes loaded caps, remaining units and runtime attempts without spending credit", async (context) => {
  const h = await setup(context, { cap: 4, initialTtsUsedUnits: 1, cachedResponses: ["system.opening"] });
  const initial = await h.api.getRuntimeCredit!();
  assert.equal(initial.cap, 4); assert.equal(initial.reserveCap, 0); assert.equal(initial.sttCostUnits, 1); assert.equal(initial.ttsCostUnits, 1);
  assert.equal(initial.stt.usedUnits, 0); assert.equal(initial.tts.usedUnits, 1); assert.equal(initial.stt.remainingUnits, 4); assert.equal(initial.tts.remainingUnits, 3);
  const started = await h.action(h.session.sessionId, "start", { audioClockId: clock }); await h.playback(started, 0, 1000);
  const after = await h.api.getRuntimeCredit!(); assert.equal(after.bootId, initial.bootId); assert.deepEqual(after.stt, initial.stt); assert.deepEqual(after.tts, initial.tts);
  assert.equal(after.events.length, 0); assert.doesNotMatch(JSON.stringify(after), /apiKey|headers|credential|transcript/iu);
  assert.equal((await fetch(`${h.base}/api/runtime/credit`, { headers: { origin: "https://untrusted.invalid" } })).status, 400);
});

test("cache-rich two-turn run consumes exactly two STT units even when TTS starts exhausted", async (context) => {
  const h = await setup(context, { cap: 2, initialTtsUsedUnits: 2, cachedResponses: ["system.opening", "authority", "system.safe-ending"], texts: ["थोड़ा समय चाहिए", "Main independently verify karunga"] });
  let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session; state = (await h.turn(state, 5000)).turn.session; state = await h.playback(state, 10000, 11000);
  const facts = await h.api.getRuntimeCredit!(); assert.equal(state.state, "COMPLETED"); assert.equal(facts.stt.usedUnits, 2); assert.equal(facts.tts.usedUnits, 2);
  assert.equal(facts.stt.providerAttempts, 2); assert.equal(facts.tts.providerAttempts, 0); assert.equal(facts.events.length, 2);
});

test("local STT validation rejection releases reservation before any provider operation", async (context) => {
  const h = await setup(context, { cap: 1, sttLocalFailure: true, cachedResponses: ["system.opening"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); await h.playback(state, 0, 1000);
  const result = await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 1, microphoneConsent: true });
  assert.equal(result.status, 400); assert.equal((await result.json() as { error: { technical: { providerAttempted: boolean } } }).error.technical.providerAttempted, false);
  const facts = await h.api.getRuntimeCredit!(); assert.equal(facts.stt.usedUnits, 0); assert.equal(facts.stt.providerAttempts, 0); assert.equal(facts.events[0]!.state, "RELEASED"); assert.equal(h.counts().opened, 0);
});

test("duplicate STT start does not make a second reservation or transport", async (context) => {
  const h = await setup(context, { cap: 1, cachedResponses: ["system.opening"] });
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); const listening = await h.playback(state, 0, 1000); const token = await h.open(listening);
  const duplicate = await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 1, microphoneConsent: true });
  assert.equal(duplicate.status, 429); assert.equal((await duplicate.json() as { error: { code: string } }).error.code, "RATE_LIMITED");
  const facts = await h.api.getRuntimeCredit!(); assert.equal(facts.stt.usedUnits, 1); assert.equal(facts.events.length, 1); assert.equal(h.counts().opened, 1);
  await h.post(state.sessionId, "cancel", {}, token);
});

test("post-STALLED TTS credit denial preserves the committed event and exact caller-preparation cause", async (context) => {
  const h = await browser(context, { cap: 1 }); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2);
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  const snapshot = h.controller.snapshot(), session = await h.api.getSession(h.session.sessionId);
  assert.equal(snapshot.error, "CREDIT_LIMIT_REACHED"); assert.equal(snapshot.technical?.stage, "TTS_CREDIT_GUARD"); assert.equal(snapshot.technical?.causeCode, "CREDIT_LIMIT_REACHED");
  assert.equal(snapshot.technical?.providerAttempted, false); assert.equal(snapshot.technical?.credit?.usedUnits, 1); assert.equal(snapshot.technical?.credit?.costUnits, 1);
  assert.equal(session.currentResponseId, "authority"); assert.equal(session.timelineEvents[0]!.selectedNextResponseId, "authority");
  assert.equal(session.timelineEvents.length, 1); assert.equal(session.pressureTimeline.length, 1); assert.equal(session.pressureDebrief?.completionKind, "partial");
  assert.equal(session.conversation?.failure?.stage, "TTS_CREDIT_GUARD"); assert.equal(h.counts().opened, 1); assert.equal(h.counts().tts, 1);
});

test("post-STALLED non-credit caller provider failure remains specific and preserves the valid learner event", async (context) => {
  const h = await browser(context, { cap: 4, ttsFailureAt: 2 }); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2);
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  const snapshot = h.controller.snapshot(); assert.equal(snapshot.error, "CALLER_AUDIO_FAILED"); assert.equal(snapshot.technical?.stage, "TTS_PROVIDER");
  assert.equal(snapshot.technical?.causeCode, "TTS_PROVIDER_FAILED"); assert.equal(snapshot.technical?.providerAttempted, true);
  assert.equal(snapshot.session.timelineEvents.length, 1); assert.equal(h.counts().opened, 1); assert.equal(h.counts().tts, 2);
});

test("HTTP rate-limit status without a credit cause cannot masquerade as local credit exhaustion", async (context) => {
  const h = await browser(context); h.api.getCallerAudio = async () => { throw new SessionApiError("Capacity", 429, { stage: "CALLER_AUDIO_RESOLUTION", causeCode: "RATE_LIMITED", providerAttempted: false }); };
  await h.start(); await until(() => h.controller.snapshot().state === "ERROR");
  assert.equal(h.controller.snapshot().error, "CALLER_AUDIO_FAILED"); assert.equal(h.controller.snapshot().technical?.causeCode, "RATE_LIMITED"); assert.equal(h.counts().tts, 0);
});

test("actual Prisma adapter performs both canonical learner turns with offline sockets and exactly two reservations", async (context) => {
  let attempts = 0;
  class Socket extends EventEmitter {
    readyState = WebSocket.OPEN as number; bufferedAmount = 0; sent = false;
    constructor(private readonly text: string) { super(); queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "connected", config: { sample_rate: 16000, chunk_size: 512 } })), false)); }
    send(_frame: Uint8Array, _options: unknown, done: () => void) { if (!this.sent) { this.sent = true; this.emit("message", Buffer.from(JSON.stringify({ type: "transcript", text: this.text })), false); } queueMicrotask(done); }
    close(code: number) { this.readyState = WebSocket.CLOSED; queueMicrotask(() => this.emit("close", code)); }
    terminate() { this.readyState = WebSocket.CLOSED; queueMicrotask(() => this.emit("close", 1006)); }
  }
  const recognizer = new PrismaRealtimeSpeechRecognizer({ endpoint: "wss://offline.invalid", headers: {} }, { socketFactory: () => new Socket(++attempts === 1 ? "थोड़ा समय चाहिए" : "Main independently verify karunga") as unknown as WebSocket, limits: { silenceMs: 0, settleMs: 0 } });
  const h = await setup(context, { cap: 2, runtimeRecognizer: recognizer, cachedResponses: ["system.opening", "authority", "system.safe-ending"] });
  let state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); state = (await h.turn(state, 0)).turn.session; state = (await h.turn(state, 5000)).turn.session;
  state = await h.playback(state, 10000, 11000); assert.equal(state.state, "COMPLETED"); assert.equal(attempts, 2); assert.equal(state.terminalState, "SAFE_VERIFIED");
  assert.equal((await h.api.getRuntimeCredit!()).stt.usedUnits, 2);
});

test("mock typing retains its simulation guard without spending runtime Prisma/Timbre balances", async (context) => {
  const h = await setup(context, { cap: 1, cachedResponses: ["system.opening"], texts: ["Main independently verify karunga"] });
  const draft = await h.api.createDemoSession({ scenarioId: "S-01", scenarioVersion: scenario.version, language: "hi-IN" }); await h.api.grantConsent(draft.sessionId);
  await h.api.submitMockTurn(draft.sessionId, "थोड़ा समय चाहिए");
  const simulated = await h.api.getRuntimeCredit!(); assert.equal(simulated.stt.usedUnits, 0); assert.equal(simulated.tts.usedUnits, 0); assert.equal(simulated.simulation.sttUsedUnits, 1);
  const state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); const result = await h.turn(state, 0);
  assert.equal(result.turn.session.turnNumber, 1); assert.equal((await h.api.getRuntimeCredit!()).stt.usedUnits, 1);
});

for (const phase of ["caller", "learner", "settle"] as const) test(`browser End during ${phase} releases resources and ignores stale callbacks`, async (context) => {
  const h = await browser(context, { delayFinish: phase === "settle" }); await h.start();
  h.players[0]!.start();
  if (phase !== "caller") await h.endCaller(1);
  if (phase === "settle") { await h.speak(); await until(() => h.counts().finished === 1); }
  h.controller.stop(); await h.api.endSession(h.session.sessionId); h.release(); h.players[0]!.end(); h.players[0]!.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.controller.snapshot().state, "STOPPED"); assert.equal(h.countsBrowser().driverStopped, 1);
  assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0); assert.equal(h.players.length, 1); assert.equal(h.completed.length, 0);
});

for (const failure of ["caller delivery", "playback", "STT", "credit", "microphone"] as const) test(`browser typed failure: ${failure}`, async (context) => {
  const h = await browser(context, { ...(failure === "caller delivery" ? { ttsFailureAt: 2 } : {}), ...(failure === "STT" ? { sttFailureAt: 2 } : {}), ...(failure === "credit" ? { cap: 3, sttUnits: 2 } : {}) });
  await h.start();
  if (failure === "playback") h.players[0]!.fail();
  else if (failure === "microphone") h.error();
  else {
    await h.endCaller(1);
    await h.speak(); await h.callerReady(2);
    if (["STT", "credit"].includes(failure)) { await h.endCaller(2); if (failure === "STT") await h.speak(); }
  }
  await until(() => h.controller.snapshot().state === "ERROR");
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.completed.length, 0);
  assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, ["STT", "caller delivery", "credit"].includes(failure) ? 1 : 0);
  if (failure === "credit") { assert.equal(h.counts().opened, 1); assert.equal(h.controller.snapshot().error, "CREDIT_LIMIT_REACHED"); }
});

test("5C late start acknowledgement after manual stop is never published", async (context) => {
  const h = await browser(context); let release!: () => void, pending = false;
  const gate = new Promise<void>((resolve) => { release = resolve; }); context.after(release);
  const original = h.api.conversationAction!;
  h.api.conversationAction = async (...args) => {
    const session = await original(...args);
    if (args[1] === "start") { pending = true; await gate; }
    return session;
  };
  h.controller.start(); await until(() => pending); h.controller.stop();
  await h.api.endSession(h.session.sessionId); const count = h.sessions.length;
  release(); await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(h.sessions.length, count); assert.equal(h.controller.snapshot().state, "STOPPED");
  assert.equal(h.players.length, 0); assert.equal(h.countsBrowser().driverStopped, 1);
});

test("5C error stays ERROR when End opens its partial debrief or cleanup is repeated", async (context) => {
  const h = await browser(context); await h.start(); h.error();
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  const before = await h.api.getSession(h.session.sessionId), ended = await h.api.endSession(h.session.sessionId);
  assert.deepEqual(ended, before); h.controller.stop(); h.controller.dispose();
  assert.equal(h.controller.snapshot().state, "ERROR"); assert.equal(h.countsBrowser().driverStopped, 1);
});

test("5C synchronous stop at committed-turn callback cannot prepare the next caller", async (context) => {
  let stop = () => {};
  const h = await browser(context, {}, { onTurn: () => stop() }); stop = () => h.controller.stop();
  await h.start(); await h.endCaller(1); await h.speak();
  await until(() => h.store.get(h.session.sessionId).timelineEvents.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 25)); await h.api.endSession(h.session.sessionId);
  assert.equal(h.controller.snapshot().state, "STOPPED"); assert.equal(h.players.length, 1);
  assert.equal(h.counts().opened, 1); assert.equal(h.countsBrowser().driverStopped, 1);
});

test("5C callbacks from a failed playback cannot acknowledge start or end", async (context) => {
  const h = await browser(context); await h.start(); let acknowledgements = 0;
  const original = h.api.conversationAction!;
  h.api.conversationAction = async (...args) => { if (args[1].startsWith("caller-")) acknowledgements++; return original(...args); };
  h.players[0]!.fail(); h.players[0]!.start(); h.players[0]!.end();
  await until(() => h.controller.snapshot().state === "ERROR");
  assert.equal(acknowledgements, 0); assert.equal(h.counts().opened, 0); assert.equal(h.completed.length, 0);
});

const terminalCases = [
  ["verified first", ["Main independently verify karunga"], "SAFE_VERIFIED", "system.safe-ending"],
  ["disclosed first", ["DUMMY-4821"], "DUMMY_SECRET_DISCLOSED", "system.safe-ending"],
  ["unknown first", ["a quiet blue sky"], "SAFE_FALLBACK", "system.safe-fallback"],
  ["stalled max", Array(3).fill("थोड़ा समय चाहिए"), "MAX_TURNS", "system.safe-ending"],
  ["refused max", Array(3).fill("main share nahi karunga"), "MAX_TURNS", "system.safe-ending"],
  ["complied max", Array(3).fill("main share karunga"), "MAX_TURNS", "system.safe-ending"],
  ["unknown final", ["थोड़ा समय चाहिए", "थोड़ा समय चाहिए", "a quiet blue sky"], "MAX_TURNS", "system.safe-ending"],
  ["verified final", ["थोड़ा समय चाहिए", "थोड़ा समय चाहिए", "Main independently verify karunga"], "SAFE_VERIFIED", "system.safe-ending"],
  ["disclosed final", ["थोड़ा समय चाहिए", "थोड़ा समय चाहिए", "DUMMY-4821"], "DUMMY_SECRET_DISCLOSED", "system.safe-ending"],
] as const;
for (const [name, texts, outcome, responseId] of terminalCases) test(`5C browser natural terminal: ${name}, causal events then one terminal playback then cleanup`, async (context) => {
  const h = await browser(context, { texts: [...texts] }); await h.start();
  for (let index = 0; index < texts.length; index++) { await h.endCaller(index + 1); await h.speak(); await h.callerReady(index + 2); }
  const before = h.controller.snapshot(), count = texts.length;
  assert.equal(before.session.terminalState, outcome); assert.equal(before.session.currentResponseId, responseId);
  assert.equal(before.session.timelineEvents.length, count); assert.equal(before.session.pressureTimeline.length, count);
  assert.notEqual(before.session.state, "COMPLETED"); assert.equal(before.session.pressureDebrief?.completionKind, "in_progress");
  assert.equal(h.completed.length, 0); assert.equal(h.countsBrowser().driverStopped, 1);
  const eventSnapshot = JSON.stringify(before.session.timelineEvents), player = h.players[count]!;
  const credit = await h.api.getRuntimeCredit!();
  h.advance(100); player.start(); player.start();
  await until(() => h.controller.snapshot().session.conversation?.phase === "TERMINAL_CALLER_PLAYING");
  assert.equal(h.controller.snapshot().state, "TERMINAL_CALLER_PLAYING"); assert.equal(h.counts().opened, count);
  h.samples(40, 0.1); h.controller.finishLearner(); h.controller.start();
  assert.equal(h.counts().opened, count); assert.equal(h.players.length, count + 1);
  h.advance(1000); player.end(); player.end();
  await until(() => h.completed.length === 1); const completed = h.completed[0]!;
  player.start(); player.end(); h.error(); h.samples(40, 0.1); h.controller.stop(); h.controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(h.controller.snapshot().state, "COMPLETED"); assert.equal(completed.conversation?.phase, "COMPLETED");
  assert.equal(completed.pressureDebrief?.completionKind, "complete"); assert.equal(completed.pressureDebrief?.terminalOutcome, outcome);
  assert.equal(JSON.stringify(completed.timelineEvents), eventSnapshot);
  assert.deepEqual(completed.pressureTimeline.map((point) => point.callerPressureLevel), [0, 1, 1].slice(0, count));
  assert.equal(completed.timelineEvents.filter((event) => event.complianceMoment).length, outcome === "DUMMY_SECRET_DISCLOSED" ? 1 : 0);
  if (outcome === "DUMMY_SECRET_DISCLOSED") assert.equal(completed.pressureDebrief?.firstComplianceMoment?.turnId, `${completed.sessionId}:turn-${count}`);
  assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.counts().opened, count); assert.equal(h.counts().cancelled, count);
  assert.equal(h.completed.length, 1); assert.equal(h.players.length, count + 1);
  const after = await h.api.getSession(completed.sessionId); assert.deepEqual(after.pressureDebrief, completed.pressureDebrief);
  const finalCredit = await h.api.getRuntimeCredit!();
  assert.equal(finalCredit.stt.usedUnits, credit.stt.usedUnits); assert.equal(finalCredit.tts.usedUnits, credit.tts.usedUnits);
  await assert.rejects(h.api.getCallerAudio!(completed.sessionId, count, responseId, new AbortController().signal));
  assert.equal((await h.post(completed.sessionId, "start", { audioClockId: clock, turnNumber: count + 1, microphoneConsent: true })).status, 503);
  assert.doesNotMatch(JSON.stringify(completed.pressureDebrief), /learner (?:was|felt|is) (?:scared|afraid|nervous|panicked|stressed)/iu);
});

for (const cached of [true, false]) test(`5C terminal cache ${cached ? "HIT" : "MISS"}: one playback and ${cached ? "zero" : "one"} guarded synthesis`, async (context) => {
  const h = await browser(context, { texts: ["Main independently verify karunga"], cachedResponses: ["system.opening", ...(cached ? ["system.safe-ending"] : [])] });
  await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2);
  assert.equal(h.counts().tts, cached ? 0 : 1); assert.equal((await h.api.getRuntimeCredit!()).tts.usedUnits, cached ? 0 : 1);
  h.players[1]!.start(); h.advance(1000); h.players[1]!.end(); h.players[1]!.end(); await until(() => h.completed.length === 1);
  assert.equal(h.players.length, 2); assert.equal(h.counts().tts, cached ? 0 : 1); assert.equal(h.completed.length, 1);
});

for (const phase of ["READY", "CALLER_PREPARING", "CALLER_PLAYING", "CALIBRATING", "LEARNER_LISTENING", "LEARNER_FINALIZING", "TERMINAL_CALLER_PLAYING"] as const) test(`5C manual stop at ${phase} preserves events, never completes or resumes`, async (context) => {
  const h = await browser(context, { texts: ["Main independently verify karunga"], delayFinish: phase === "LEARNER_FINALIZING" });
  let release = () => {}, waiting = false;
  if (phase === "CALLER_PREPARING") {
    const original = h.api.getCallerAudio!, gate = new Promise<void>((resolve) => { release = resolve; }); context.after(release);
    h.api.getCallerAudio = async (...args) => { const value = await original(...args); waiting = true; await gate; return value; };
    h.controller.start(); await until(() => waiting);
  } else if (phase !== "READY") {
    await h.start();
    if (phase === "CALLER_PLAYING") { h.players[0]!.start(); await until(() => h.controller.snapshot().session.conversation?.phase === "CALLER_PLAYING"); }
    if (phase === "CALIBRATING") await h.beginCallerEnd(1);
    if (["LEARNER_LISTENING", "LEARNER_FINALIZING", "TERMINAL_CALLER_PLAYING"].includes(phase)) await h.endCaller(1);
    if (["LEARNER_FINALIZING", "TERMINAL_CALLER_PLAYING"].includes(phase)) { await h.speak(); await until(() => h.counts().finished === 1); }
    if (phase === "TERMINAL_CALLER_PLAYING") { await h.callerReady(2); h.players[1]!.start(); await until(() => h.controller.snapshot().session.conversation?.phase === "TERMINAL_CALLER_PLAYING"); }
  }
  const before = h.store.get(h.session.sessionId), events = JSON.stringify(before.timelineEvents), terminal = before.terminalState;
  h.controller.stop(); const ended = await h.api.endSession(h.session.sessionId);
  release(); h.release(); for (const player of h.players) { player.start(); player.end(); }
  h.samples(40, 0.1); h.controller.start(); h.controller.finishLearner(); h.controller.stop(); h.controller.dispose();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(h.controller.snapshot().state, "STOPPED"); assert.equal(ended.conversation?.phase, "STOPPED"); assert.equal(ended.state, "ENDED_BY_LEARNER");
  assert.equal(ended.terminalState, terminal ?? "LEARNER_ENDED");
  assert.equal(JSON.stringify(ended.timelineEvents), events); assert.equal(ended.pressureTimeline.length, ended.timelineEvents.length);
  assert.equal(ended.pressureDebrief?.completionKind ?? null, ended.timelineEvents.length ? "partial" : null);
  assert.equal(h.completed.length, 0); assert.equal(h.countsBrowser().driverStopped, phase === "READY" ? 0 : 1);
  assert.deepEqual(await h.api.endSession(h.session.sessionId), ended);
});

for (const failure of ["TTS", "cache", "playback", "calibration", "policy"] as const) test(`5C ${failure} failure preserves causal evidence, typed ERROR and cleanup`, async (context) => {
  const h = await browser(context, { texts: ["Main independently verify karunga"], ...(failure === "TTS" ? { ttsFailureAt: 2 } : {}) });
  if (failure === "cache") {
    const original = FileCallerAudioCache.prototype.get;
    context.mock.method(FileCallerAudioCache.prototype, "get", async function(this: FileCallerAudioCache, key: string) {
      if (h.store.get(h.session.sessionId).turnNumber === 1) throw new Error("Offline cache lookup failure");
      return original.call(this, key);
    });
  }
  if (failure === "policy") {
    context.mock.method(AdaptivePolicyEngine.prototype, "decide", () => { throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Offline approved response resolution failure"); });
  }
  await h.start();
  if (failure === "calibration") { await h.beginCallerEnd(1); h.health.audioContextState = "closed"; h.samples(1); }
  else { await h.endCaller(1); await h.speak(); if (failure === "playback") { await h.callerReady(2); h.players[1]!.fail(); } }
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  const state = await h.api.getSession(h.session.sessionId), hasEvent = ["TTS", "cache", "playback"].includes(failure);
  assert.equal(state.state, "ERROR"); assert.equal(state.timelineEvents.length, hasEvent ? 1 : 0);
  assert.equal(state.pressureTimeline.length, state.timelineEvents.length); assert.equal(state.terminalState, hasEvent ? "SAFE_VERIFIED" : null);
  assert.equal(state.pressureDebrief?.completionKind ?? null, hasEvent ? "partial" : null);
  if (failure === "cache") assert.equal(h.controller.snapshot().technical?.stage, "TTS_CACHE");
  if (failure === "policy") assert.equal(h.controller.snapshot().technical?.causeCode, "APPROVED_RESPONSE_UNAVAILABLE");
  assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.completed.length, 0); assert.equal(h.counts().opened, failure === "calibration" ? 0 : 1);
  assert.deepEqual(await h.api.endSession(h.session.sessionId), state);
});

test("5C stop during actual policy resolution cannot commit or prepare another caller", async (context) => {
  const h = await browser(context); let resolved = 0;
  const original = AdaptivePolicyEngine.prototype.decide;
  context.mock.method(AdaptivePolicyEngine.prototype, "decide", function(this: AdaptivePolicyEngine, input: Parameters<AdaptivePolicyEngine["decide"]>[0]) {
    const action = original.call(this, input); resolved++; h.controller.stop();
    h.store.update(endSession(h.store.get(h.session.sessionId), new Date("2026-10-24T01:00:00Z")));
    return action;
  });
  await h.start(); await h.endCaller(1); await h.speak(); await until(() => resolved === 1);
  await new Promise((resolve) => setTimeout(resolve, 25)); const state = await h.api.endSession(h.session.sessionId);
  assert.equal(state.conversation?.phase, "STOPPED"); assert.equal(state.timelineEvents.length, 0);
  assert.equal(h.controller.snapshot().state, "STOPPED"); assert.equal(h.counts().opened, 1); assert.equal(h.players.length, 1);
  assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.completed.length, 0);
});

test("5C duplicate/late Finish and PCM after terminal commit cannot append events or reserve units", async (context) => {
  const h = await setup(context, { texts: ["Main independently verify karunga"] });
  let state = await h.action(h.session.sessionId, "start", { audioClockId: clock }); state = await h.playback(state, 0, 1000);
  const token = await h.open(state), facts = h.facts(state, 0, 1000);
  const first = await h.post(state.sessionId, "finish", facts, token); assert.equal(first.status, 200);
  const committed = RealVoiceTurnResultSchema.parse(await first.json()).turn.session;
  const completed = await h.playback(committed, 5000, 6000), credit = await h.api.getRuntimeCredit!();
  assert.ok((await h.post(state.sessionId, "finish", facts, token)).status >= 400);
  const staleFrame = await fetch(`${h.base}/api/sessions/${state.sessionId}/real-audio/frame`, { method: "POST", headers: {
    "content-type": "application/octet-stream", "x-audio-token": token, "x-audio-sequence": "1", "x-audio-produced-at": "6032" }, body: new Uint8Array(1024) });
  assert.ok(staleFrame.status >= 400);
  await assert.rejects(h.api.getCallerAudio!(state.sessionId, 1, "system.safe-ending", new AbortController().signal));
  assert.equal((await h.post(state.sessionId, "start", { audioClockId: clock, turnNumber: 2, microphoneConsent: true })).status, 503);
  assert.deepEqual((await h.api.getSession(state.sessionId)).timelineEvents, completed.timelineEvents);
  assert.equal(h.counts().opened, 1); assert.equal(h.counts().finished, 1);
  const after = await h.api.getRuntimeCredit!(); assert.equal(after.stt.usedUnits, credit.stt.usedUnits); assert.equal(after.tts.usedUnits, credit.tts.usedUnits);
});

for (const staleState of ["LISTENING", "FINISHING", "ERROR", "COMPLETED"] as const) test(`5E late learner ${staleState} callback from turn 1 cannot mutate turn 2`, async (context) => {
  const captured: { options: AudioControllerOptions; learner: BrowserAudioController }[] = [], original = BrowserAudioController.prototype.prepare;
  context.mock.method(BrowserAudioController.prototype, "prepare", function(this: BrowserAudioController) {
    captured.push({ options: Reflect.get(this, "options") as AudioControllerOptions, learner: this }); return original.call(this);
  });
  const h = await browser(context); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2); await h.endCaller(2);
  assert.equal(h.controller.snapshot().state, "LEARNER_LISTENING");
  const old = captured.find((value) => value.options.turnNumber === 1)!;
  const before = JSON.stringify(h.controller.snapshot()), serverBefore = JSON.stringify(h.store.get(h.session.sessionId));
  const stale: AudioDiagnostics = { ...old.learner.diagnostics, state: staleState, error: staleState === "ERROR" ? new BrowserAudioError("PCM_PIPELINE_FAILED") : null };
  old.options.onChange(stale); h.players[0]!.start(); h.players[0]!.end();
  assert.equal(JSON.stringify(h.controller.snapshot()), before); assert.equal(JSON.stringify(h.store.get(h.session.sessionId)), serverBefore);
  assertRuntimeInvariants(h.controller.snapshot().session, h.controller.snapshot().session.pressureDebrief);
});

test("5E stale learner callbacks cannot resurrect naturally COMPLETED conversation", async (context) => {
  let oldOptions: AudioControllerOptions | undefined; const original = BrowserAudioController.prototype.prepare;
  context.mock.method(BrowserAudioController.prototype, "prepare", function(this: BrowserAudioController) {
    oldOptions = Reflect.get(this, "options") as AudioControllerOptions; return original.call(this);
  });
  const h = await browser(context, { texts: ["Main independently verify karunga"] }); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2); await h.endCaller(2);
  await until(() => h.completed.length === 1); const before = JSON.stringify(h.controller.snapshot());
  oldOptions!.onChange({ ...h.controller.snapshot().diagnostics!, state: "LISTENING", error: null });
  assert.equal(JSON.stringify(h.controller.snapshot()), before); assert.equal(h.controller.snapshot().state, "COMPLETED");
});

test("5E stale server turn-1 deadline cannot cancel active turn-2 capture", async (context) => {
  const deadlines: (() => void)[] = [], original = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", (callback: () => void, ms?: number) => {
    if (ms === 45000) deadlines.push(callback); return original(callback, ms);
  });
  const h = await setup(context); let state = await h.action(h.session.sessionId, "start", { audioClockId: clock });
  state = (await h.turn(state, 0)).turn.session;
  const listening = await h.playback(state, 5000, 6000), token = await h.open(listening);
  assert.equal(deadlines.length, 2); deadlines[0]!();
  const frame = await fetch(`${h.base}/api/sessions/${state.sessionId}/real-audio/frame`, { method: "POST", headers: {
    "content-type": "application/octet-stream", "x-audio-token": token, "x-audio-sequence": "1", "x-audio-produced-at": "6064" }, body: new Uint8Array(1024) });
  assert.equal(frame.status, 200, "Old deadline must not dispose the new token/stream");
  const finish = await h.post(state.sessionId, "finish", h.facts(listening, 5000, 6000), token); assert.equal(finish.status, 200);
  assert.equal(h.store.get(state.sessionId).timelineEvents.length, 2);
});

const failureStages = ["A opening resolution", "B opening fetch", "B opening playback", "C calibration", "D STT start", "E STT stream", "F STT finalize",
  "G classifier", "G policy", "H continuation resolution", "I continuation TTS", "I continuation cache", "J continuation playback", "K terminal resolution", "L terminal playback"] as const;
for (const stage of failureStages) test(`5E failure matrix ${stage}: no phantom behavior/evidence, preserved commit and cleanup`, async (context) => {
  const prior = /^[FGHIJ]/u.test(stage) ? 1 : 0;
  const terminal = stage.startsWith("K") || stage.startsWith("L");
  let restoreResolution = () => {};
  const h = await browser(context, { texts: terminal ? ["Main independently verify karunga"] : ["थोड़ा समय चाहिए", "Main independently verify karunga"],
    ...(stage === "D STT start" ? { sttStartFailureAt: 1 } : {}), ...(stage === "E STT stream" ? { sttFrameFailureAt: 1 } : {}),
    ...(stage === "F STT finalize" ? { sttFailureAt: 2 } : {}), ...(stage === "I continuation TTS" ? { ttsFailureAt: 2 } : {}) });
  const rejectedId = stage.startsWith("A") ? "system.opening" : stage.startsWith("H") ? "authority" : stage.startsWith("K") ? "system.safe-ending" : null;
  if (rejectedId) {
    const original = ApprovedCallerCatalog.prototype.resolveId;
    const resolverMock = context.mock.method(ApprovedCallerCatalog.prototype, "resolveId", function(this: ApprovedCallerCatalog, scenarioId: string, version: string, responseId: string) {
      if (responseId === rejectedId) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Offline resolution failure");
      return original.call(this, scenarioId, version, responseId);
    });
    restoreResolution = () => resolverMock.mock.restore();
  }
  if (stage === "B opening fetch") {
    const original = h.api.getCallerAudio!;
    h.api.getCallerAudio = async (...args) => { await original(...args); throw new SessionApiError("Offline delivery failure", 502,
      { stage: "CALLER_AUDIO_FETCH", causeCode: "TTS_PROVIDER_FAILED", providerAttempted: false }); };
  }
  if (stage === "I continuation cache") {
    const original = FileCallerAudioCache.prototype.get;
    context.mock.method(FileCallerAudioCache.prototype, "get", async function(this: FileCallerAudioCache, key: string) {
      if (h.store.get(h.session.sessionId).turnNumber === 1) throw new Error("Offline cache failure"); return original.call(this, key);
    });
  }
  if (stage === "G classifier") {
    const original = LearnerBehaviorClassifier.prototype.classify;
    context.mock.method(LearnerBehaviorClassifier.prototype, "classify", function(this: LearnerBehaviorClassifier, input: Parameters<LearnerBehaviorClassifier["classify"]>[0]) {
      if (input.activeTactic?.tacticId === "authority") throw new Error("Offline classifier failure"); return original.call(this, input);
    });
  }
  if (stage === "G policy") {
    const original = AdaptivePolicyEngine.prototype.decide;
    context.mock.method(AdaptivePolicyEngine.prototype, "decide", function(this: AdaptivePolicyEngine, input: Parameters<AdaptivePolicyEngine["decide"]>[0]) {
      if (input.turnNumber === 2) throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Offline policy failure"); return original.call(this, input);
    });
  }
  await h.start();
  if (stage === "B opening playback") h.players[0]!.fail();
  else if (stage === "C calibration") { await h.beginCallerEnd(1); h.health.audioContextState = "closed"; h.samples(1); }
  else if (!stage.startsWith("A") && stage !== "B opening fetch") {
    await h.endCaller(1);
    if (!stage.startsWith("D")) {
      await h.speak();
      if (prior) {
        await h.callerReady(2);
        if (stage.startsWith("F") || stage.startsWith("G")) { await h.endCaller(2); await h.speak(); }
        if (stage.startsWith("J")) h.players[1]!.fail();
      } else if (stage.startsWith("L")) { await h.callerReady(2); h.players[1]!.fail(); }
    }
  }
  await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
  restoreResolution();
  const state = await h.api.getSession(h.session.sessionId), expectedCount = terminal ? 1 : prior;
  assertRuntimeInvariants(state, state.pressureDebrief); assert.equal(state.state, "ERROR");
  assert.equal(state.timelineEvents.length, expectedCount); assert.equal(state.pressureTimeline.length, expectedCount);
  assert.deepEqual(state.timelineEvents.map((event) => event.behavior.label), terminal ? ["VERIFIED_INDEPENDENTLY"] : prior ? ["STALLED"] : []);
  assert.equal(state.terminalState, terminal ? "SAFE_VERIFIED" : null); assert.equal(state.pressureDebrief?.firstComplianceMoment ?? null, null);
  assert.equal(h.countsBrowser().driverStopped, 1); assert.equal(h.completed.length, 0);
  const before = JSON.stringify(state), players = h.players.length, opened = h.counts().opened;
  h.controller.stop(); h.controller.dispose(); h.samples(40, 0.1); for (const player of h.players) { player.start(); player.end(); }
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(h.controller.snapshot().state, "ERROR");
  assert.equal(JSON.stringify(await h.api.endSession(state.sessionId)), before);
  assert.equal(h.players.length, players); assert.equal(h.counts().opened, opened);
});

for (const outcome of ["STOPPED", "ERROR"] as const) test(`5E stale learner/VAD notifications remain inert after ${outcome}`, async (context) => {
  let options: AudioControllerOptions | undefined; const original = BrowserAudioController.prototype.prepare;
  context.mock.method(BrowserAudioController.prototype, "prepare", function(this: BrowserAudioController) { options = Reflect.get(this, "options") as AudioControllerOptions; return original.call(this); });
  const h = await browser(context); await h.start(); await h.endCaller(1);
  if (outcome === "STOPPED") { h.controller.stop(); await h.api.endSession(h.session.sessionId); }
  else { h.error(); await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR"); }
  const before = JSON.stringify(h.controller.snapshot());
  for (const state of ["LISTENING", "SPEECH_ACTIVE", "FINISHING", "COMPLETED", "ERROR"] as const) options!.onChange({ ...h.controller.snapshot().diagnostics!, state });
  h.samples(40, 0.1); assert.equal(JSON.stringify(h.controller.snapshot()), before); assert.equal(h.countsBrowser().driverStopped, 1);
});

test("5E completion clears owned timers and queued deadline callbacks cannot revive state", async (context) => {
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>(), cleared = new Set<ReturnType<typeof setTimeout>>();
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  context.mock.method(globalThis, "setTimeout", (callback: () => void, ms?: number) => {
    const timer = originalSet(callback, ms); if ([600000, 65000, 45000, 30000, 10000, 2500].includes(ms ?? 0)) timers.set(timer, callback); return timer;
  });
  context.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { cleared.add(timer); originalClear(timer); });
  const h = await browser(context, { texts: ["Main independently verify karunga"] }); await h.start(); await h.endCaller(1); await h.speak(); await h.callerReady(2); await h.endCaller(2);
  await until(() => h.completed.length === 1); assert.ok(timers.size >= 5);
  for (const timer of timers.keys()) assert.ok(cleared.has(timer), "Every owned long deadline was cleared");
  const before = JSON.stringify(h.controller.snapshot()); for (const callback of timers.values()) callback();
  h.samples(40, 0.1); await Promise.resolve(); assert.equal(JSON.stringify(h.controller.snapshot()), before); assert.equal(h.completed.length, 1);
});

for (const failure of [false, true]) test(`5E ${failure ? "technical failure" : "valid finalized UNKNOWN"} remains distinct from ${failure ? "learner UNKNOWN" : "ERROR"}`, async (context) => {
  const h = await browser(context, { texts: ["a quiet blue sky"], ...(failure ? { sttFailureAt: 1 } : {}) });
  await h.start(); await h.endCaller(1); await h.speak();
  if (failure) {
    await until(() => h.store.get(h.session.sessionId).conversation?.phase === "ERROR");
    const state = await h.api.getSession(h.session.sessionId); assertRuntimeInvariants(state, state.pressureDebrief);
    assert.equal(state.timelineEvents.length, 0); assert.equal(state.behaviorHistory.length, 0); assert.equal(state.terminalState, null);
  } else {
    await h.callerReady(2); await h.endCaller(2); await until(() => h.completed.length === 1);
    const state = h.completed[0]!; assertRuntimeInvariants(state, state.pressureDebrief);
    assert.equal(state.timelineEvents[0]!.behavior.label, "UNKNOWN"); assert.equal(state.terminalState, "SAFE_FALLBACK"); assert.equal(state.state, "COMPLETED");
  }
});
