/** Test-only invariant catalog; not imported by application code. */
import assert from "node:assert/strict";
import type { DeterministicDebrief, SessionState } from "@vaccine/contracts";
import { validatePolicyTransition } from "../adaptivePolicy.js";
import { ApprovedCallerCatalog } from "../callerAudio/catalog.js";
import { pathScenario } from "./behaviorPath.js";

export const runtimeInvariantCatalog = {
  "INV-01": "Only approved runtime-eligible caller identities",
  "INV-02": "At most one learner event per turn",
  "INV-03": "Exactly one pressure point per committed event",
  "INV-04": "No orphan pressure point",
  "INV-05": "No learner commit after terminal",
  "INV-06": "No learner window after terminal",
  "INV-07": "No stale callback mutation",
  "INV-08": "Turn N callback cannot mutate turn N+1",
  "INV-09": "Turn index does not exceed maxTurns",
  "INV-10": "Global and approved-content pressure bounds",
  "INV-11": "No indefinite caller/learner loop",
  "INV-12": "Failure preserves committed events",
  "INV-13": "Failure fabricates no learner behavior",
  "INV-14": "Failure fabricates no pressure point",
  "INV-15": "Failure fabricates no compliance moment",
  "INV-16": "Terminal caller audio creates no learner event",
  "INV-17": "Manual End fabricates no natural outcome",
  "INV-18": "ERROR remains ERROR",
  "INV-19": "Fresh sessions inherit no previous state",
  "INV-20": "Cleanup is idempotent",
} as const;
type EvidenceState = Pick<SessionState, "sessionId" | "scenarioId" | "scenarioVersion" | "state" | "turnNumber" | "maxTurns" | "maxPressureLevel"
  | "currentPressureLevel" | "timelineEvents" | "pressureTimeline" | "terminalState" | "conversation" | "recordingEnabled" | "behaviorHistory" | "previousTacticIds">;
export function assertRuntimeInvariants(session: EvidenceState, debrief?: DeterministicDebrief | null): void {
  const events = session.timelineEvents, points = session.pressureTimeline;
  assert.equal(events.length, points.length, "INV-03/04 event/point bijection");
  assert.equal(session.turnNumber, events.length, "INV-02/13 no phantom turn index");
  assert.equal(session.behaviorHistory.length, events.length, "INV-13 no uncommitted behavior history");
  assert.ok(events.length <= session.maxTurns && session.maxTurns <= pathScenario.adaptive_policy!.max_turns, "INV-09 bounded turns");
  assert.ok([0, 1].includes(session.currentPressureLevel), "INV-10 supported current pressure");
  assert.equal(new Set(events.map((event) => event.turnId)).size, events.length, "INV-02 unique event identity");
  assert.equal(new Set(points.map((point) => point.turnId)).size, points.length, "INV-03 unique pressure identity");
  assert.deepEqual(session.previousTacticIds, events.flatMap((event) => event.selectedNextTacticId ? [event.selectedNextTacticId] : []));
  const catalog = new ApprovedCallerCatalog(new Map([["S-01", pathScenario]]), pathScenario.voice_id!);
  for (const [index, event] of events.entries()) {
    assert.equal(event.sessionId, session.sessionId); assert.equal(event.scenarioId, session.scenarioId); assert.equal(event.scenarioVersion, session.scenarioVersion);
    assert.equal(event.turnId, `${session.sessionId}:turn-${index + 1}`);
    assert.equal(points[index]!.turnId, event.turnId); assert.equal(points[index]!.callerPressureLevel, event.callerPressureLevel);
    assert.equal(points[index]!.nextPressureLevel, event.nextPressureLevel); assert.equal(points[index]!.selectedNextTacticId, event.selectedNextTacticId);
    assert.deepEqual(points[index]!.learnerBehavior, event.behavior); assert.deepEqual(session.behaviorHistory[index], event.behavior);
    assert.ok([0, 1].includes(event.callerPressureLevel) && [0, 1].includes(event.nextPressureLevel));
    assert.ok(event.callerPressureLevel <= session.maxPressureLevel && event.nextPressureLevel <= session.maxPressureLevel);
    assert.ok(event.callerPressureLevel >= 0 && event.nextPressureLevel <= 5);
    assert.equal(event.callerPressureLevel, index ? events[index - 1]!.nextPressureLevel : 0);
    assert.equal(event.callerResponseId, index ? events[index - 1]!.selectedNextResponseId : "system.opening");
    catalog.resolveId(session.scenarioId, session.scenarioVersion, event.callerResponseId!);
    const response = catalog.resolveId(session.scenarioId, session.scenarioVersion, event.selectedNextResponseId!);
    const tactic = pathScenario.adaptive_policy!.tactics.find((value) => value.tactic_id === event.selectedNextTacticId);
    validatePolicyTransition(pathScenario, { tacticId: event.selectedNextTacticId, tacticCategory: tactic?.category ?? null,
      pressureLevel: event.nextPressureLevel, nextPressureLevel: event.nextPressureLevel, responseId: event.selectedNextResponseId!, response,
      terminalState: event.terminalState, decisionCode: event.policyDecisionCode, reason: "selected" });
    if (event.complianceMoment) assert.equal(event.behavior.label, "DISCLOSED_DUMMY_SECRET", "INV-15 compliance requires disclosure");
    if (event.terminalState) assert.equal(index, events.length - 1, "INV-05 no events after terminal outcome");
  }
  assert.ok(events.filter((event) => event.complianceMoment).length <= 1);
  if (session.terminalState === "SAFE_VERIFIED") assert.ok(events.some((event) => event.behavior.label === "VERIFIED_INDEPENDENTLY"));
  if (session.terminalState === "DUMMY_SECRET_DISCLOSED") assert.ok(events.some((event) => event.behavior.label === "DISCLOSED_DUMMY_SECRET"));
  if (session.terminalState !== null) assert.equal(session.recordingEnabled, false, "INV-06 no learner capture after terminal decision");
  if (["COMPLETED", "STOPPED", "ERROR"].includes(session.conversation?.phase ?? "")) {
    assert.equal(session.recordingEnabled, false, "INV-06 final session has no recording");
    assert.equal(session.state, session.conversation!.phase === "STOPPED" ? "ENDED_BY_LEARNER" : session.conversation!.phase);
  }
  if (debrief !== undefined) {
    if (!events.length) { assert.equal(debrief, null); return; }
    assert.ok(debrief); assert.equal(debrief.turnSummaries.length, events.length);
    assert.deepEqual(debrief.sourceTurnIds, events.map((event) => event.turnId)); assert.deepEqual(debrief.pressureTimeline, points);
    assert.deepEqual(debrief.turnSummaries.map((summary) => summary.learnerBehavior), events.map((event) => event.behavior));
    assert.equal(debrief.firstComplianceMoment?.turnId ?? null, events.find((event) => event.complianceMoment)?.turnId ?? null);
    assert.equal(debrief.terminalOutcome, session.terminalState);
    assert.equal(debrief.completionKind, session.conversation?.phase === "COMPLETED" ? "complete"
      : ["STOPPED", "ERROR"].includes(session.conversation?.phase ?? "") ? "partial" : "in_progress");
  }
}
