import assert from "node:assert/strict";
import test from "node:test";
import { MockEvonAuthoringAdapter, MockEvonReasoner } from "./evon/mockEvon.js";
import { MockPrismaRealtimeTransport, MockPrismaRecognizer } from "./prisma/mockPrisma.js";
import { MockTimbreSynthesizer } from "./timbre/mockTimbre.js";

test("speech recognizer mock returns only deterministic transcript contract fields", async () => {
  const recognizer = new MockPrismaRecognizer(new Map([["session-1:0", "I will verify independently"]]));
  const transcript = await recognizer.transcribe({
    input: { bytes: new Uint8Array([1]) },
    language: "pending-verification",
    mode: "turn",
    sessionId: "session-1",
    turnNumber: 0,
  });
  assert.equal(transcript.text, "I will verify independently");
  assert.equal(transcript.providerMetadata, undefined);
});

test("synthesizer mock never claims to produce playable provider audio", async () => {
  const result = await new MockTimbreSynthesizer().synthesize({
    scenarioId: "S-01",
    scenarioVersion: "test-only",
    responseId: "safe-template",
    language: "pending-verification",
    voice: "pending-verification",
    safetyStatus: "system_safe_template",
    scenarioReviewStatus: "not_applicable",
    approvalReference: "system-template:safe-template",
  });
  assert.equal(result.bytes.byteLength, 0);
  assert.equal(result.mediaType, "application/x-vaccine-mock-audio");
});

test("reasoner mock labels its output as draft content", async () => {
  const draft = await new MockEvonReasoner().generateScenario({
    scenarioId: "S-01",
    learningObjective: "Practice independent verification.",
    redFlags: ["RF-01"],
    language: null,
  });
  assert.match(draft.nodes[0]?.text ?? "", /Draft placeholder/);
});

test("MockEvon returns a complete synthetic authoring package that remains draft-only", async () => {
  const result = await new MockEvonAuthoringAdapter().generateDraftScenarioPackage({
    scenarioId: "S-01", learningObjective: "Practice independent verification.", redFlags: ["RF-01"], language: "hi-en",
  });
  assert.equal(result.status, "DRAFT");
  assert.equal(result.scenario.lifecycle_status, "DRAFT");
  assert.equal(result.runtimeEligible, false);
  assert.equal(result.tacticPool.length, 5);
  assert.ok(result.candidateApprovedResponses.every((response) => response.status === "DRAFT"));
  assert.equal(result.behaviorTrainingExamples.length, 15);
  assert.equal(result.debriefTemplateVariants.length, 3);
});

test("mock Prisma models connect, frame, processing, transcript, and close without storing frame bytes", async () => {
  const timestamp = "2026-10-07T00:00:00.000Z";
  const transport = new MockPrismaRealtimeTransport({
    text: "Verify through a known channel.", segmentIndex: 3, segmentId: "segment-3",
    audioDurationMs: 640, providerLatencyMs: 42, processingTimestamp: timestamp, providerTimestamp: timestamp,
  }, () => timestamp);
  await transport.connect({ encoding: "PCM_S16LE", channels: 1, frameBytes: 1_024, sampleRateHz: 8_000, language: "en" });
  await transport.sendFrame(MockPrismaRecognizer.frameFixture());
  await transport.close();
  const events = transport.snapshot();
  assert.deepEqual(events.map((event) => event.type), ["CONNECT", "CONNECTED", "AUDIO_FRAME", "PROCESSING", "TRANSCRIPT", "CLOSE"]);
  assert.deepEqual(events[2], { type: "AUDIO_FRAME", frameIndex: 0, byteLength: 1_024, sampleRateHz: 8_000, encoding: "PCM_S16LE", channels: 1, durationMs: 64 });
  assert.deepEqual(events[4], { type: "TRANSCRIPT", text: "Verify through a known channel.", segmentIndex: 3, segmentId: "segment-3", audioDurationMs: 640, providerLatencyMs: 42, providerTimestamp: timestamp });
  assert.equal("bytes" in (events[2] ?? {}), false);
});

test("mock Prisma models provider error followed by close", async () => {
  const transport = new MockPrismaRealtimeTransport({ text: "", errorCode: "MOCK_PROVIDER_ERROR" });
  await transport.connect({ encoding: "PCM_S16LE", channels: 1, frameBytes: 1_024, sampleRateHz: 16_000, language: "en" });
  await transport.sendFrame(MockPrismaRecognizer.frameFixture());
  await transport.close();
  assert.deepEqual(transport.snapshot().map((event) => event.type), ["CONNECT", "CONNECTED", "AUDIO_FRAME", "PROCESSING", "ERROR", "CLOSE"]);
});
