import assert from "node:assert/strict";
import test from "node:test";
import { AudioInputSchema, TranscriptEventSchema } from "./domain.js";

test("transcript contract keeps provider metadata and measurement fields optional", () => {
  const event = TranscriptEventSchema.parse({
    eventId: "event-1",
    sessionId: "session-1",
    turnNumber: 0,
    text: "",
    language: "language-pending-verification",
    normalizationStatus: "unchanged",
  });

  assert.equal(event.providerMetadata, undefined);
  assert.equal(event.timing, undefined);
  assert.equal(event.confidence, undefined);
});

test("audio input is represented as transient bytes without a persistence field", () => {
  const input = AudioInputSchema.parse({ bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual([...input.bytes], [1, 2, 3]);
  assert.equal("persist" in input, false);
});
