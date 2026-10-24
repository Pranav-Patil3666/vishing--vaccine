import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test, { type TestContext } from "node:test";
import { acquireBrowserMicrophone } from "./browserCapture.js";
import { BrowserAudioController } from "./controller.js";
import { AudioPipelineDiagnostics } from "./diagnostics.js";
import type { AudioForwarder } from "./transport.js";
import { ReusableMicrophone } from "./reusableMicrophone.js";
import { summarizeBrowserAudio } from "../../../api/src/browserAudioTiming.js";
import type { BrowserAudioTimingFacts, PcmFrameMetadata } from "@vaccine/contracts";

/** Real worklet source + structured-clone transfers. Browser API doubles, no hardware claim. */
function browser(context: TestContext, failure?: "module" | "node" | "source" | "resume" | "graph") {
  let stops = 0, closed = 0, requested = 0, contexts = 0, disconnected = 0, portsClosed = 0;
  const targets: TrackedEvents[] = [];
  class TrackedEvents extends EventTarget {
    readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    constructor() { super(); targets.push(this); }
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
      if (listener) { const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values); }
      super.addEventListener(type, listener, options);
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
      if (listener) this.listeners.get(type)?.delete(listener); super.removeEventListener(type, listener, options);
    }
  }
  const track = Object.assign(new TrackedEvents(), { readyState: "live", enabled: true, stop() { stops++; track.readyState = "ended"; }, getSettings: () => ({ sampleRate: 48000, channelCount: 1, echoCancellation: true, deviceId: "never-expose-device" }) });
  const stream = { get active() { return track.readyState === "live"; }, getTracks: () => [track], getAudioTracks: () => [track] };
  const nativeError = () => new TypeError("Cannot read properties of undefined (reading 'connect')");
  const source = { connect() { if (failure === "graph") throw nativeError(); }, disconnect() {} };
  const mute = { gain: { value: 1 }, connect() {}, disconnect() {} };
  const contextInstances: Context[] = [];
  class Context extends TrackedEvents {
    constructor() { super(); contexts++; contextInstances.push(this); }
    state = "suspended"; sampleRate = 48000; destination = {};
    audioWorklet = { addModule: async () => { if (failure === "module") throw nativeError(); } };
    createMediaStreamSource() { if (failure === "source") throw nativeError(); return source; }
    createGain() { return mute; }
    async resume() { if (failure === "resume") throw nativeError(); this.state = "running"; }
    async close() { this.state = "closed"; closed++; }
  }
  type Processor = { process(inputs: Float32Array[][]): boolean; port: { onmessage(event: { data: string }): void } };
  const nodes: Worklet[] = [];
  const queued: unknown[] = [];
  class Worklet extends TrackedEvents {
    processor: Processor;
    port = { onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: string) => { this.processor.port.onmessage({ data }); deliver(); }, close() { portsClosed++; } };
    constructor(_context: unknown, name: string, options: unknown) {
      super(); if (failure === "node") throw nativeError();
      nodes.push(this);
      let Constructor!: new (options: unknown) => Processor;
      class Base { port = { onmessage: (_event: { data: string }) => {}, postMessage: (data: unknown, transfer: ArrayBuffer[] = []) => queued.push(structuredClone(data, { transfer })) }; }
      runInNewContext(readFileSync("apps/web/src/audio/capture.worklet.js", "utf8"), {
        sampleRate: 48000, AudioWorkletProcessor: Base, Float32Array,
        registerProcessor: (registered: string, value: typeof Constructor) => { assert.equal(registered, name); Constructor = value; },
      });
      this.processor = new Constructor(options);
    }
    connect() {} disconnect() { disconnected++; }
  }
  function deliver() { while (queued.length) nodes[0]!.port.onmessage?.({ data: queued.shift() }); }
  for (const [name, value] of Object.entries({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: async () => { requested++; return stream; } } },
    AudioContext: Context, AudioWorkletNode: Worklet, document: Object.assign(new TrackedEvents(), { hidden: false }) })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  return { quantum(samples = new Float32Array(128)) { const live = nodes[0]!.processor.process([[samples]]); deliver(); return live; },
    message(data: unknown) { nodes[0]!.port.onmessage?.({ data }); }, counts: () => ({ stops, closed }), mute,
    lifecycle: () => ({ requested, contexts, worklets: nodes.length, trackState: track.readyState, contextState: contextInstances[0]?.state, disconnected, portsClosed,
      listeners: targets.reduce((total, target) => total + [...target.listeners.values()].reduce((sum, values) => sum + values.size, 0), 0) }) };
}

test("48 kHz driver/worklet transfers survive first-block handling, calibration, resampling and exact PCM frames", async (context) => {
  const b = browser(context); let now = 0, frames = 0;
  const forwarder: AudioForwarder = { queuedFrames: 0, async open() {}, cancel() {},
    frame(bytes) { assert.equal(bytes.length, 1024); frames++; bytes.fill(0); }, async finish() { throw new Error("unused"); } };
  const controller = new BrowserAudioController({ sessionId: "s", turnNumber: 1, eligible: () => true,
    acquire: acquireBrowserMicrophone, forwarder: () => forwarder, onChange() {}, readClock: () => now,
    newClockId: () => "00000000-0000-4000-8000-000000000001", developmentDiagnostics: true });
  context.after(() => controller.stop()); await controller.prepare();
  for (let i = 0; i < 450; i++) { now += 128 / 48000 * 1000; assert.equal(b.quantum(), true); }
  assert.equal(controller.diagnostics.error, null); assert.equal(controller.diagnostics.state, "LISTENING");
  assert.equal(controller.diagnostics.sourceRate, 48000); assert.ok(frames > 0);
  assert.equal(controller.diagnostics.pipeline?.firstProcessorCallbackObserved, true);
  assert.equal(controller.diagnostics.pipeline?.firstWorkletMessageReceived, true);
  assert.equal(controller.diagnostics.pipeline?.firstVadBlockConsumed, true);
  assert.equal(controller.diagnostics.pipeline?.firstResampledBlockProduced, true);
  assert.equal(controller.diagnostics.pipeline?.firstPcmFrameProduced, true);
  assert.equal(b.mute.gain.value, 0); assert.ok(!JSON.stringify(controller.diagnostics).includes("never-expose-device"));
  controller.stop(); assert.deepEqual(b.counts(), { stops: 1, closed: 1 });
});

for (const [failure, stage] of [["module", "WORKLET_MODULE_LOAD"], ["node", "WORKLET_NODE_CREATION"], ["source", "SOURCE_NODE_CREATION"], ["resume", "AUDIO_CONTEXT_RESUME"], ["graph", "AUDIO_GRAPH_CONNECTION"]] as const) {
  test(`driver preserves sanitized ${failure} exception at ${stage} and releases the microphone`, async (context) => {
    const b = browser(context, failure), abort = new AbortController(), trace = new AudioPipelineDiagnostics(true);
    try {
      const connection = await acquireBrowserMicrophone(abort.signal, trace);
      await assert.rejects(connection.start(() => {}, () => {}), (error: unknown) => {
        assert.equal((error as { detail: { stage: string } }).detail.stage, stage); return true;
      });
      connection.stop();
    } catch (error) {
      assert.equal((error as { detail: { stage: string } }).detail.stage, stage);
      assert.equal((error as { detail: { exceptionName: string } }).detail.exceptionName, "TypeError");
    } finally { abort.abort(); }
    assert.deepEqual(b.counts(), { stops: 1, closed: 1 });
  });
}

test("malformed worklet payload produces a specific diagnostic without logging or retaining its contents", async (context) => {
  const b = browser(context), abort = new AbortController(), trace = new AudioPipelineDiagnostics(true);
  const connection = await acquireBrowserMicrophone(abort.signal, trace);
  let stage: string | undefined, message: string | undefined;
  await connection.start(() => assert.fail("invalid samples consumed"), (error) => { stage = error.detail?.stage; message = error.detail?.exceptionMessage; connection.stop(); });
  b.message({ samples: "private-payload" });
  assert.equal(stage, "WORKLET_MESSAGE"); assert.equal(message, "Invalid worklet message: expected a native-rate Float32Array block.");
  assert.deepEqual(b.counts(), { stops: 1, closed: 1 });
});

test("actual 48 kHz driver/worklet survives two learner finalizations with one live stream/context and clean PCM windows", async (context) => {
  const b = browser(context), abort = new AbortController(); let now = 0;
  const driver = await acquireBrowserMicrophone(abort.signal), mic = new ReusableMicrophone(driver, () => now);
  context.after(() => mic.stop()); await mic.start((error) => assert.fail(error.message));
  const feed = (count: number, level = 0) => { for (let index = 0; index < count; index++) { now += 128 / 48000 * 1000; assert.equal(b.quantum(new Float32Array(128).fill(level)), true); } };
  const frames: { bytes: Uint8Array; metadata: PcmFrameMetadata }[][] = [], facts: BrowserAudioTimingFacts[] = [];
  let firstVad: object | undefined;
  for (let turn = 1; turn <= 2; turn++) {
    const before = frames.reduce((count, value) => count + value.length, 0);
    feed(150, 0.8); // Caller playback: acknowledged at native rate but no learner consumer/forwarder.
    assert.equal(frames.reduce((count, value) => count + value.length, 0), before);
    const callerEnd = now;
    const pending = mic.calibrate(abort.signal, turn); await Promise.resolve(); feed(300, turn === 1 ? 0.001 : 0.002); const vad = await pending;
    assert.notEqual(vad, firstVad); firstVad = vad; assert.equal(vad.state, "silence");
    assert.ok(Math.abs(vad.noiseFloor - (turn === 1 ? 0.001 : 0.002)) < 1e-6);
    const turnFrames: typeof frames[number] = []; frames.push(turnFrames);
    const forwarder: AudioForwarder = { queuedFrames: 0, async open(_clock, identity) { assert.equal(identity, turn); }, cancel() {},
      frame(bytes, metadata) { turnFrames.push({ bytes: Uint8Array.from(bytes), metadata }); bytes.fill(0); },
      async finish(value) { facts.push(value); return summarizeBrowserAudio(value, turnFrames.length); } };
    const learner = new BrowserAudioController({ sessionId: "reuse-session", turnNumber: turn, eligible: () => true,
      acquire: async () => mic.lease(turn), createVad: () => vad, forwarder: () => forwarder, onChange() {}, readClock: () => now,
      sessionClock: { origin: 0, audioClockId: "00000000-0000-4000-8000-000000000001", callerStartedAtMs: callerEnd - 100, callerEndedAtMs: callerEnd } });
    await learner.prepare(); assert.equal(learner.diagnostics.frameCount, 0); assert.equal(learner.diagnostics.latestStartMs, null);
    assert.equal(learner.diagnostics.segmentCount, 0); assert.equal(learner.diagnostics.error, null);
    feed(20); feed(100, 0.1); feed(150); await learner.finish();
    assert.equal(learner.diagnostics.state, "COMPLETED"); assert.ok(turnFrames.length > 0);
    assert.equal(turnFrames[0]!.metadata.sequence, 0); assert.ok(turnFrames[0]!.bytes.every((value) => value === 0), "no previous speech/caller/partial PCM in new window");
    assert.deepEqual(turnFrames.map((value) => value.metadata.sequence), turnFrames.map((_, index) => index));
    assert.ok(turnFrames.every((value) => value.metadata.turnNumber === turn && value.bytes.length === 1024));
    assert.deepEqual(b.counts(), { stops: 0, closed: 0 }); assert.equal(driver.health?.().workletState, "running");
    assert.equal(driver.health?.().tracksLive, true); assert.equal(driver.health?.().audioContextState, "running");
    assert.equal(mic.snapshot().mode, "DISCARD");
  }
  assert.equal(facts.length, 2); assert.equal(facts[0]!.audioClockId, facts[1]!.audioClockId);
  assert.deepEqual(facts.map((value) => value.turnNumber), [1, 2]); assert.ok(facts[1]!.events[0]!.at.monotonicMs > facts[0]!.events.at(-1)!.at.monotonicMs);
  assert.deepEqual({ ...b.lifecycle(), listeners: undefined }, { requested: 1, contexts: 1, worklets: 1, trackState: "live", contextState: "running", disconnected: 0, portsClosed: 0, listeners: undefined });
  mic.stop(); assert.deepEqual(b.counts(), { stops: 1, closed: 1 }); assert.equal(b.lifecycle().listeners, 0);
  assert.equal(b.lifecycle().disconnected, 1); assert.equal(b.lifecycle().portsClosed, 1); assert.equal(b.quantum(), false);
});
