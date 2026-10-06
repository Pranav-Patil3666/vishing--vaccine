import {
  DeterministicDebriefSchema,
  LearnerTurnEventSchema,
  type DeterministicDebrief,
  type LearnerTurnEvent,
  type SessionState,
} from "@vaccine/contracts";

export function buildDeterministicDebrief(events: readonly LearnerTurnEvent[]): DeterministicDebrief {
  const parsedEvents = events.map((event) => LearnerTurnEventSchema.parse(event));
  const sessionId = parsedEvents[0]?.sessionId;
  if (!sessionId) throw new Error("A deterministic debrief requires at least one learner-turn event.");
  if (parsedEvents.some((event) => event.sessionId !== sessionId)) throw new Error("A debrief cannot combine events from different sessions.");

  const statements: DeterministicDebrief["statements"] = [];
  let firstComplianceMoment: DeterministicDebrief["firstComplianceMoment"] = null;
  for (const event of parsedEvents) {
    statements.push({
      kind: "pressure",
      text: `Caller pressure was ${event.callerPressureLevel} of 5.`,
      sourceTurnId: event.turnId,
      eventFact: `callerPressureLevel=${event.callerPressureLevel}`,
    });
    if (event.responseLatency) {
      statements.push({
        kind: "latency",
        text: `Learner speech began ${formatMs(event.responseLatency.valueMs)} ms after caller playback ended.`,
        sourceTurnId: event.turnId,
        eventFact: `responseLatencyMs=${event.responseLatency.valueMs}`,
      });
    }
    if (event.preSpeechSilence) {
      statements.push({
        kind: "hesitation",
        text: `Measured pre-speech silence was ${formatMs(event.preSpeechSilence.valueMs)} ms.`,
        sourceTurnId: event.turnId,
        eventFact: `preSpeechSilenceMs=${event.preSpeechSilence.valueMs}`,
      });
    }
    if (event.fillerCount > 0) {
      statements.push({
        kind: "filler",
        text: `Detected ${event.fillerCount} filler word${event.fillerCount === 1 ? "" : "s"}.`,
        sourceTurnId: event.turnId,
        eventFact: `fillerCount=${event.fillerCount}`,
      });
    }
    if (event.speechRateWpm !== null) {
      statements.push({
        kind: "speech_rate",
        text: `Approximate transcript speech rate was ${formatMs(event.speechRateWpm)} words per minute.`,
        sourceTurnId: event.turnId,
        eventFact: `speechRateWpm=${event.speechRateWpm};wordCountApproximation=true`,
      });
      if (event.baselineSpeechRateWpm !== null && event.speechRateDeltaPercent !== null) {
        statements.push({
          kind: "speech_rate",
          text: `Approximate speech rate changed ${formatMs(event.speechRateDeltaPercent)}% versus the session baseline.`,
          sourceTurnId: event.turnId,
          eventFact: `baselineSpeechRateWpm=${event.baselineSpeechRateWpm};speechRateDeltaPercent=${event.speechRateDeltaPercent}`,
        });
      }
    } else if (event.baselineStatus === "insufficient_data") {
      statements.push({
        kind: "timing_limit",
        text: "Session speech-rate baseline is unavailable because there are insufficient valid samples.",
        sourceTurnId: event.turnId,
        eventFact: "baselineStatus=insufficient_data",
      });
    }
    statements.push({
      kind: "behavior",
      text: `Observed learner behavior: ${event.behavior.label.toLocaleLowerCase().replaceAll("_", " ")}.`,
      sourceTurnId: event.turnId,
      eventFact: `behavior=${event.behavior.label}`,
    });
    if (event.interruption.status === "detected") {
      statements.push({ kind: "interruption", text: "Learner speech began while caller playback was active.", sourceTurnId: event.turnId, eventFact: "interruption=detected" });
    } else if (event.interruption.status === "unknown") {
      statements.push({ kind: "timing_limit", text: "Interruption status was unavailable because playback timing was uncertain or missing.", sourceTurnId: event.turnId, eventFact: "interruption=unknown" });
    }
    if (!firstComplianceMoment && event.complianceMoment) {
      firstComplianceMoment = event.complianceMoment;
      statements.push({
        kind: "compliance",
        text: `The first synthetic dummy-secret disclosure was observed in segment ${event.complianceMoment.segmentIndex} (approximate segment timing).`,
        sourceTurnId: event.turnId,
        eventFact: `firstComplianceSegment=${event.complianceMoment.segmentIndex};precision=segment;approximate=true`,
      });
    }
  }

  return DeterministicDebriefSchema.parse({
    sessionId,
    statements,
    pressureTimeline: parsedEvents.map((event) => ({
      turnId: event.turnId,
      callerPressureLevel: event.callerPressureLevel,
      responseLatency: event.responseLatency ?? null,
      learnerBehavior: event.behavior,
      interruptedCaller: event.interruption.status,
      complianceMoment: event.complianceMoment,
      approximateTiming: event.complianceMoment?.approximate ?? false,
      timeReference: "session-local monotonic milliseconds",
      observedEvidence: event.observedEvidenceRuleIds,
    })),
    firstComplianceMoment,
    sourceTurnIds: parsedEvents.map((event) => event.turnId),
  });
}

export function debriefForSession(state: SessionState): DeterministicDebrief | null {
  return state.timelineEvents.length > 0 ? buildDeterministicDebrief(state.timelineEvents) : null;
}

function formatMs(valueMs: number): string {
  return Number.isInteger(valueMs) ? String(valueMs) : valueMs.toFixed(1);
}
