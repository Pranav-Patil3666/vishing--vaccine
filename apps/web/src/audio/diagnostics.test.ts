import assert from "node:assert/strict";
import test from "node:test";
import { AudioPipelineDiagnostics, sanitizeAudioException, type AudioFailureDiagnostic } from "./diagnostics.js";
import { audioFailure } from "./errors.js";
import { BrowserAudioController } from "./controller.js";
import { DevelopmentAudioForwarder } from "./transport.js";

test("diagnostics withhold arbitrary messages, stacks, credentials, device labels and payloads", () => {
  const unsafe = new Error("device=Private headset; credential=secret-example; https://private.invalid/token; PCM=[1,2,3]");
  unsafe.name = "private-device-name";
  const safe = sanitizeAudioException(unsafe);
  assert.equal(safe.exceptionName, "Error"); assert.match(safe.exceptionMessage, /withheld/u);
  assert.doesNotMatch(JSON.stringify(safe), /Private|secret-example|private\.invalid|\[1,2,3\]/u);
  assert.equal(sanitizeAudioException(new TypeError("Failed to fetch")).exceptionMessage, "Failed to fetch");
  assert.equal(sanitizeAudioException(new TypeError("Illegal invocation")).exceptionMessage, "Illegal invocation");
  const wrapped = audioFailure(new TypeError("Failed to fetch"), "PCM_PIPELINE_FAILED", "TRANSPORT_OPEN");
  assert.equal(audioFailure(wrapped, "AUDIO_CONTEXT_FAILED", "AUDIO_CONTEXT_CREATION"), wrapped);
  assert.equal(wrapped.detail?.exceptionName, "TypeError"); assert.equal(wrapped.cause, undefined);
  assert.doesNotMatch(wrapped.message, /fetch/u);
});

test("first-occurrence markers are bounded, failures report once and production diagnostics are disabled", () => {
  const logged: AudioFailureDiagnostic[] = [], trace = new AudioPipelineDiagnostics(true, (value) => logged.push(value));
  for (let i = 0; i < 100; i++) trace.mark("MIC_ACQUIRED");
  trace.context("running", 48000); trace.mark("WORKLET_MODULE_LOADED");
  const detail = { stage: "TRANSPORT_OPEN" as const, ...sanitizeAudioException(new TypeError("Failed to fetch")) };
  const failure = trace.failure("PCM_PIPELINE_FAILED", detail)!;
  trace.failure("PCM_PIPELINE_FAILED", detail);
  assert.equal(logged.length, 1); assert.equal(failure.stages.length, 2);
  assert.equal(failure.sourceSampleRate, 48000); assert.equal(failure.audioContextState, "running");
  assert.equal(failure.workletModuleLoaded, true); assert.equal(failure.firstPcmFrameProduced, false);
  assert.equal(failure.category, "AUDIO_TRANSPORT_FAILED");
  const off = new AudioPipelineDiagnostics(false, () => assert.fail("production log"));
  off.mark("MIC_ACQUIRED"); off.context("running", 48000);
  assert.equal(off.failure("PCM_PIPELINE_FAILED", detail), null); assert.deepEqual(off.snapshot().stages, []);
});

test("startup HTTP rejection is classified as transport failure before VAD or PCM, preserving the safe status", async () => {
  let stopped = 0, started = 0;
  const reports: AudioFailureDiagnostic[] = [];
  const controller = new BrowserAudioController({ sessionId: "s", turnNumber: 1, eligible: () => true,
    acquire: async (_signal, trace) => {
      trace?.context("suspended", 48000); trace?.mark("MIC_ACQUIRED"); trace?.mark("WORKLET_MODULE_LOADED");
      return { sampleRate: 48000, settings: {}, start: async () => { started++; }, playMockCaller() {}, flush: async () => {}, stop() { stopped++; } };
    },
    forwarder: () => new DevelopmentAudioForwarder("s", "", async () => new Response("withheld server body", { status: 400 })),
    newClockId: () => "00000000-0000-4000-8000-000000000001", onChange() {}, developmentDiagnostics: true, onDiagnostic: (value) => reports.push(value),
  });
  await controller.prepare();
  assert.equal(controller.diagnostics.failure?.stage, "TRANSPORT_OPEN");
  assert.equal(controller.diagnostics.failure?.exceptionMessage, "Audio start request failed (HTTP 400).");
  assert.equal(controller.diagnostics.failure?.category, "AUDIO_TRANSPORT_FAILED");
  assert.equal(controller.diagnostics.failure?.workletModuleLoaded, true);
  assert.equal(controller.diagnostics.failure?.transportOpened, false);
  assert.equal(controller.diagnostics.frameCount, 0); assert.equal(started, 0); assert.equal(stopped, 1); assert.equal(reports.length, 1);
});
