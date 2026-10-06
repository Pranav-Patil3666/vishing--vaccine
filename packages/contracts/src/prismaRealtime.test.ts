import assert from "node:assert/strict";
import test from "node:test";
import {
  PCM_FRAME_BYTES,
  PCM_FRAME_SAMPLES,
  createPcmFrame,
  PcmFrameSchema,
  PcmAudioConfigurationSchema,
  parsePrismaRealtimeEvent,
  pcmFrameDurationMs,
  realtimePacingDelayMs,
  transitionPrismaConnection,
} from "./prismaRealtime.js";

test("PCM configuration constrains encoding, mono sample rates, and exact binary frame length", () => {
  const configuration = PcmAudioConfigurationSchema.parse({ encoding: "PCM_S16LE", channels: 1, frameBytes: 1_024, sampleRateHz: 16_000, language: "en" });
  assert.equal(configuration.frameBytes, PCM_FRAME_BYTES);
  assert.equal(PCM_FRAME_SAMPLES, 512);
  assert.equal(pcmFrameDurationMs(16_000), 32);
  assert.equal(pcmFrameDurationMs(8_000), 64);
  assert.equal(PcmFrameSchema.safeParse(new Uint8Array(1_024)).success, true);
  assert.equal(PcmFrameSchema.safeParse(new Uint8Array(1_023)).success, false);
  assert.equal(PcmFrameSchema.safeParse(new Uint8Array(1_025)).success, false);
  assert.equal(createPcmFrame(new Uint8Array(1_024)).byteLength, 1_024);
  assert.throws(() => createPcmFrame(new Uint8Array(12)), /exactly 1,024 bytes/);
  assert.equal(PcmAudioConfigurationSchema.safeParse({ ...configuration, sampleRateHz: 22_050 }).success, false);
  assert.equal(PcmAudioConfigurationSchema.safeParse({ ...configuration, channels: 2 }).success, false);
});

test("unverified segment-duration capability remains metadata and pacing follows frame cadence", () => {
  const configuration = PcmAudioConfigurationSchema.parse({
    encoding: "PCM_S16LE", channels: 1, frameBytes: 1_024, sampleRateHz: 16_000, language: "en",
    minimumSegmentDurationCapability: { durationMs: 400, verificationStatus: "unverified" },
  });
  assert.equal(realtimePacingDelayMs(configuration, 3, 70), 26);
  assert.throws(() => realtimePacingDelayMs(configuration, -1, 0), /non-negative/);
});

test("documented processing and transcript events normalize fields while server timestamps stay references", () => {
  assert.deepEqual(parsePrismaRealtimeEvent({ type: "processing", timestamp: "2026-10-06T00:00:00.000Z" }), {
    type: "processing", providerTimestamp: "2026-10-06T00:00:00.000Z",
  });
  assert.deepEqual(parsePrismaRealtimeEvent({
    type: "transcript", timestamp: "2026-10-06T00:00:01.000Z", text: "verify", audio_duration_ms: 500,
    segment_id: "seg-1", segment_index: 0, latency: 140,
  }), {
    type: "transcript", providerTimestamp: "2026-10-06T00:00:01.000Z", text: "verify", audioDurationMs: 500,
    segmentId: "seg-1", segmentIndex: 0, latencyMs: 140,
  });
  assert.deepEqual(parsePrismaRealtimeEvent({ type: "processing", timestamp: "bad" }), { type: "unknown", providerType: "processing" });
  assert.deepEqual(parsePrismaRealtimeEvent({ type: "future-event", secret: "ignored" }), { type: "unknown", providerType: "future-event" });
});

test("connection lifecycle validates connect and graceful close transitions", () => {
  assert.equal(transitionPrismaConnection("IDLE", "CONNECTING"), "CONNECTING");
  assert.equal(transitionPrismaConnection("CONNECTING", "CONNECTED"), "CONNECTED");
  assert.equal(transitionPrismaConnection("CONNECTED", "CLOSING"), "CLOSING");
  assert.equal(transitionPrismaConnection("CLOSING", "CLOSED"), "CLOSED");
  assert.throws(() => transitionPrismaConnection("IDLE", "CONNECTED"), /Invalid realtime connection transition/);
});
