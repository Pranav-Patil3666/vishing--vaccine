import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { CaptureConnection, CaptureHealth } from "./browserCapture.js";
import { BrowserAudioError } from "./errors.js";
import { ReusableMicrophone } from "./reusableMicrophone.js";

async function microphone(context: TestContext) {
  let now = 0, starts = 0, stops = 0, flushes = 0;
  let receive: (samples: Float32Array) => void = () => {};
  const health: CaptureHealth = { streamActive: true, audioTrackCount: 1, tracksLive: true, tracksEnabled: true, audioContextState: "running", workletState: "running" };
  const driver: CaptureConnection = { sampleRate: 16000, settings: {}, health: () => ({ ...health }),
    async start(samples) { starts++; receive = samples; }, async flush(options) { assert.equal(options?.keepAlive, true); flushes++; },
    stop() { stops++; health.tracksLive = false; health.audioContextState = "closed"; health.workletState = "stopped"; }, playMockCaller() { assert.fail("No local cue"); } };
  const errors: BrowserAudioError[] = [], mic = new ReusableMicrophone(driver, () => now);
  context.after(() => mic.stop()); await mic.start((error) => errors.push(error));
  const feed = (count = 38, level = 0) => { for (let index = 0; index < count; index++) { now += 20; const samples = new Float32Array(320).fill(level); receive(samples); assert.ok(samples.every((value) => value === 0)); } };
  const calibrate = async (turn: number, level = 0) => { const pending = mic.calibrate(new AbortController().signal, turn); await Promise.resolve(); feed(38, level); return pending; };
  return { mic, driver, health, feed, calibrate, errors, clock: (value: number) => { now = value; }, counts: () => ({ starts, stops, flushes }) };
}
const cause = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof BrowserAudioError); assert.equal(error.technical?.stage, "CALIBRATION");
  assert.equal(error.technical?.causeCode, expected); assert.equal(error.technical?.providerAttempted, false); return true;
};

test("two turn-local calibrations and leases reuse one healthy session driver with distinct VAD state", async (context) => {
  const h = await microphone(context), first = await h.calibrate(1, 0.001);
  const lease = h.mic.lease(1); let firstBlocks = 0; await lease.start(() => { firstBlocks++; }, assert.fail);
  h.feed(8, 0.1); first.process(0.1, 140, 1000); assert.equal(first.state, "speech");
  await lease.flush(); lease.stop(); h.feed(40, 0.2); assert.equal(firstBlocks, 8);
  assert.equal(h.mic.snapshot().mode, "DISCARD"); assert.equal(h.health.tracksLive, true); assert.equal(h.counts().stops, 0);
  const second = await h.calibrate(2, 0.003);
  assert.notEqual(second, first); assert.equal(second.state, "silence"); assert.ok(Math.abs(second.noiseFloor - 0.003) < 1e-6);
  assert.deepEqual(second.process(0, 20, 3000), []);
  const next = h.mic.lease(2); let secondBlocks = 0; await next.start(() => { secondBlocks++; }, assert.fail);
  lease.stop(); h.feed(3, 0.1); assert.equal(secondBlocks, 3); assert.equal(firstBlocks, 8);
  assert.deepEqual(h.counts(), { starts: 1, stops: 0, flushes: 3 });
  assert.equal(h.mic.snapshot().calibrationCount, 2); assert.equal(h.errors.length, 0);
  h.mic.stop(); h.mic.stop(); assert.equal(h.counts().stops, 1);
});

test("a reentrant calibration is rejected without replacing the current callback/window", async (context) => {
  const h = await microphone(context), abort = new AbortController();
  const pending = h.mic.calibrate(abort.signal, 1);
  await assert.rejects(h.mic.calibrate(abort.signal, 1), cause("CALIBRATION_REENTRANT"));
  h.feed(); await pending; assert.equal(h.mic.snapshot().calibrationCount, 1);
  await assert.rejects(h.mic.calibrate(abort.signal, 1), cause("INVALID_TURN_STATE"));
});

for (const [change, expected] of [
  [{ streamActive: false }, "MEDIA_STREAM_ENDED"], [{ audioTrackCount: 0 }, "MEDIA_STREAM_ENDED"],
  [{ tracksLive: false }, "MEDIA_STREAM_ENDED"], [{ tracksEnabled: false }, "MICROPHONE_DISABLED"],
  [{ audioContextState: "closed" }, "AUDIO_CONTEXT_CLOSED"], [{ audioContextState: "suspended" }, "AUDIO_CONTEXT_SUSPENDED"],
  [{ workletState: "flushed" }, "WORKLET_UNAVAILABLE"],
] as const) test(`re-arm rejects unhealthy resource ${expected} before any turn transport`, async (context) => {
  const h = await microphone(context); await h.calibrate(1); const lease = h.mic.lease(1); lease.stop();
  Object.assign(h.health, change);
  await assert.rejects(h.mic.calibrate(new AbortController().signal, 2), cause(expected));
  assert.equal(h.mic.snapshot().calibrationCount, 1); assert.equal(h.counts().flushes, 1);
});

test("stale/wrong turn identities and duplicate lease start cannot attach another subscriber", async (context) => {
  const h = await microphone(context); await assert.rejects(h.mic.calibrate(new AbortController().signal, 2), cause("INVALID_TURN_STATE"));
  await h.calibrate(1); assert.throws(() => h.mic.lease(2), cause("INVALID_TURN_STATE"));
  const lease = h.mic.lease(1); await lease.start(() => {}, assert.fail);
  await assert.rejects(lease.start(() => {}, assert.fail), cause("INVALID_TURN_STATE"));
  assert.throws(() => h.mic.lease(1), cause("INVALID_TURN_STATE"));
});

test("stop during second calibration cancels once and late audio cannot revive it", async (context) => {
  const h = await microphone(context); await h.calibrate(1); h.mic.lease(1).stop();
  const pending = h.mic.calibrate(new AbortController().signal, 2), rejected = assert.rejects(pending, cause("INVALID_TURN_STATE"));
  h.mic.stop(); await rejected; h.feed();
  assert.equal(h.mic.snapshot().mode, "STOPPED"); assert.equal(h.counts().stops, 1);
});

test("abort while the turn reset is pending never attaches a late calibration callback", async (context) => {
  const h = await microphone(context), abort = new AbortController(); let release!: () => void;
  h.driver.flush = () => new Promise<void>((resolve) => { release = resolve; });
  const rejected = assert.rejects(h.mic.calibrate(abort.signal, 1), cause("INVALID_TURN_STATE"));
  abort.abort(); await rejected; release(); await Promise.resolve(); h.feed();
  assert.equal(h.mic.snapshot().mode, "DISCARD");
});

test("missing calibration blocks report CALIBRATION_TIMEOUT instead of an internal/provider error", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await microphone(context);
  const rejected = assert.rejects(h.mic.calibrate(new AbortController().signal, 1), cause("CALIBRATION_TIMEOUT"));
  await Promise.resolve(); context.mock.timers.tick(2500); await rejected;
  assert.equal(h.mic.snapshot().mode, "DISCARD"); assert.equal(h.counts().stops, 0);
});

test("invalid calibration clock/input preserves a precise local cause", async (context) => {
  const h = await microphone(context), rejected = assert.rejects(h.mic.calibrate(new AbortController().signal, 1), cause("CALIBRATION_INVALID_INPUT"));
  await Promise.resolve(); h.feed(2); h.clock(-1000); h.feed(1); await rejected;
});
