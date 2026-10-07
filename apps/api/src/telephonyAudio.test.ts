import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicTelephonyAudioTransformer, TelephonyTransformPlanSchema, interruptionDetectionValidated } from "./telephonyAudio.js";

const plan = {
  direction: "caller_playback",
  transformVersion: "audio-plan-v1",
  inputSampleRateHz: 44_100,
  outputSampleRateHz: 8_000,
  mildCompression: { enabled: true, ratio: 2, thresholdDb: -18 },
  noise: { kind: "call_centre", level: 0.01, seed: "reproducible-seed-1" },
  backgroundLoop: "call_centre",
  reproducible: true,
  echoCancellationRequired: true,
  speakerBleedValidated: false,
} as const;

test("telephony plan captures repeatable 8 kHz call-like transform settings", () => {
  const parsed = TelephonyTransformPlanSchema.parse(plan);
  assert.equal(parsed.outputSampleRateHz, 8_000);
  assert.equal(parsed.noise.seed, "reproducible-seed-1");
  assert.equal(parsed.reproducible, true);
});

test("interruption claims stay disabled until echo cancellation and speaker-bleed QA pass", () => {
  const unvalidated = TelephonyTransformPlanSchema.parse(plan);
  assert.equal(interruptionDetectionValidated(unvalidated), false);
  const validated = TelephonyTransformPlanSchema.parse({ ...plan, speakerBleedValidated: true });
  assert.equal(interruptionDetectionValidated(validated), true);
});

test("noise must use a deterministic seed and disabled noise must remain zero", () => {
  assert.equal(TelephonyTransformPlanSchema.safeParse({ ...plan, noise: { kind: "room", level: 0.01, seed: null } }).success, false);
  assert.equal(TelephonyTransformPlanSchema.safeParse({ ...plan, noise: { kind: "none", level: 0.01, seed: null } }).success, false);
});

test("deterministic telephony transform resamples PCM to 8 kHz and reproduces configured degradation", async () => {
  const input = new Uint8Array(1_764);
  for (let i = 0; i < input.length / 2; i++) new DataView(input.buffer).setInt16(i * 2, i * 80 - 6_000, true);
  const transformer = new DeterministicTelephonyAudioTransformer();
  const once = await transformer.transform(input, TelephonyTransformPlanSchema.parse(plan));
  const twice = await transformer.transform(input, TelephonyTransformPlanSchema.parse(plan));
  assert.equal(once.byteLength, 320);
  assert.deepEqual(once, twice);
  await assert.rejects(transformer.transform(new Uint8Array(0), TelephonyTransformPlanSchema.parse(plan)), /non-empty/);
});
