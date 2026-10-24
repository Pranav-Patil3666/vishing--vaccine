import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebSocketServer } from "ws";
import test, { type TestContext } from "node:test";
import { TranscriptEventSchema, RealVoiceTurnResultSchema, type BrowserAudioTimingFacts, type SpeechRecognizer, type StreamingRecognitionSession } from "@vaccine/contracts";
import { createApiClient } from "../sessionApi.js";
import { createApiServer, type HealthServerOptions } from "../../../api/src/health.js";
import { InMemorySessionStore } from "../../../api/src/sessionStore.js";
import { MockTimbreSynthesizer } from "../../../api/src/providers/timbre/mockTimbre.js";
import { ApplicationError } from "../../../api/src/errors.js";
import { realVoiceScenarioFixture } from "../../../api/src/testing/realVoiceFixture.js";
import { PrismaRealtimeSpeechRecognizer } from "../../../api/src/providers/prisma/prismaRealtimeRecognizer.js";
import { RealVoiceTurnDetails } from "../components/RealVoiceTurnPanel.js";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { CallerAudioService } from "../../../api/src/callerAudio/service.js";
import { ApprovedCallerCatalog } from "../../../api/src/callerAudio/catalog.js";
import { FileCallerAudioCache } from "../../../api/src/callerAudio/cache.js";
import { TimbreSpeechSynthesizer } from "../../../api/src/providers/timbre/timbreSpeechSynthesizer.js";
import { TIMBRE_PROFILE } from "../../../api/src/providers/timbre/runtimeConfig.js";
import { callerWavFixture } from "../../../api/src/testing/callerWavFixture.js";
import { createCallerPlayback } from "./callerPlayback.js";

const clock = "00000000-0000-4000-8000-000000000001";
function facts(sessionId: string, start: number | null = 1450): BrowserAudioTimingFacts {
  const event = (kind: BrowserAudioTimingFacts["events"][number]["kind"], monotonicMs: number, segmentNumber?: number) => ({
    sessionId, turnNumber: 1, kind, at: { monotonicMs, audioClockId: clock,
      source: kind.startsWith("CALLER") ? "CLIENT_AUDIO_CLOCK" as const : "LOCAL_VAD" as const, precision: "instant" as const },
    availability: "available" as const, ...(segmentNumber === undefined ? {} : { segmentNumber }),
  });
  return { sessionId, turnNumber: 1, audioClockId: clock, timingValid: true, events: [event("CALLER_AUDIO_START", 0), event("CALLER_AUDIO_END", 1000),
    ...(start === null ? [] : [event("LEARNER_SPEECH_START", start, 1), event("LEARNER_SPEECH_END", start + 1000, 1)])].sort((a, b) => a.at.monotonicMs - b.at.monotonicMs) };
}
interface Options { text?: string; cap?: number; configured?: boolean; connectFailure?: boolean; finishFailure?: ApplicationError; stale?: boolean; runtimeRecognizer?: SpeechRecognizer; scenario?: ScenarioDocument; callerAudio?: HealthServerOptions["callerAudio"]; }
async function setup(context: TestContext, options: Options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vishing-real-offline-"));
  const scenario = options.scenario ?? realVoiceScenarioFixture();
  await writeFile(join(directory, "S-01.json"), JSON.stringify(scenario));
  const store = new InMemorySessionStore(); let opened = 0, cancelled = 0, finishes = 0, received = 0, tts = 0;
  let lastBytes: Uint8Array | undefined, releaseFinish: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  let transcriptText = options.text ?? "official channel se verify karunga";
  const recognizer: SpeechRecognizer = {
    transcribe: async () => { throw new Error("runtime must not use mock text transcription"); },
    openStream: (request): StreamingRecognitionSession => {
      opened++; let stopped = false;
      const ready = options.connectFailure ? Promise.reject(new ApplicationError("STT_CONNECTION_FAILED", "Safe connection failure.")) : Promise.resolve();
      void ready.catch(() => {});
      return { ready, sendFrame: async (bytes) => { assert.equal(bytes.length, 1024); lastBytes = bytes; received++; },
        finish: async () => {
          finishes++; if (pending) await pending;
          if (options.finishFailure) throw options.finishFailure;
          return TranscriptEventSchema.parse({ eventId: "offline-prisma-emission", ...request,
            ...(options.stale ? { turnNumber: 99 } : {}), text: transcriptText, normalizationStatus: "normalized",
            segments: [{ text: transcriptText, segmentId: "offline-segment", segmentIndex: 1, providerTimestamp: "2099-01-01T00:00:00.000Z", providerAudioDurationMs: 99999 }],
            providerMetadata: { connectionMs: 12, firstTranscriptMs: 34 } });
        }, cancel: () => { if (!stopped) { stopped = true; cancelled++; } } };
    },
  };
  class NoTts extends MockTimbreSynthesizer { override async synthesize(): Promise<never> { tts++; throw new Error("runtime must not call TTS"); } }
  const server = createApiServer({ environment: "test", scenarioDirectory: directory, sessionStore: store,
    ...(options.configured === false ? {} : { runtimeRecognizer: options.runtimeRecognizer ?? recognizer }), synthesizer: new NoTts(), sttUnits: 1,
    ...(options.callerAudio ? { callerAudio: options.callerAudio, ttsUnits: 1 } : {}),
    budget: { mode: "development", developmentCap: options.cap ?? 10, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`, api = createApiClient(base);
  const session = await api.createDemoSession({ scenarioId: "S-01", scenarioVersion: scenario.version, language: "hi-IN", runtimeMode: "REAL_STT" });
  const path = `${base}/api/sessions/${session.sessionId}/real-audio/`;
  let token = "";
  const start = async (microphoneConsent = true, headers = {}) => {
    const result = await fetch(`${path}start`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ audioClockId: clock, turnNumber: 1, microphoneConsent }) });
    if (result.ok) token = (await result.json() as { token: string }).token;
    return result;
  };
  const frame = (length = 1024, sequence = "0", extraHeaders = {}) => fetch(`${path}frame`, { method: "POST",
    headers: { "content-type": "application/octet-stream", "x-audio-token": token, "x-audio-sequence": sequence, "x-audio-produced-at": "32", ...extraHeaders }, body: new Uint8Array(length).fill(1) });
  const finish = (input = facts(session.sessionId)) => fetch(`${path}finish`, { method: "POST", headers: { "content-type": "application/json", "x-audio-token": token }, body: JSON.stringify(input) });
  return { api, store, session, path, base, start, frame, finish, consent: () => api.grantConsent(session.sessionId),
    counts: () => ({ opened, cancelled, finishes, received, tts }), bytes: () => lastBytes,
    delayFinish: () => { pending = new Promise<void>((resolve) => { releaseFinish = resolve; }); },
    releaseFinish: () => releaseFinish?.(), text: (text: string) => { transcriptText = text; },
    cancel: () => fetch(`${path}cancel`, { method: "POST", headers: { "x-audio-token": token } }) };
}

test("real stream needs both consent checks before any provider attempt", async (context) => {
  const h = await setup(context); assert.equal((await h.start()).status, 409); assert.equal(h.counts().opened, 0);
  await h.consent(); assert.equal((await h.start(false)).status, 400); assert.equal(h.counts().opened, 0);
  assert.equal((await h.start()).status, 200); assert.equal(h.counts().opened, 1); await h.cancel();
});
test("configured credit cap rejects and reserves before connecting, with no automatic retry", async (context) => {
  const h = await setup(context, { cap: 1 }); await h.consent(); await h.start(); await h.cancel();
  assert.equal((await h.start()).status, 429); assert.equal(h.counts().opened, 1);
});
test("unconfigured provider stays unavailable and does not break session creation", async (context) => {
  const h = await setup(context, { configured: false }); await h.consent();
  assert.equal((await h.api.getRealVoiceStatus!(h.session.sessionId)).reason, "DISABLED");
  assert.equal((await h.start()).status, 503); assert.equal(h.counts().opened, 0);
});
test("archived S-01 DRAFT cannot start a real session", async (context) => {
  const draft = JSON.parse(await readFile("content/scenario-candidates/history/S-01-0.1.0-draft.json", "utf8")) as { review_status: string; language: null };
  assert.equal(draft.review_status, "draft"); assert.equal(draft.language, null);
  const server = createApiServer({ environment: "test", scenarioDirectory: "content/scenario-candidates/history" }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const api = createApiClient(`http://127.0.0.1:${address.port}`);
  await assert.rejects(api.createDemoSession({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "hi-IN", runtimeMode: "REAL_STT" }), /approved runtime-eligible/u);
  const mock = await api.createDemoSession({ scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "pending-verification" });
  assert.equal((await api.getRealVoiceStatus!(mock.sessionId)).reason, "CONTENT_UNAVAILABLE");
});

for (const completeLastSegment of [true, false]) test(`real turn aggregates local segments with ${completeLastSegment ? "a complete" : "an unfinished"} final segment`, async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); await h.frame();
  const input = facts(h.session.sessionId);
  const firstStart = input.events.find((event) => event.kind === "LEARNER_SPEECH_START")!;
  const firstEnd = input.events.find((event) => event.kind === "LEARNER_SPEECH_END")!;
  input.events.push({ ...firstStart, segmentNumber: 2, at: { ...firstStart.at, monotonicMs: 2600 } });
  if (completeLastSegment) input.events.push({ ...firstEnd, segmentNumber: 2, at: { ...firstEnd.at, monotonicMs: 3100 } });
  const response = await h.finish(input); assert.equal(response.status, 200);
  const result = RealVoiceTurnResultSchema.parse(await response.json());
  const event = result.turn.learnerTurnEvent;
  assert.equal(event.responseLatency?.valueMs, 450);
  assert.equal(event.speechDuration?.valueMs ?? null, completeLastSegment ? 1650 : null);
  assert.equal(result.audioSummary.observations.length, 2);
  assert.equal(result.turn.session.timelineEvents.length, 1); assert.equal(result.turn.session.pressureTimeline.length, 1);
  assert.equal(h.counts().finishes, 1); assert.equal(h.counts().tts, 0);
});

for (const [text, behavior, responseId, terminal] of [
  ["main share nahi karunga", "REFUSED", "authority", null],
  ["थोड़ा समय चाहिए", "STALLED", "authority", null],
  ["मैं खुद सत्यापन करूंगा", "VERIFIED_INDEPENDENTLY", "system.safe-fallback", "SAFE_VERIFIED"],
  ["main share karunga", "COMPLIED", "fear", null],
  ["DUMMY-4821", "DISCLOSED_DUMMY_SECRET", "system.safe-fallback", "DUMMY_SECRET_DISCLOSED"],
] as const) test(`offline runtime transcript → existing ${behavior} classifier/policy → one canonical event`, async (context) => {
  const h = await setup(context, { text }); await h.consent(); assert.equal((await h.start()).status, 200); assert.equal((await h.frame()).status, 200);
  const response = await h.finish(); assert.equal(response.status, 200);
  const result = RealVoiceTurnResultSchema.parse(await response.json());
  assert.equal(result.turn.learnerTurnEvent.behavior.label, behavior); assert.equal(result.turn.branch.responseId, responseId);
  assert.equal(result.turn.branch.terminalState, terminal); assert.equal(result.approvedResponseText, realVoiceScenarioFixture().responses[responseId]?.text);
  assert.equal(result.turn.session.timelineEvents.length, 1); assert.equal(result.turn.session.pressureTimeline.length, 1);
  assert.equal(result.turn.learnerTurnEvent.responseLatency?.valueMs, 450); assert.equal(result.turn.learnerTurnEvent.speechDuration?.valueMs, 1000);
  assert.equal(result.audioSummary.observations[0]?.overlapCandidate, false);
  assert.equal(result.turn.learnerTurnEvent.interruption.status, "unknown"); assert.equal(result.audioSummary.interruptionReportingEnabled, false);
  assert.equal(result.turn.learnerTurnEvent.callerPressureLevel, 5); assert.ok([2, 5].includes(result.turn.branch.nextPressureLevel));
  assert.ok(result.turn.learnerTurnEvent.observedEvidenceRuleIds.includes("input.prisma_runtime"));
  assert.equal(h.counts().tts, 0); assert.equal(h.counts().cancelled, 1); assert.ok(h.bytes()?.every((byte) => byte === 0));
  assert.doesNotMatch(JSON.stringify(result.turn.learnerTurnEvent), /2099|99999|Uint8Array|"text"|"bytes"|providerTimestamp/u);
  if (behavior === "DISCLOSED_DUMMY_SECRET") { assert.equal(result.turn.learnerTurnEvent.complianceMoment?.segmentIndex, 1); assert.equal(result.turn.learnerTurnEvent.complianceMoment?.approximate, true); }
  assert.equal((await h.start()).status, 503); assert.equal(h.counts().opened, 1);
  assert.equal((await h.frame()).status, 409); assert.equal(h.counts().received, 1);
});
for (const [text, behavior, terminal] of [
  ["मैं पहले इंडिपेंडेंटली वेरिफाई करूंगा।", "VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED"],
  ["Main independently verify karunga, DUMMY-4821.", "DISCLOSED_DUMMY_SECRET", "DUMMY_SECRET_DISCLOSED"],
] as const) test(`canonical S-01 classifier correction preserves transcript and ${terminal} policy/event behavior offline`, async (context) => {
  const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  const h = await setup(context, { text, scenario }); await h.consent(); await h.start(); await h.frame();
  const response = await h.finish(); assert.equal(response.status, 200);
  const result = RealVoiceTurnResultSchema.parse(await response.json());
  assert.equal(result.turn.transcript.text, text); assert.equal(result.segments[0]?.text, text);
  assert.equal(result.turn.learnerTurnEvent.behavior.label, behavior); assert.equal(result.turn.branch.terminalState, terminal);
  assert.equal(result.turn.branch.id, null); assert.equal(result.turn.branch.nextPressureLevel, 0);
  assert.equal(result.turn.branch.responseId, "system.safe-ending");
  assert.equal(result.approvedResponseText, scenario.responses["system.safe-ending"]!.text);
  assert.equal(result.turn.session.state, "COMPLETED");
  assert.equal(result.turn.session.timelineEvents.length, 1); assert.equal(result.turn.session.pressureTimeline.length, 1);
  assert.equal(h.counts().opened, 1); assert.equal(h.counts().finishes, 1); assert.equal(h.counts().cancelled, 1); assert.equal(h.counts().tts, 0);
  assert.ok(h.bytes()?.every((value) => value === 0));
});

// Offline injected recognizer texts: the phonetic-English spelling is synthetic, not a new live trace.
for (const [text, behavior, terminal] of [
  ["Nahi, main independently verify karunga.", "VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED"],
  ["आई विल इंडिपेंडेंटली वेरिफाय।", "VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED"],
  ["I will independently verify.", "VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED"],
  ["Main official number pe call nahi karunga.", "UNKNOWN", "SAFE_FALLBACK"],
  ["Nahi, main independently verify nahi karunga.", "UNKNOWN", "SAFE_FALLBACK"],
] as const) test(`canonical S-01 offline scope/alias replay: ${text}`, async (context) => {
  const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  const h = await setup(context, { text, scenario }); await h.consent(); await h.start(); await h.frame();
  const result = RealVoiceTurnResultSchema.parse(await (await h.finish()).json());
  assert.equal(result.turn.transcript.text, text); assert.equal(result.segments[0]?.text, text);
  assert.equal(result.turn.learnerTurnEvent.behavior.label, behavior); assert.equal(result.turn.branch.terminalState, terminal);
  const responseId = behavior === "VERIFIED_INDEPENDENTLY" ? "system.safe-ending" : "system.safe-fallback";
  assert.equal(result.turn.branch.responseId, responseId); assert.equal(result.approvedResponseText, scenario.responses[responseId]?.text);
  assert.equal(result.turn.branch.id, null); assert.equal(result.turn.branch.nextPressureLevel, 0);
  assert.equal(result.turn.session.state, "COMPLETED"); assert.equal(result.turn.session.recordingEnabled, false);
  assert.equal(result.turn.session.timelineEvents.length, 1); assert.equal(result.turn.session.pressureTimeline.length, 1);
  assert.equal(result.turn.learnerTurnEvent.responseLatency?.valueMs, 450); assert.equal(result.turn.learnerTurnEvent.speechDuration?.valueMs, 1000);
  assert.equal(result.audioSummary.observations[0]?.overlapCandidate, false);
  assert.deepEqual(h.counts(), { opened: 1, cancelled: 1, finishes: 1, received: 1, tts: 0 });
  assert.ok(h.bytes()?.every((byte) => byte === 0));
  const markup = renderToStaticMarkup(createElement(RealVoiceTurnDetails, { result }));
  assert.ok(markup.includes(text)); assert.ok(markup.includes(behavior));
});

test("unknown evidence and real-looking numbers do not manufacture disclosure", async (context) => {
  const h = await setup(context, { text: "123456 DUMMY-OTP-EXAMPLE DUMMY-12345" }); await h.consent(); await h.start(); await h.frame();
  const result = RealVoiceTurnResultSchema.parse(await (await h.finish()).json());
  assert.equal(result.turn.learnerTurnEvent.behavior.label, "UNKNOWN"); assert.equal(result.turn.learnerTurnEvent.complianceMoment, null);
  assert.doesNotMatch(JSON.stringify(result), /123456/u);
});
test("overlap keeps response latency null and cannot enable interruption reporting", async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); await h.frame();
  const result = RealVoiceTurnResultSchema.parse(await (await h.finish(facts(h.session.sessionId, 800))).json());
  assert.equal(result.turn.learnerTurnEvent.responseLatency, null); assert.equal(result.audioSummary.observations[0]?.overlapCandidate, true);
  assert.equal(result.turn.learnerTurnEvent.interruption.status, "unknown");
});
test("no local speech skips transcript finalization/classifier/event mutation", async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); await h.frame(); const response = await h.finish(facts(h.session.sessionId, null));
  assert.equal(response.status, 422); assert.equal((await response.json() as { error: { code: string } }).error.code, "NO_SPEECH");
  assert.equal(h.counts().finishes, 0); assert.equal(h.counts().cancelled, 1); assert.equal(h.store.get(h.session.sessionId).turnNumber, 0);
});
test("empty recognizer output after local speech cannot advance policy", async (context) => {
  const h = await setup(context, { text: "   " }); await h.consent(); await h.start(); await h.frame();
  const response = await h.finish(); assert.equal(response.status, 422);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "STT_EMPTY");
  assert.equal(h.counts().finishes, 1); assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0);
});
for (const failure of ["STT_EMPTY", "STT_TIMEOUT", "STT_CONNECTION_FAILED", "STT_PROTOCOL_ERROR"] as const) test(`${failure} leaves turn/policy/event unchanged and cleans up`, async (context) => {
  const h = await setup(context, { finishFailure: new ApplicationError(failure, "Safe runtime failure.") }); await h.consent(); await h.start(); await h.frame();
  const response = await h.finish(); assert.equal(response.ok, false); assert.equal((await response.json() as { error: { code: string } }).error.code, failure);
  assert.equal(h.store.get(h.session.sessionId).turnNumber, 0); assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0); assert.equal(h.counts().cancelled, 1);
});
test("failed provider connection releases window and remains retryable only by explicit action", async (context) => {
  const h = await setup(context, { connectFailure: true }); await h.consent(); assert.equal((await h.start()).status, 502);
  assert.equal(h.counts().opened, 1); assert.equal(h.counts().cancelled, 1); assert.equal(h.store.get(h.session.sessionId).turnNumber, 0);
});
test("duplicate concurrent Finish requests cannot classify, apply policy or append twice", async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); await h.frame(); h.delayFinish();
  const a = h.finish(), b = h.finish(); await new Promise((resolve) => setTimeout(resolve, 20)); h.releaseFinish();
  const responses = await Promise.all([a, b]); assert.ok(responses.every((response) => response.status === 200));
  assert.equal(h.counts().finishes, 1); assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 1);
});
for (const stop of ["cancel", "end"] as const) test(`${stop} during transcription prevents late continuation and releases provider`, async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); await h.frame(); h.delayFinish();
  const pending = h.finish(); await new Promise((resolve) => setTimeout(resolve, 15));
  if (stop === "end") await h.api.endSession(h.session.sessionId); else await h.cancel();
  h.releaseFinish(); assert.equal((await pending).ok, false);
  assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0); assert.equal(h.counts().cancelled, 1);
});
test("safe word uses existing safe policy and cannot continue to another turn", async (context) => {
  const h = await setup(context, { text: "please stop simulation now" }); await h.consent(); await h.start(); await h.frame();
  const result = RealVoiceTurnResultSchema.parse(await (await h.finish()).json()); assert.equal(result.turn.branch.terminalState, "SAFE_WORD");
  assert.equal(h.counts().cancelled, 1); assert.equal(result.turn.session.recordingEnabled, false); assert.equal(h.counts().tts, 0);
});
test("stale provider turn cannot mutate the active session", async (context) => {
  const h = await setup(context, { stale: true }); await h.consent(); await h.start(); await h.frame();
  assert.equal((await h.finish()).status, 409); assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0); assert.equal(h.counts().cancelled, 1);
});
test("runtime sessions reject mock input and cross-origin/host audio requests", async (context) => {
  const h = await setup(context); await h.consent();
  await assert.rejects(h.api.submitMockTurn(h.session.sessionId, "fake input"), /do not accept mock/u);
  assert.equal((await h.start(true, { origin: "https://attacker.invalid" })).status, 400);
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${h.path}start`, { method: "POST", headers: { host: "attacker.invalid", "content-type": "application/json" } }, (response) => {
      response.resume(); response.on("end", () => resolve(response.statusCode!));
    }); request.on("error", reject); request.end(JSON.stringify({ audioClockId: clock, turnNumber: 1, microphoneConsent: true }));
  });
  assert.equal(status, 400); assert.equal(h.counts().opened, 0);
});
for (const length of [1023, 1025]) test(`runtime rejects ${length}-byte PCM and closes its stream`, async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); assert.equal((await h.frame(length)).status, 400);
  assert.equal(h.counts().received, 0); assert.equal(h.counts().cancelled, 1);
});
test("wrong sequence or browser clock identity cannot reach canonical finalization", async (context) => {
  const h = await setup(context); await h.consent(); await h.start(); assert.equal((await h.frame(1024, "1")).status, 400);
  await h.start(); await h.frame(); const input = facts(h.session.sessionId); input.audioClockId = "00000000-0000-4000-8000-000000000002";
  assert.equal((await h.finish(input)).status, 400); assert.equal(h.store.get(h.session.sessionId).timelineEvents.length, 0);
});
test("actual browser forwarder format routes to runtime and clears PCM after acknowledgements", async (context) => {
  const h = await setup(context); await h.consent(); let result: unknown;
  const forwarder = h.api.createRealAudioForwarder!(h.session.sessionId, () => assert.fail("unexpected frame failure"), (value) => { result = value; });
  await forwarder.open(clock, 1); const bytes = new Uint8Array(1024).fill(1);
  forwarder.frame(bytes, { sessionId: h.session.sessionId, turnNumber: 1, audioClockId: clock, sequence: 0, producedAtMonotonicMs: 32,
    sampleRateHz: 16000, channels: 1, encoding: "PCM_S16LE", byteLength: 1024, paddedSamples: 0 });
  const summary = await forwarder.finish(facts(h.session.sessionId)); assert.equal(summary.frameCount, 1); assert.equal(summary.receivedBytes, 1024);
  assert.equal(RealVoiceTurnResultSchema.parse(result).source, "PRISMA_REALTIME"); assert.ok(bytes.every((value) => value === 0)); assert.equal(forwarder.queuedFrames, 0);
});
test("offline full chain: browser forwarder → runtime route → actual adapter/local WebSocket → existing intelligence → panel", { timeout: 5000 }, async (context) => {
  const provider = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(provider, "listening");
  let frames = 0, emitted = false;
  let resolveProviderClose!: (code: number) => void;
  const providerClosed = new Promise<number>((resolve) => { resolveProviderClose = resolve; });
  provider.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "connected", config: { sample_rate: 16000, chunk_size: 512 } }));
    socket.on("message", (data, binary) => {
      assert.equal(binary, true); const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      assert.equal(bytes.length, 1024); bytes.fill(0); frames++;
      if (!emitted) {
        emitted = true;
        socket.send(JSON.stringify({ type: "speech_start", timestamp: "2099-01-01T00:00:00.000Z" }));
        const second = { type: "transcript", text: "official channel se verify करूंगा", segment_id: "two", segment_index: 2, audio_duration_ms: 99999 };
        socket.send(JSON.stringify(second)); socket.send(JSON.stringify(second));
        socket.send(JSON.stringify({ type: "transcript", text: "मैं", segment_id: "one", segment_index: 1 }));
      }
    });
    socket.on("close", (code) => { resolveProviderClose(code); });
  });
  context.after(() => new Promise<void>((resolve) => provider.close(() => resolve())));
  const address = provider.address(); assert.ok(address && typeof address !== "string");
  const runtimeRecognizer = new PrismaRealtimeSpeechRecognizer({ endpoint: `ws://127.0.0.1:${address.port}`, headers: {} },
    { limits: { silenceMs: 0, settleMs: 20, connectMs: 1000, totalMs: 3000 } });
  const h = await setup(context, { runtimeRecognizer }); await h.consent(); let result: unknown;
  const forwarder = h.api.createRealAudioForwarder!(h.session.sessionId, () => assert.fail("unexpected forwarding failure"), (value) => { result = value; });
  await forwarder.open(clock, 1); const bytes = new Uint8Array(1024).fill(2);
  forwarder.frame(bytes, { sessionId: h.session.sessionId, turnNumber: 1, audioClockId: clock, sequence: 0, producedAtMonotonicMs: 32,
    sampleRateHz: 16000, channels: 1, encoding: "PCM_S16LE", byteLength: 1024, paddedSamples: 0 });
  await forwarder.finish(facts(h.session.sessionId)); const completed = RealVoiceTurnResultSchema.parse(result);
  assert.equal(completed.turn.transcript.text, "मैं official channel se verify करूंगा"); assert.equal(completed.segments.length, 2);
  assert.equal(completed.turn.learnerTurnEvent.behavior.label, "VERIFIED_INDEPENDENTLY"); assert.equal(completed.turn.branch.terminalState, "SAFE_VERIFIED");
  assert.equal(completed.turn.session.timelineEvents.length, 1); assert.equal(completed.turn.session.pressureTimeline.length, 1);
  assert.equal(completed.turn.learnerTurnEvent.responseLatency?.valueMs, 450); assert.equal(completed.turn.learnerTurnEvent.speechDuration?.valueMs, 1000);
  assert.equal(frames, 1); assert.equal(await providerClosed, 1000); assert.equal(h.counts().tts, 0); assert.ok(bytes.every((value) => value === 0));
  const markup = renderToStaticMarkup(createElement(RealVoiceTurnDetails, { result: completed }));
  assert.match(markup, /Transcript · Prisma/u); assert.match(markup, /मैं official channel se verify करूंगा/u);
  assert.match(markup, /VERIFIED_INDEPENDENTLY/u); assert.match(markup, /450 ms/u); assert.match(markup, /1000 ms/u);
  assert.match(markup, /Approved next line · text only/u); assert.match(markup, /Provider segments/u);
});

test("offline approved caller → actual Timbre adapter/fake HTTP → cache → browser callbacks → canonical learner timing", async (context) => {
  const path = await mkdtemp(join(tmpdir(), "caller-cycle-offline-")); context.after(() => rm(path, { recursive: true, force: true }));
  let ttsCalls = 0;
  const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  const h = await setup(context, { scenario, text: "Main independently verify karunga.", callerAudio: (scenarios, reserve) => {
    const catalog = new ApprovedCallerCatalog(scenarios, TIMBRE_PROFILE.voice);
    const synthesizer = new TimbreSpeechSynthesizer(catalog, { apiKey: "offline-fixture" }, async (_url, init) => {
      ttsCalls++; assert.equal(JSON.parse(String(init?.body)).text, scenario.responses["system.opening"]!.text);
      return new Response(callerWavFixture(), { headers: { "content-type": "audio/wav" } });
    });
    return new CallerAudioService(catalog, TIMBRE_PROFILE, new FileCallerAudioCache(path), synthesizer, reserve);
  } });
  await h.consent(); const { asset, blob } = await h.api.getCallerAudio!(h.session.sessionId, 0, "system.opening", new AbortController().signal);
  const element = { onplaying: null as (() => void) | null, onended: null as (() => void) | null, onerror: null,
    play: async () => {}, pause() {}, removeAttribute() {}, load() {} };
  let local = 0, callerStart = 0, callerEnd = 0, revoked = 0;
  const playback = createCallerPlayback(asset, blob, new AbortController().signal, { makeAudio: () => element as unknown as HTMLAudioElement,
    makeUrl: () => "blob:offline", revokeUrl: () => { revoked++; } });
  playback.play(() => { callerStart = local; }, () => { callerEnd = local; }, () => assert.fail("playback failure"));
  local = 200; element.onplaying!(); local = 5000; element.onended!();
  assert.equal(revoked, 1); await h.start(); await h.frame(); const input = facts(h.session.sessionId, 7200);
  input.events.find((event) => event.kind === "CALLER_AUDIO_START")!.at.monotonicMs = callerStart;
  input.events.find((event) => event.kind === "CALLER_AUDIO_END")!.at.monotonicMs = callerEnd;
  const result = RealVoiceTurnResultSchema.parse(await (await h.finish(input)).json());
  assert.equal(result.turn.learnerTurnEvent.responseLatency?.valueMs, 2200);
  assert.equal(result.turn.learnerTurnEvent.callerAudioEndedAt?.monotonicMs, 5000);
  assert.equal(result.turn.learnerTurnEvent.callerAudioEndedAt?.audioClockId, clock);
  assert.equal(result.turn.learnerTurnEvent.behavior.label, "VERIFIED_INDEPENDENTLY"); assert.equal(result.turn.branch.terminalState, "SAFE_VERIFIED");
  assert.equal(result.callerAudio?.available, true); assert.equal(result.callerAudio?.responseId, "system.safe-ending");
  assert.equal(result.turn.session.timelineEvents.length, 1); assert.equal(result.turn.session.pressureTimeline.length, 1);
  assert.equal(ttsCalls, 1); assert.equal(h.counts().cancelled, 1); assert.equal(h.counts().tts, 0);
});
