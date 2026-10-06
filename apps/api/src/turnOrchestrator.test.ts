import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { SpeechRecognizer, SpeechRecognitionRequest, SpeechSynthesizer, SpeechSynthesisRequest } from "@vaccine/contracts";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { MockPrismaRecognizer } from "./providers/prisma/mockPrisma.js";
import { MockTimbreSynthesizer } from "./providers/timbre/mockTimbre.js";
import { createSessionState, transitionConsent } from "./session.js";
import { InMemorySessionStore } from "./sessionStore.js";
import { TurnOrchestrator } from "./turnOrchestrator.js";

function setup(input?: { budget?: { developmentCap: number }; recognizer?: SpeechRecognizer; synthesizer?: SpeechSynthesizer }) {
  const scenario = validateScenarioDocument(JSON.parse(readFileSync(resolve(process.cwd(), "content/scenarios/S-01-urgent-account-verification.json"), "utf8")) as unknown) as ScenarioDocument;
  const state = transitionConsent(createSessionState({ sessionId: "turn-test", scenarioId: "S-01", scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" }), "granted", new Date("2026-10-06T00:00:00.000Z"));
  const store = new InMemorySessionStore(); store.create(state);
  const orchestrator = new TurnOrchestrator({
    store, scenarios: new Map([[scenario.scenario_id, scenario]]),
    recognizer: input?.recognizer ?? new MockPrismaRecognizer(), synthesizer: input?.synthesizer ?? new MockTimbreSynthesizer(),
    budget: { mode: "development", developmentCap: input?.budget?.developmentCap ?? 10, publicDemoCap: 10, reserveCap: 0, usedUnits: 0 },
    sttUnits: 0, ttsUnits: 1,
  });
  return { store, orchestrator };
}

test("cache lookup happens before synthesis and identical responses reuse cached metadata", async () => {
  let calls = 0;
  const synth: SpeechSynthesizer = { synthesize: async (_request: SpeechSynthesisRequest) => { calls += 1; return new MockTimbreSynthesizer().synthesize(_request); } };
  const { orchestrator } = setup({ synthesizer: synth });
  const first = await orchestrator.processTurn("turn-test", "I will verify independently.");
  const second = await orchestrator.processTurn("turn-test", "I will verify independently.");
  assert.equal(first.response.cacheHit, false);
  assert.equal(second.response.cacheHit, true);
  assert.equal(calls, 1);
  assert.equal(first.response.cacheKey, second.response.cacheKey);
});

test("credit guard rejects before recognizer is called", async () => {
  let calls = 0;
  const recognizer: SpeechRecognizer = { transcribe: async (_request: SpeechRecognitionRequest) => { calls += 1; return new MockPrismaRecognizer().transcribe(_request); } };
  const scenario = validateScenarioDocument(JSON.parse(readFileSync(resolve(process.cwd(), "content/scenarios/S-01-urgent-account-verification.json"), "utf8")) as unknown) as ScenarioDocument;
  const store = new InMemorySessionStore();
  store.create(transitionConsent(createSessionState({ sessionId: "blocked", scenarioId: "S-01", scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" }), "granted", new Date()));
  const orchestrator = new TurnOrchestrator({ store, scenarios: new Map([["S-01", scenario]]), recognizer, synthesizer: new MockTimbreSynthesizer(), budget: { mode: "development", developmentCap: 0, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 }, sttUnits: 1, ttsUnits: 1 });
  await assert.rejects(orchestrator.processTurn("blocked", "Verify independently"), /project-unit cap/);
  assert.equal(calls, 0);
  assert.equal(store.get("blocked").state, "FALLBACK");
});

test("TTS failure returns an explicit safe text fallback and debrief evidence is redacted", async () => {
  const synthesizer: SpeechSynthesizer = { synthesize: async () => { throw new Error("private provider detail"); } };
  const { orchestrator, store } = setup({ synthesizer });
  const result = await orchestrator.processTurn("turn-test", "I refuse to share my OTP 123456 and will verify through the official channel.");
  assert.equal(result.response.fallback, true);
  assert.equal(result.response.mediaType, "application/x-vaccine-safe-text-fallback");
  assert.equal(result.transcript.text.includes("123456"), false);
  assert.equal(result.debriefEvent.evidenceSnippet?.includes("123456"), false);
  assert.deepEqual(result.debriefEvent.rubricPoints, [1, 2]);
  assert.equal("audio" in store.get("turn-test"), false);
});

test("contradictory safe language does not award points when the learner states they will disclose a secret", async () => {
  const { orchestrator } = setup();
  const result = await orchestrator.processTurn("turn-test", "I will share my OTP 123456, but I will verify independently.");
  assert.equal(result.debriefEvent.observedBehavior, "risky");
  assert.equal(result.debriefEvent.redFlagIds.includes("RF-05"), true);
  assert.equal(result.debriefEvent.rubricPoints, undefined);
});

test("malformed provider transcript is rejected before routing", async () => {
  const recognizer: SpeechRecognizer = { transcribe: async () => ({ text: 17 } as never) };
  const { orchestrator } = setup({ recognizer });
  await assert.rejects(orchestrator.processTurn("turn-test", "hello"), /invalid transcript/);
});

test("cache lookup failure degrades to synthesis without exposing cache errors", async () => {
  let calls = 0;
  const synthesizer: SpeechSynthesizer = { synthesize: async (request) => { calls += 1; return new MockTimbreSynthesizer().synthesize(request); } };
  const scenario = validateScenarioDocument(JSON.parse(readFileSync(resolve(process.cwd(), "content/scenarios/S-01-urgent-account-verification.json"), "utf8")) as unknown) as ScenarioDocument;
  const store = new InMemorySessionStore(); store.create(transitionConsent(createSessionState({ sessionId: "cache-failure", scenarioId: "S-01", scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" }), "granted", new Date()));
  const orchestrator = new TurnOrchestrator({
    store, scenarios: new Map([["S-01", scenario]]), recognizer: new MockPrismaRecognizer(), synthesizer,
    budget: { mode: "development", developmentCap: 10, publicDemoCap: 10, reserveCap: 0, usedUnits: 0 }, sttUnits: 0, ttsUnits: 0,
    cache: { get: () => { throw new Error("private cache detail"); }, set: () => { throw new Error("private cache detail"); } },
  });
  const result = await orchestrator.processTurn("cache-failure", "I will verify independently.");
  assert.equal(result.response.fallback, false);
  assert.equal(calls, 1);
});
