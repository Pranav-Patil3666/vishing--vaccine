/** Test-only composition runner. No application code imports this module. No provider/credit/cache work. */
import { readFileSync } from "node:fs";
import type { BehaviorClassification, BehaviorLabel, SessionState, TranscriptEvent } from "@vaccine/contracts";
import { validateScenarioDocument } from "@vaccine/scenario-schema";
import { AdaptivePolicyEngine, ApprovedResponseResolver, type AdaptivePolicyAction, type AdaptivePolicyInput } from "../adaptivePolicy.js";
import { applyConversationAction } from "../conversationRuntime.js";
import { conversationDebrief, readConversationTemplates } from "../conversationDebrief.js";
import { appendLearnerTurnEvent } from "../eventLog.js";
import { buildPressureTimelinePoint } from "../debriefEngine.js";
import { LearnerTurnEventBuilder } from "../learnerTurnEventBuilder.js";
import { createSessionState, endSession, transitionConsent, transitionSession } from "../session.js";
import type { CapturedAudioTiming } from "../timing.js";

export const pathScenario = validateScenarioDocument(JSON.parse(readFileSync("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
export const pathTemplates = readConversationTemplates("content/authoring/S-01-hi-IN.package.json", pathScenario);
export const pathClock = "00000000-0000-4000-8000-00000000000d";
export const pathDate = "2026-10-24T00:00:00.000Z";
export const behaviorTexts: Record<BehaviorLabel, string> = {
  REFUSED: "fixture REFUSED observable learner words",
  STALLED: "fixture STALLED observable learner words",
  VERIFIED_INDEPENDENTLY: "fixture VERIFIED_INDEPENDENTLY observable learner words",
  COMPLIED: "fixture COMPLIED observable learner words",
  DISCLOSED_DUMMY_SECRET: "fixture DISCLOSED_DUMMY_SECRET DUMMY-4821",
  UNKNOWN: "fixture UNKNOWN observable learner words",
};
export interface ScheduledCaller { turnNumber: number; responseId: string; afterEventCount: number; terminal: boolean; }
export interface BehaviorPathResult {
  session: SessionState;
  processed: BehaviorLabel[];
  decisions: AdaptivePolicyAction[];
  callers: ScheduledCaller[];
  debrief: ReturnType<typeof conversationDebrief>;
}
export function freshPathSession(sessionId: string): SessionState {
  return { ...transitionConsent(createSessionState({ sessionId, scenarioId: pathScenario.scenario_id,
    scenarioVersion: pathScenario.version, language: pathScenario.language!, startingNodeId: "start", mode: "safe",
    runtimeMode: "REAL_CONVERSATION", maxTurns: pathScenario.adaptive_policy!.max_turns,
    maxPressureLevel: pathScenario.adaptive_policy!.max_pressure_level, scenarioRuntimeStatus: "RUNTIME_ELIGIBLE" }),
  "granted", new Date(pathDate)), currentResponseId: "system.opening" };
}
export function fixtureBehavior(label: BehaviorLabel, session: Pick<SessionState, "currentTacticId" | "currentTacticCategory">): BehaviorClassification {
  return { label, source: "deterministic_rules", evidenceRuleIds: ["fixture.supplied_behavior"],
    context: { activeTacticId: session.currentTacticId, activeTacticCategory: session.currentTacticCategory,
      relevantRedFlagIds: [...new Set([...pathScenario.red_flag_ids, ...pathScenario.nodes[0]!.debrief_tags])].sort() },
    safetySignals: label === "VERIFIED_INDEPENDENTLY" ? ["CHALLENGED_URGENCY_OR_VERIFIED"] : [] };
}
export function pathInput(session: SessionState, behavior: BehaviorLabel): AdaptivePolicyInput {
  return { scenario: pathScenario, behavior, turnNumber: session.turnNumber + 1, currentPressureLevel: session.currentPressureLevel,
    previousTacticIds: session.previousTacticIds,
    previousResponseIds: session.timelineEvents.flatMap((event) => event.selectedNextResponseId ? [event.selectedNextResponseId] : []),
    learnerText: behaviorTexts[behavior], sessionState: { scenarioId: session.scenarioId, scenarioVersion: session.scenarioVersion,
      currentNodeId: session.currentNodeId, turnNumber: session.turnNumber, state: session.state, terminalState: session.terminalState,
      currentTacticId: session.currentTacticId, currentResponseId: session.currentResponseId } };
}
export function fixtureTranscript(session: SessionState, behavior: BehaviorLabel): TranscriptEvent {
  const turn = session.turnNumber + 1, text = behaviorTexts[behavior];
  return { sessionId: session.sessionId, turnNumber: turn, eventId: `${session.sessionId}:transcript-${turn}`, language: "hi-IN", text,
    normalizationStatus: "normalized", segments: [{ text, segmentIndex: 0, segmentId: `${session.sessionId}:segment:${turn}` }] };
}
export function pathTiming(session: SessionState): CapturedAudioTiming {
  const caller = session.conversation!.caller!, audioClockId = session.conversation!.audioClockId!;
  const instant = (monotonicMs: number, source: "CLIENT_AUDIO_CLOCK" | "LOCAL_VAD") => ({ monotonicMs, source, precision: "instant" as const, audioClockId });
  const latency = 400 + session.turnNumber * 100;
  return { callerAudioStartedAt: instant(caller.startedAtMs, "CLIENT_AUDIO_CLOCK"), callerAudioEndedAt: instant(caller.endedAtMs!, "CLIENT_AUDIO_CLOCK"),
    learnerSpeechStartedAt: instant(caller.endedAtMs! + latency, "LOCAL_VAD"), learnerSpeechEndedAt: instant(caller.endedAtMs! + latency + 1000, "LOCAL_VAD"),
    noResponse: false, timingCertain: true, interruptionReportingEligible: false };
}
/** A simulated acknowledgement only: no audio asset, synthesis, cache or browser resource is created. */
export function acknowledgeCaller(session: SessionState, callers: ScheduledCaller[]): SessionState {
  const responseId = session.currentResponseId!;
  if (callers.some((value) => value.turnNumber === session.turnNumber)) throw new Error("Duplicate caller scheduling in test path");
  if (!pathScenario.responses[responseId] || pathScenario.responses[responseId]!.safety_status === "draft") throw new Error("Unapproved path response");
  callers.push({ turnNumber: session.turnNumber, responseId, afterEventCount: session.timelineEvents.length, terminal: session.terminalState !== null });
  const atMs = (session.turnNumber + 1) * 10000;
  const signal = { responseId, turnNumber: session.turnNumber, audioClockId: session.conversation!.audioClockId, atMs };
  const playing = applyConversationAction(session, "caller-start", signal);
  return applyConversationAction(playing, "caller-ended", { ...signal, atMs: atMs + 1000 });
}
export function startPath(session: SessionState, callers: ScheduledCaller[], audioClockId = pathClock): SessionState {
  return acknowledgeCaller(applyConversationAction(session, "start", { audioClockId }), callers);
}
export function runBehaviorPath(labels: readonly BehaviorLabel[], options: { sessionId?: string; audioClockId?: string; partial?: "stop" | "fail" } = {}): BehaviorPathResult {
  const engine = new AdaptivePolicyEngine(), resolver = new ApprovedResponseResolver(), builder = new LearnerTurnEventBuilder();
  const callers: ScheduledCaller[] = [], decisions: AdaptivePolicyAction[] = [], processed: BehaviorLabel[] = [];
  let session = startPath(freshPathSession(options.sessionId ?? "behavior-path"), callers, options.audioClockId);
  for (const behavior of labels) {
    if (session.terminalState !== null) break;
    const preceding = session, transcript = fixtureTranscript(session, behavior), timing = pathTiming(session);
    session = transitionSession(transitionSession(session, "TRANSCRIBING"), "ROUTING");
    const action = engine.decide(pathInput(session, behavior));
    resolver.resolve({ scenario: pathScenario, language: "hi-IN", action });
    const event = builder.build({ session: preceding, scenario: pathScenario, turnNumber: transcript.turnNumber, timing, transcript: {
      text: transcript.text, segmentIndex: 0, segmentId: `${session.sessionId}:segment:${transcript.turnNumber}` }, behavior: fixtureBehavior(behavior, preceding),
      policy: action, tts: { cacheHit: false, fallback: false, mediaType: "text/plain" }, inputSource: "REAL_STT", dummySecretTokens: ["DUMMY-4821"] });
    session = transitionSession(transitionSession(session, "GENERATING_RESPONSE"), "PLAYING_RESPONSE");
    const tactic = pathScenario.adaptive_policy!.tactics.find((value) => value.tactic_id === action.tacticId);
    session = appendLearnerTurnEvent({ ...session, turnNumber: transcript.turnNumber, currentTacticId: action.tacticId,
      currentTacticCategory: action.tacticCategory, currentResponseId: action.responseId,
      currentTacticPromptedDummySecret: tactic?.prompts_dummy_secret ?? false, currentPressureLevel: action.nextPressureLevel,
      terminalState: action.terminalState, previousTacticIds: action.tacticId ? [...session.previousTacticIds, action.tacticId] : session.previousTacticIds,
      behaviorHistory: [...session.behaviorHistory, event.behavior], baselineSpeechRateWpm: event.baselineSpeechRateWpm,
      baselineSpeechRateSampleCount: event.baselineSpeechRateSampleCount ?? 0 }, event);
    session = { ...session,
      pressureTimeline: [...session.pressureTimeline, buildPressureTimelinePoint(event)], recordingEnabled: false,
      conversation: { audioClockId: session.conversation!.audioClockId!, phase: action.terminalState ? "TERMINAL_CALLER_PREPARING" : "CALLER_PREPARING" } };
    decisions.push(action); processed.push(behavior);
    if (options.partial && processed.length === labels.length && !action.terminalState) {
      session = options.partial === "stop" ? endSession(session, new Date(pathDate))
        : applyConversationAction(session, "fail", { code: "CALLER_AUDIO_FAILED", technical: { stage: "CALLER_AUDIO_RESOLUTION", causeCode: "TTS_PROVIDER_FAILED", providerAttempted: false } });
      break;
    }
    session = acknowledgeCaller(session, callers);
  }
  return { session, processed, decisions, callers, debrief: conversationDebrief(session, pathTemplates) };
}
/** Exclude operational metrics/random legacy IDs, retain canonical events, full debrief and histories. */
export function pathSignature(result: BehaviorPathResult) {
  return { processed: result.processed, tactics: result.decisions.map((value) => value.tacticId), responses: result.decisions.map((value) => value.responseId),
    heard: result.session.timelineEvents.map((value) => value.callerPressureLevel), next: result.decisions.map((value) => value.nextPressureLevel),
    decisions: result.decisions.map((value) => ({ code: value.decisionCode, terminal: value.terminalState, reason: value.reason })),
    events: result.session.timelineEvents, points: result.session.pressureTimeline, callers: result.callers,
    tacticHistory: result.session.previousTacticIds, behaviorHistory: result.session.behaviorHistory,
    outcome: result.session.terminalState, state: result.session.state, phase: result.session.conversation?.phase, debrief: result.debrief };
}
