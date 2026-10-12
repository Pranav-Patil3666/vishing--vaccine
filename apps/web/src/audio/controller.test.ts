import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserAudioTimingFacts, PcmFrameMetadata } from "@vaccine/contracts";
import { summarizeBrowserAudio } from "../../../api/src/browserAudioTiming.js";
import type { CaptureConnection } from "./browserCapture.js";
import { BrowserAudioController, type AudioDiagnostics } from "./controller.js";
import { BrowserAudioError } from "./errors.js";
import { DevelopmentAudioForwarder, type AudioForwarder } from "./transport.js";

function harness(options: { permissionError?: BrowserAudioError; frameError?: BrowserAudioError; transport?: AudioForwarder } = {}) {
  let time = 0, stopped = 0, cancelled = 0, acquired = 0, openCount = 0, eligible = true;
  let onSamples: (samples: Float32Array) => void = () => {};
  let onError: (error: BrowserAudioError) => void = () => {};
  let callerEnd: () => void = () => {};
  let completedFacts: BrowserAudioTimingFacts | undefined;
  const states: AudioDiagnostics[] = [], frames: PcmFrameMetadata[] = [];
  const forwarder: AudioForwarder = {
    queuedFrames: 0,
    async open() { openCount++; },
    frame(bytes, metadata) { if (options.frameError) throw options.frameError; assert.equal(bytes.length, 1024); frames.push(metadata); bytes.fill(0); },
    async finish(facts) { completedFacts = facts; return summarizeBrowserAudio(facts, frames.length); },
    cancel() { cancelled++; },
  };
  const connection: CaptureConnection = {
    sampleRate: 16000, settings: { echoCancellation: true, channelCount: 1 },
    async start(samples, error) { onSamples = samples; onError = error; },
    playMockCaller(start, end) { start(); callerEnd = end; }, stop() { stopped++; },
    async flush() {},
  };
  const controller = new BrowserAudioController({ sessionId: "session", turnNumber: 1, eligible: () => eligible,
    acquire: async () => { acquired++; if (options.permissionError) throw options.permissionError; return connection; },
    forwarder: () => options.transport ?? forwarder, readClock: () => time, newClockId: () => "00000000-0000-4000-8000-000000000001",
    onChange: (snapshot) => states.push(snapshot), setDeadline: () => 1 as unknown as ReturnType<typeof setTimeout>, clearDeadline: () => {},
  });
  const feed = (level: number, count: number) => { for (let i = 0; i < count; i++) { time += 20; onSamples(new Float32Array(320).fill(level)); } };
  return { controller, states, frames, feed, connection, onFatal: (error: BrowserAudioError) => onError(error),
    forwarder: options.transport ?? forwarder,
    endCaller: () => callerEnd(), advance: (ms: number) => { time += ms; }, revoke: () => { eligible = false; },
    counts: () => ({ stopped, cancelled, acquired, openCount }), facts: () => completedFacts };
}
test("capture requires explicit prepare and eligibility before requesting permission", async () => {
  const h = harness(); h.controller.requirePermission(); assert.equal(h.counts().acquired, 0);
  h.revoke(); await h.controller.prepare(); assert.equal(h.counts().acquired, 0);
  assert.equal(h.controller.diagnostics.error?.code, "SESSION_NOT_ELIGIBLE");
});

test("successful finish retains the parsed summary and final local facts in a completed state", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0.002, 38); h.feed(0.1, 8); h.feed(0, 15);
  await h.controller.finish();
  assert.ok(h.controller.diagnostics.summary, "valid finish already returns a parsed summary");
  assert.equal(h.controller.diagnostics.summary.frameCount, h.controller.diagnostics.frameCount);
  assert.equal(h.controller.diagnostics.state, "COMPLETED");
  assert.equal(h.counts().stopped, 1); assert.ok(h.controller.diagnostics.frameCount > 0);
  assert.equal(h.controller.diagnostics.segmentCount, 1); assert.ok(h.controller.diagnostics.latestEndMs! > h.controller.diagnostics.latestStartMs!);
  assert.ok(h.controller.diagnostics.noiseFloor > 0); assert.equal(h.controller.diagnostics.settings.echoCancellation, true);
  assert.ok(Object.isFrozen(h.controller.diagnostics.summary)); assert.ok(Object.isFrozen(h.controller.diagnostics.summary.observations));
  assert.ok(Object.isFrozen(h.controller.diagnostics.summary.observations[0]));
  assert.doesNotMatch(JSON.stringify(h.controller.diagnostics), /Float32Array|Uint8Array|ArrayBuffer|deviceId|"pcm"|"samples"|"buffer"/u);
});

test("repeated cleanup and late callbacks preserve completed facts and cannot forward more frames", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0.002, 45); await h.controller.finish();
  const completed = h.controller.diagnostics.summary, frameCount = h.frames.length;
  const finalFacts = { sourceRate: h.controller.diagnostics.sourceRate, noiseFloor: h.controller.diagnostics.noiseFloor, speechOn: h.controller.diagnostics.speechOn };
  h.controller.stop(); h.controller.stop(); await h.controller.finish(); h.feed(0.1, 20); h.onFatal(new BrowserAudioError("TRACK_ENDED"));
  assert.equal(h.controller.diagnostics.state, "COMPLETED"); assert.equal(h.controller.diagnostics.summary, completed);
  assert.equal(h.counts().stopped, 1); assert.equal(h.counts().cancelled, 0); assert.equal(h.frames.length, frameCount);
  assert.equal(h.controller.diagnostics.frameCount, frameCount);
  assert.deepEqual({ sourceRate: h.controller.diagnostics.sourceRate, noiseFloor: h.controller.diagnostics.noiseFloor, speechOn: h.controller.diagnostics.speechOn }, finalFacts);
});

test("explicitly preparing a new check clears the previous result and its measurements", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0.002, 45); await h.controller.finish();
  const oldResult = h.controller.diagnostics.summary; assert.ok(oldResult?.frameCount);
  await h.controller.prepare();
  assert.equal(h.controller.diagnostics.state, "CALIBRATING"); assert.equal(h.controller.diagnostics.summary, null);
  assert.equal(h.controller.diagnostics.frameCount, 0); assert.equal(h.controller.diagnostics.latestStartMs, null);
  assert.equal(h.controller.diagnostics.noiseFloor, 0); assert.equal(h.controller.diagnostics.speechOn, 0);
  assert.equal(h.counts().acquired, 2); assert.ok(oldResult.frameCount > 0); h.controller.stop();
});

test("hard stop cancels the check without a finish request or completion result", async () => {
  const h = harness(); let finished = 0;
  h.forwarder.finish = async () => { finished++; throw new Error("unexpected finish"); };
  await h.controller.prepare(); h.feed(0.002, 45); h.controller.stop();
  assert.equal(h.controller.diagnostics.state, "STOPPED"); assert.equal(h.controller.diagnostics.summary, null);
  assert.equal(finished, 0); assert.equal(h.counts().cancelled, 1); assert.equal(h.counts().stopped, 1);
});

test("duplicate Finish and Prepare clicks stay disabled through flush and response wait", async () => {
  const h = harness(); let resolveFlush!: () => void, resolveResponse!: () => void, finished = 0;
  h.connection.flush = () => new Promise<void>((resolve) => { resolveFlush = resolve; });
  const response = new Promise<void>((resolve) => { resolveResponse = resolve; }), originalFinish = h.forwarder.finish;
  h.forwarder.finish = async (facts) => { finished++; await response; return originalFinish(facts); };
  await h.controller.prepare(); h.feed(0.002, 38); h.feed(0.1, 5);
  const finish = h.controller.finish(); assert.equal(h.controller.diagnostics.state, "FINISHING");
  h.feed(0.1, 1); // Final flush block confirms speech; it must not overwrite FINISHING.
  assert.equal(h.controller.diagnostics.state, "FINISHING"); assert.equal(h.controller.diagnostics.segmentCount, 1);
  await h.controller.finish(); await h.controller.prepare(); assert.equal(h.counts().acquired, 1); assert.equal(finished, 0);
  resolveFlush(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, 1); assert.equal(h.counts().stopped, 1); assert.equal(h.controller.diagnostics.state, "FINISHING");
  const frames = h.frames.length; h.feed(0.1, 5); await h.controller.finish(); assert.equal(h.frames.length, frames);
  resolveResponse(); await finish; await h.controller.finish();
  assert.equal(finished, 1); assert.equal(h.controller.diagnostics.state, "COMPLETED");
});

for (const phase of ["flush", "response"] as const) {
  test(`hard stop during ${phase} prevents a late successful finish from becoming COMPLETED`, async () => {
    const h = harness(); let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    if (phase === "flush") h.connection.flush = () => pending;
    else { const original = h.forwarder.finish; h.forwarder.finish = async (facts) => { await pending; return original(facts); }; }
    await h.controller.prepare(); h.feed(0.002, 45); const finish = h.controller.finish();
    if (phase === "response") await new Promise((done) => setImmediate(done));
    h.controller.stop(); resolve(); await finish;
    assert.equal(h.controller.diagnostics.state, "STOPPED"); assert.equal(h.controller.diagnostics.summary, null);
    assert.equal(h.counts().stopped, 1); assert.equal(h.counts().cancelled, 1);
  });
}

for (const [label, response, exceptionName] of [
  ["HTTP failure", () => new Response("private response body", { status: 503 }), "Error"],
  ["malformed HTTP 200 contract", () => Response.json({ frameCount: 1 }), "ZodError"],
  ["invalid HTTP 200 JSON", () => new Response("{", { status: 200 }), "SyntaxError"],
] as const) {
  test(`finish ${label} stops resources, retains safe local facts and enters ERROR`, async () => {
    const clock = "00000000-0000-4000-8000-000000000001";
    const transport = new DevelopmentAudioForwarder("session", "", async (input) => String(input).endsWith("/start")
      ? Response.json({ token: clock, maxDurationMs: 60000 }) : String(input).endsWith("/finish") ? response() : Response.json({ accepted: true }));
    const h = harness({ transport }); await h.controller.prepare(); h.feed(0.002, 45); await h.controller.finish();
    assert.equal(h.controller.diagnostics.state, "ERROR"); assert.equal(h.controller.diagnostics.summary, null);
    assert.equal(h.controller.diagnostics.error?.detail?.stage, "TRANSPORT_FINISH");
    assert.equal(h.controller.diagnostics.error?.detail?.exceptionName, exceptionName);
    assert.equal(h.counts().stopped, 1); assert.ok(h.controller.diagnostics.frameCount > 0);
    assert.equal(h.controller.diagnostics.sourceRate, 16000); assert.ok(h.controller.diagnostics.noiseFloor > 0);
    assert.equal(h.controller.diagnostics.settings.echoCancellation, true);
    assert.ok(!JSON.stringify(h.controller.diagnostics).includes("private response body"));
  });
}
test("permission/calibration/speech lifecycle emits metadata and exact frames then releases resources", async () => {
  const h = harness(); h.controller.requirePermission(); await h.controller.prepare();
  h.controller.playMockCaller(); assert.equal(h.controller.diagnostics.callerPlaying, false);
  h.feed(0.002, 38); assert.equal(h.controller.diagnostics.state, "LISTENING");
  h.controller.playMockCaller(); h.feed(0.002, 10); h.endCaller(); h.feed(0.002, 10);
  h.feed(0.1, 8); h.feed(0, 15); await h.controller.finish();
  assert.equal(h.controller.diagnostics.state, "COMPLETED"); assert.equal(h.counts().stopped, 1);
  assert.ok(h.frames.length > 0); assert.equal(h.controller.diagnostics.summary?.observations[0]?.overlapCandidate, false);
  assert.ok(h.controller.diagnostics.summary!.observations[0]!.responseLatencyMs! > 0);
  assert.equal(h.controller.diagnostics.summary?.interruptionReportingEnabled, false);
  assert.deepEqual(h.facts()?.events.map((event) => event.kind), ["CALLER_AUDIO_START", "CALLER_AUDIO_END", "LEARNER_SPEECH_START", "LEARNER_SPEECH_END"]);
  assert.ok(h.states.some((state) => state.state === "READY")); assert.ok(h.states.some((state) => state.state === "SPEECH_ACTIVE"));
});
test("early speech is a candidate overlap without fake zero latency or interruption claim", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0.002, 38); h.controller.playMockCaller();
  h.feed(0.1, 8); h.feed(0, 15); h.endCaller(); await h.controller.finish();
  const observation = h.controller.diagnostics.summary?.observations[0];
  assert.equal(observation?.responseLatencyMs, null); assert.equal(observation?.overlapCandidate, true); assert.equal(observation?.interruptionStatus, "unknown");
});
test("silence and unfinished speech do not manufacture speech boundaries or durations", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0, 50); await h.controller.finish();
  assert.equal(h.controller.diagnostics.summary?.observations[0]?.responseLatencyMs, null);
  const active = harness(); await active.controller.prepare(); active.feed(0, 38); active.feed(0.1, 8); await active.controller.finish();
  assert.equal(active.controller.diagnostics.summary?.observations[0]?.speechDurationMs, null);
  assert.equal(active.facts()?.events.filter((event) => event.kind === "LEARNER_SPEECH_END").length, 0);
});
test("denied permission and unavailable device have clear typed retry states", async () => {
  for (const code of ["PERMISSION_DENIED", "NO_INPUT_DEVICE"] as const) {
    const h = harness({ permissionError: new BrowserAudioError(code) }); await h.controller.prepare();
    assert.equal(h.counts().openCount, 0); assert.equal(h.controller.diagnostics.error?.code, code);
    assert.equal(h.controller.diagnostics.state, code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "DEVICE_UNAVAILABLE");
  }
});
for (const code of ["TRACK_ENDED", "AUDIO_CONTEXT_FAILED", "WORKLET_LOAD_FAILED", "TIMING_UNAVAILABLE"] as const) {
  test(`${code} stops capture, discards transient state and prevents later events`, async () => {
    const h = harness(); await h.controller.prepare(); h.feed(0, 38); const count = h.frames.length;
    h.onFatal(new BrowserAudioError(code)); h.feed(0.1, 20);
    assert.equal(h.controller.diagnostics.state, "ERROR"); assert.equal(h.counts().stopped, 1); assert.equal(h.frames.length, count);
    assert.equal(h.controller.diagnostics.timingValid, false);
  });
}
test("hard stop/double stop and consent withdrawal release capture without network waits", async () => {
  const h = harness(); await h.controller.prepare(); h.feed(0, 38); h.controller.stop(); h.controller.stop();
  const count = h.frames.length; h.feed(0.2, 20); assert.equal(h.frames.length, count); assert.equal(h.counts().stopped, 1);
  const revoked = harness(); await revoked.controller.prepare(); revoked.revoke(); revoked.feed(0, 1);
  assert.equal(revoked.counts().stopped, 1); assert.equal(revoked.controller.diagnostics.error?.code, "SESSION_NOT_ELIGIBLE");
});
test("permission completing after stop cannot reopen capture or a forwarding window", async () => {
  let resolve!: (connection: CaptureConnection) => void; let stopped = 0, opened = 0;
  const pending = new Promise<CaptureConnection>((done) => { resolve = done; });
  const controller = new BrowserAudioController({ sessionId: "s", turnNumber: 1, eligible: () => true, acquire: () => pending,
    forwarder: () => { opened++; throw new Error("must not open"); }, onChange: () => {} });
  const prepare = controller.prepare(); controller.stop();
  resolve({ sampleRate: 48000, settings: {}, start: async () => {}, playMockCaller: () => {}, flush: async () => {}, stop: () => { stopped++; } }); await prepare;
  assert.equal(stopped, 1); assert.equal(opened, 0); assert.equal(controller.diagnostics.state, "STOPPED");
});
test("backpressure and processing gaps fail closed rather than delaying learner timing", async () => {
  const h = harness({ frameError: new BrowserAudioError("BACKPRESSURE") }); await h.controller.prepare(); h.feed(0, 45);
  assert.equal(h.controller.diagnostics.error?.code, "BACKPRESSURE"); assert.equal(h.controller.diagnostics.backpressuredFrames, 1);
  const gap = harness(); await gap.controller.prepare(); gap.feed(0, 38); gap.advance(500); gap.feed(0.2, 1);
  assert.equal(gap.controller.diagnostics.error?.code, "TIMING_UNAVAILABLE");
});

test("late open from a stopped attempt cannot stop a newer microphone preparation", async () => {
  let resolveOpen!: () => void;
  const oldOpen = new Promise<void>((resolve) => { resolveOpen = resolve; });
  let firstOpen = true;
  const controller = new BrowserAudioController({ sessionId: "s", turnNumber: 1, eligible: () => true,
    acquire: async () => ({ sampleRate: 16000, settings: {}, start: async () => {}, playMockCaller: () => {}, flush: async () => {}, stop: () => {} }),
    forwarder: () => ({ queuedFrames: 0, open: () => { if (firstOpen) { firstOpen = false; return oldOpen; } return Promise.resolve(); },
      frame: () => {}, finish: async () => summarizeBrowserAudio({ sessionId: "s", turnNumber: 1, audioClockId: "00000000-0000-4000-8000-000000000001", timingValid: true, events: [] }, 0), cancel: () => {} }),
    onChange: () => {}, newClockId: () => "00000000-0000-4000-8000-000000000001",
    setDeadline: () => 1 as unknown as ReturnType<typeof setTimeout>, clearDeadline: () => {},
  });
  const oldPrepare = controller.prepare(); await new Promise((resolve) => setImmediate(resolve));
  controller.stop(); await controller.prepare(); assert.equal(controller.diagnostics.state, "CALIBRATING");
  resolveOpen(); await oldPrepare; assert.equal(controller.diagnostics.state, "CALIBRATING"); controller.stop();
});
