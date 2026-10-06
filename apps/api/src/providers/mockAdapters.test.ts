import assert from "node:assert/strict";
import test from "node:test";
import { MockEvonReasoner } from "./evon/mockEvon.js";
import { MockPrismaRecognizer } from "./prisma/mockPrisma.js";
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
    responseId: "safe-template",
    text: "Simulation disclosure.",
    language: "pending-verification",
    voice: "pending-verification",
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
