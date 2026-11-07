import assert from "node:assert/strict";
import test from "node:test";
import { mono, pcm16le, PcmFrameAssembler, StreamingResampler, rms } from "./pcm.js";

test("PCM16LE clamps endpoints, clipping and representative finite/nonfinite values", () => {
  const bytes = pcm16le(Float32Array.of(-2, -1, -0.5, 0, 0.5, 1, 2, NaN));
  const view = new DataView(bytes.buffer);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => view.getInt16(i * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
  assert.deepEqual([...bytes.slice(0, 2)], [0, 128]);
});
test("mono downmix averages channels and rejects unequal channel sizes", () => {
  assert.deepEqual([...mono([Float32Array.of(1, -1), Float32Array.of(-1, 1)])], [0, 0]);
  assert.throws(() => mono([new Float32Array(1), new Float32Array(2)]));
  assert.equal(rms(Float32Array.of(0.5, -0.5)), 0.5);
});
for (const rate of [8000, 16000, 44100, 48000]) {
  test(`streaming resampling at ${rate} Hz preserves sample count and arbitrary chunk continuity`, () => {
    const source = Float32Array.from({ length: rate + 17 }, (_, i) => Math.sin(i / 23) * 0.3);
    const whole = new StreamingResampler(rate), chunked = new StreamingResampler(rate);
    const expected = [...whole.push(source), ...whole.finish()];
    const actual: number[] = [];
    for (let offset = 0; offset < source.length; offset += 137) actual.push(...chunked.push(source.subarray(offset, offset + 137)));
    actual.push(...chunked.finish());
    assert.deepEqual(actual, expected);
    assert.equal(actual.length, Math.ceil(source.length * 16000 / rate));
    assert.ok(Math.abs(actual.length / 16000 - source.length / rate) <= 1 / 16000);
  });
}
test("resampler fractional state remains stable across a long noninteger stream", () => {
  const resampler = new StreamingResampler(44100);
  let count = 0;
  for (let i = 0; i < 4410; i++) count += resampler.push(new Float32Array(1000).fill(0.2)).length;
  count += resampler.finish().length;
  assert.equal(count, 1_600_000);
});
test("frame assembly buffers leftovers, emits exact frames and explicitly pads the final remainder", () => {
  const frames: Array<{ bytes: Uint8Array; pad: number }> = [];
  const assembler = new PcmFrameAssembler((bytes, pad) => frames.push({ bytes, pad }));
  assembler.push(new Float32Array(100).fill(0.5)); assert.equal(frames.length, 0); assert.equal(assembler.remainderSamples, 100);
  assembler.push(new Float32Array(500).fill(-0.5)); assert.equal(frames.length, 1); assert.equal(assembler.remainderSamples, 88);
  assembler.finish(); assert.equal(frames.length, 2); assert.equal(frames[1]?.pad, 424);
  assert.ok(frames.every(({ bytes }) => bytes.length === 1024));
  assert.ok(frames[1]!.bytes.subarray(88 * 2).every((value) => value === 0));
  assert.equal(assembler.remainderSamples, 0); assembler.finish(); assert.equal(frames.length, 2);
});

test("5E clearing partial resampler/frame state prevents PCM from bleeding into a new window", () => {
  const resampler = new StreamingResampler(44100); resampler.push(new Float32Array(7).fill(0.8)); resampler.clear();
  assert.ok(resampler.push(new Float32Array(441).fill(0)).every((sample) => sample === 0));
  const frames: Uint8Array[] = [], assembler = new PcmFrameAssembler((bytes) => frames.push(bytes));
  assembler.push(new Float32Array(100).fill(0.8)); assembler.clear(); assembler.push(new Float32Array(512).fill(0));
  assert.equal(frames.length, 1); assert.ok(frames[0]!.every((byte) => byte === 0)); assert.equal(assembler.remainderSamples, 0);
});
