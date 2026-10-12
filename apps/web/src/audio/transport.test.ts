import assert from "node:assert/strict";
import test from "node:test";
import type { PcmFrameMetadata } from "@vaccine/contracts";
import { DevelopmentAudioForwarder } from "./transport.js";

const clock = "00000000-0000-4000-8000-000000000001";
const metadata: PcmFrameMetadata = { sessionId: "s", turnNumber: 1, audioClockId: clock, sequence: 0, producedAtMonotonicMs: 1,
  sampleRateHz: 16000, channels: 1, encoding: "PCM_S16LE", byteLength: 1024, paddedSamples: 0 };
test("forwarding bounds queued audio, reports backpressure and clears cancelled buffers", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/start")) return Response.json({ token: clock, maxDurationMs: 60000 });
    if (String(input).endsWith("/cancel")) return Response.json({ stopped: true });
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  const forwarder = new DevelopmentAudioForwarder("s", "", fetcher); await forwarder.open(clock, 1);
  const buffers = Array.from({ length: 8 }, () => new Uint8Array(1024).fill(3));
  for (const [index, bytes] of buffers.entries()) forwarder.frame(bytes, { ...metadata, sequence: index });
  assert.equal(forwarder.queuedFrames, 8);
  assert.throws(() => forwarder.frame(new Uint8Array(1024), metadata), /could not keep up/u);
  forwarder.cancel(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(buffers.every((bytes) => bytes.every((value) => value === 0))); assert.equal(forwarder.queuedFrames, 0);
});
test("transport failure reports once, cancels pending work and never retries", async () => {
  let frames = 0, errors = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/start")) return Response.json({ token: clock, maxDurationMs: 60000 });
    if (String(input).endsWith("/frame")) { frames++; throw new Error("raw sensitive error"); }
    return Response.json({ stopped: true });
  };
  const forwarder = new DevelopmentAudioForwarder("s", "", fetcher, (error) => { errors++; assert.ok(!error.message.includes("raw sensitive")); });
  await forwarder.open(clock, 1); forwarder.frame(new Uint8Array(1024), metadata);
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(frames, 1); assert.equal(errors, 1);
});

test("browser-native fetch is called without a forwarder receiver for start, frame, finish and cancel", async () => {
  const actions: string[] = [];
  // Node fetch and arrow mocks accept arbitrary receivers; browser Window.fetch rejects them.
  const fetcher: typeof fetch = function (this: unknown, input) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    const action = String(input).split("/").at(-1)!; actions.push(action);
    return Promise.resolve(Response.json(action === "start" ? { token: clock, maxDurationMs: 60000 }
      : action === "finish" ? { frameCount: 1, receivedBytes: 1024, observations: [], speakerBleedValidation: "UNKNOWN", interruptionReportingEnabled: false }
        : { accepted: true }));
  };
  const forwarder = new DevelopmentAudioForwarder("s", "", fetcher, () => assert.fail("unexpected forwarding failure"));
  await forwarder.open(clock, 1);
  forwarder.frame(new Uint8Array(1024), metadata);
  const summary = await forwarder.finish({ sessionId: "s", turnNumber: 1, audioClockId: clock, timingValid: true, events: [] });
  assert.equal(summary.frameCount, 1);
  const cancelled = new DevelopmentAudioForwarder("s", "", fetcher);
  await cancelled.open(clock, 1); cancelled.cancel();
  assert.deepEqual(actions, ["start", "frame", "finish", "start", "cancel"]);
});

test("finish waits for the final frame acknowledgement and retains a validated backend summary", async () => {
  let acknowledge!: (response: Response) => void;
  const actions: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const action = String(input).split("/").at(-1)!; actions.push(action);
    if (action === "start") return Response.json({ token: clock, maxDurationMs: 60000 });
    if (action === "frame") return new Promise<Response>((resolve) => { acknowledge = resolve; });
    return Response.json({ frameCount: 1, receivedBytes: 1024, observations: [], speakerBleedValidation: "UNKNOWN", interruptionReportingEnabled: false });
  };
  const forwarder = new DevelopmentAudioForwarder("s", "", fetcher); await forwarder.open(clock, 1);
  const bytes = new Uint8Array(1024).fill(1); forwarder.frame(bytes, metadata);
  const finishing = forwarder.finish({ sessionId: "s", turnNumber: 1, audioClockId: clock, timingValid: true, events: [] });
  assert.deepEqual(actions, ["start", "frame"]);
  acknowledge(Response.json({ accepted: true })); const summary = await finishing;
  assert.deepEqual(actions, ["start", "frame", "finish"]); assert.equal(summary.frameCount, 1); assert.equal(summary.receivedBytes, 1024);
  assert.ok(bytes.every((value) => value === 0)); assert.equal(forwarder.queuedFrames, 0);
});
