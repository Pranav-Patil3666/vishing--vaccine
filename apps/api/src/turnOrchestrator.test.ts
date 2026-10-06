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
  let lastRequest: SpeechSynthesisRequest | undefined;
  const synth: SpeechSynthesizer = { synthesize: async (request: SpeechSynthesisRequest) => { calls += 1; lastRequest = request; return new MockTimbreSynthesizer().synthesize(request); } };
  const { orchestrator } = setup({ synthesizer: synth });
  const first = await orchestrator.processTurn("turn-test", "I will verify independently.");
  const second = await orchestrator.processTurn("turn-test", "I will verify independently.");
  assert.equal(first.response.cacheHit, false);
  assert.equal(second.response.cacheHit, true);
  assert.equal(calls, 1);
  assert.equal(lastRequest?.safetyStatus, "system_safe_template");
  assert.equal(lastRequest?.scenarioReviewStatus, "not_applicable");
  assert.equal(lastRequest && "text" in lastRequest, false);
  assert.equal(first.response.cacheKey, second.response.cacheKey);
});

test("concurrent turns for one session are serialized and coalesce repeated TTS work", async () => {
  let calls = 0;
  const synthesizer: SpeechSynthesizer = {
    synthesize: async (request) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new MockTimbreSynthesizer().synthesize(request);
    },
  };
  const { orchestrator, store } = setup({ synthesizer });
  const results = await Promise.all([
    orchestrator.processTurn("turn-test", "I will verify independently."),
    orchestrator.processTurn("turn-test", "I will verify independently."),
  ]);
  assert.deepEqual(results.map((result) => result.session.turnNumber).sort(), [1, 2]);
  assert.equal(calls, 1);
  assert.equal(store.get("turn-test").timelineEvents.length, 2);
});

test("TTS credit preflight precedes cache resolution and capped cache hits remain usable", async () => {
  const scenario = validateScenarioDocument(JSON.parse(readFileSync(resolve(process.cwd(), "content/scenarios/S-01-urgent-account-verification.json"), "utf8")) as unknown) as ScenarioDocument;
  const store = new InMemorySessionStore();
  store.create(transitionConsent(createSessionState({ sessionId: "tts-capped", scenarioId: "S-01", scenarioVersion: scenario.version, language: "pending-verification", startingNodeId: "start" }), "granted", new Date()));
  let synthesisCalls = 0;
  let cacheCalls = 0;
  const orchestrator = new TurnOrchestrator({
    store, scenarios: new Map([["S-01", scenario]]), recognizer: new MockPrismaRecognizer(),
    synthesizer: { synthesize: async () => { synthesisCalls += 1; return new MockTimbreSynthesizer().synthesize({
      scenarioId: "S-01", scenarioVersion: "0.1.0-draft", responseId: "system.safe-fallback",
      language: "pending-verification", voice: "mock-only", safetyStatus: "system_safe_template", scenarioReviewStatus: "not_applicable", approvalReference: "system-template:system.safe-fallback",
    }); } },
    budget: { mode: "development", developmentCap: 0, publicDemoCap: 0, reserveCap: 0, usedUnits: 0 }, sttUnits: 0, ttsUnits: 1,
    cache: { get: () => { cacheCalls += 1; return { mediaType: "application/x-cached-safe-audio" }; }, set: () => undefined },
  });
  const result = await orchestrator.processTurn("tts-capped", "I will verify independently.");
  assert.equal(cacheCalls, 1);
  assert.equal(synthesisCalls, 0);
  assert.equal(result.response.cacheHit, true);
  const operations = result.latency.map((measurement) => measurement.operation);
  assert.ok(operations.indexOf("tts_credit_check") < operations.indexOf("cache_lookup"));
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

test("TTS failure returns an explicit safe text fallback without retaining a transcript snippet", async () => {
  const synthesizer: SpeechSynthesizer = { synthesize: async () => { throw new Error("private provider detail"); } };
  const { orchestrator, store } = setup({ synthesizer });
  const result = await orchestrator.processTurn("turn-test", "I refuse to share my OTP 123456 and will verify through the official channel.");
  assert.equal(result.response.fallback, true);
  assert.equal(result.response.mediaType, "application/x-vaccine-safe-text-fallback");
  assert.equal(result.transcript.text.includes("123456"), false);
  assert.equal(result.debriefEvent.evidenceSnippet, undefined);
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

test("approved adaptive scenario drives bounded pressure policy and sends only response identity to TTS", async () => {
  const adaptiveScenario = validateScenarioDocument({
    scenario_id: "S-96", version: "1.0.0", language: "en", voice_id: "reviewed-voice",
    fictional_organization: { name: "Fictional Practice Group", training_only: true }, simulation: true,
    opening_line: "This is a training simulation.", learning_objectives: ["Verify independently."], red_flag_ids: ["RF-01"],
    responses: {
      calm: { text: "Please pause and verify independently.", safety_status: "reviewed_safe" },
      bounded: { text: "This is still a simulation; use a known channel.", safety_status: "reviewed_safe" },
      "system.safe-fallback": { text: "End this simulation and independently verify.", safety_status: "system_safe_template" },
    },
    nodes: [{ id: "start", parent_node_id: null, trigger_rules: [], response_id: "calm", learner_expected_behavior: ["Verify independently."], next_node_id: null, safe_fallback_response_id: "system.safe-fallback", debrief_tags: ["RF-01"], safety_constraints: ["No personal data."], branch_status: "approved" }],
    adaptive_policy: {
      max_pressure_level: 1, max_turns: 3, safe_word: "stop simulation", escalation_behaviors: ["COMPLIED"],
      terminal_states: ["SAFE_WORD", "LEARNER_ENDED", "VERIFIED_INDEPENDENTLY", "DUMMY_SECRET_DISCLOSED", "MAX_TURNS"],
      tactics: [
        { tactic_id: "calm-check", pressure_level: 0, behavior_targets: ["UNKNOWN", "REFUSED"], response_ids: ["calm"] },
        { tactic_id: "bounded-follow-up", pressure_level: 1, behavior_targets: ["COMPLIED"], response_ids: ["bounded"] },
      ],
    },
    safety_metadata: {
      visible_simulation_label: true, ai_voice_disclosure_required: true, consent_before_recording: true,
      audio_retention: "none_by_default", dummy_data_mode: "synthetic_only", safe_ending_response_id: "system.safe-fallback",
    },
    safety_constraints: ["Simulation only."], review_status: "approved", reviewed_by: "reviewer", reviewed_at: "2026-10-06T00:00:00.000Z",
  }) as ScenarioDocument;
  const state = transitionConsent(createSessionState({
    sessionId: "adaptive-turn", scenarioId: adaptiveScenario.scenario_id, scenarioVersion: adaptiveScenario.version,
    language: "en", startingNodeId: "start", maxPressureLevel: 1, maxTurns: 3,
  }), "granted", new Date());
  const store = new InMemorySessionStore(); store.create(state);
  let request: SpeechSynthesisRequest | undefined;
  const orchestrator = new TurnOrchestrator({
    store, scenarios: new Map([[adaptiveScenario.scenario_id, adaptiveScenario]]), recognizer: new MockPrismaRecognizer(),
    synthesizer: { synthesize: async (value) => { request = value; return new MockTimbreSynthesizer().synthesize(value); } },
    budget: { mode: "development", developmentCap: 10, publicDemoCap: 10, reserveCap: 0, usedUnits: 0 }, sttUnits: 0, ttsUnits: 0,
  });
  const result = await orchestrator.processTurn("adaptive-turn", "I will share the training phrase.");
  assert.equal(result.branch.id, "bounded-follow-up");
  assert.equal(result.branch.responseId, "bounded");
  assert.equal(result.session.currentPressureLevel, 1);
  assert.deepEqual(result.session.previousTacticIds, ["bounded-follow-up"]);
  assert.equal(result.session.behaviorHistory[0]?.label, "COMPLIED");
  assert.equal(result.session.timelineEvents[0]?.callerPressureLevel, 1);
  assert.equal(result.session.timelineEvents[0]?.interruption.status, "unknown");
  assert.equal(request?.responseId, "bounded");
  assert.equal("text" in (request ?? {}), false);
});
