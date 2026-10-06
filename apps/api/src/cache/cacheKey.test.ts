import assert from "node:assert/strict";
import test from "node:test";
import { createTtsCacheKey } from "./cacheKey.js";

test("TTS cache keys are stable and change when synthesis inputs change", () => {
  const base = { responseId: "response-safe", text: "Approved template", language: "pending", voice: "pending" };
  assert.equal(createTtsCacheKey(base), createTtsCacheKey({ ...base }));
  assert.notEqual(createTtsCacheKey(base), createTtsCacheKey({ ...base, text: "Different approved template" }));
});

test("TTS cache keys separate language, voice, and audio configuration", () => {
  const base = { responseId: "response-safe", text: "Approved template", language: "pending", voice: "mock-only", configurationVersion: "config-1" };
  assert.notEqual(createTtsCacheKey(base), createTtsCacheKey({ ...base, language: "other-pending" }));
  assert.notEqual(createTtsCacheKey(base), createTtsCacheKey({ ...base, voice: "other-mock" }));
  assert.notEqual(createTtsCacheKey(base), createTtsCacheKey({ ...base, configurationVersion: "config-2" }));
});
