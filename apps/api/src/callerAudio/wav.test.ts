import test from "node:test";
import assert from "node:assert/strict";
import { inspectCallerWav, finalizeCallerWav } from "./wav.js";
import { callerWavFixture } from "../testing/callerWavFixture.js";

test("bounded caller WAV inspector reads PCM source duration/rate separately from learner format", () => {
  assert.deepEqual(inspectCallerWav(callerWavFixture()), { byteLength: 1004, channels: 1, sampleRateHz: 48000, durationMs: 10 });
});
test("sanitized observed streaming WAV size sentinels are finalized without changing PCM", () => {
  const original = Buffer.from(callerWavFixture()); original.writeUInt32LE(0xffffffff, 4); original.writeUInt32LE(0xffffffff, 40);
  assert.equal(inspectCallerWav(original).durationMs, 10);
  const finalized = Buffer.from(finalizeCallerWav(original));
  assert.equal(finalized.readUInt32LE(4), finalized.length - 8); assert.equal(finalized.readUInt32LE(40), finalized.length - 44);
  assert.deepEqual(finalized.subarray(44), original.subarray(44)); assert.equal(original.readUInt32LE(4), 0xffffffff);
});
for (const [name, change] of [
  ["truncated", (bytes: Uint8Array) => bytes.slice(0, -1)],
  ["empty", () => new Uint8Array()],
  ["wrong header", (bytes: Uint8Array) => { bytes[0] = 0; return bytes; }],
  ["unsupported sample rate", (bytes: Uint8Array) => { Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).writeUInt32LE(16000, 24); return bytes; }],
  ["unsupported encoding", (bytes: Uint8Array) => { bytes[20] = 3; return bytes; }],
  ["zero samples", () => callerWavFixture(0)],
] as const) test(`reject ${name} caller WAV`, () => { assert.throws(() => inspectCallerWav(change(callerWavFixture()))); });
