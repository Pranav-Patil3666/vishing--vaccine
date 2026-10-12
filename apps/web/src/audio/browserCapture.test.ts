import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test, { type TestContext } from "node:test";
import { acquireBrowserMicrophone } from "./browserCapture.js";
import { BrowserAudioController } from "./controller.js";
import { AudioPipelineDiagnostics } from "./diagnostics.js";
import type { AudioForwarder } from "./transport.js";

/** Real worklet source + structured-clone transfers. Browser API doubles, no hardware claim. */
function browser(context: TestContext, failure?: "module" | "node" | "source" | "resume" | "graph") {
  let stops = 0, closed = 0;
  const track = Object.assign(new EventTarget(), { readyState: "live", stop() { stops++; }, getSettings: () => ({ sampleRate: 48000, channelCount: 1, echoCancellation: true, deviceId: "never-expose-device" }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const nativeError = () => new TypeError("Cannot read properties of undefined (reading 'connect')");
  const source = { connect() { if (failure === "graph") throw nativeError(); }, disconnect() {} };
  const mute = { gain: { value: 1 }, connect() {}, disconnect() {} };
  class Context extends EventTarget {
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
  class Worklet extends EventTarget {
    processor: Processor;
    port = { onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: string) => { this.processor.port.onmessage({ data }); deliver(); }, close() {} };
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
    connect() {} disconnect() {}
  }
  function deliver() { while (queued.length) nodes[0]!.port.onmessage?.({ data: queued.shift() }); }
  for (const [name, value] of Object.entries({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: async () => stream } },
    AudioContext: Context, AudioWorkletNode: Worklet, document: Object.assign(new EventTarget(), { hidden: false }) })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
  return { quantum(samples = new Float32Array(128)) { const live = nodes[0]!.processor.process([[samples]]); deliver(); return live; },
    message(data: unknown) { nodes[0]!.port.onmessage?.({ data }); }, counts: () => ({ stops, closed }), mute };
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
