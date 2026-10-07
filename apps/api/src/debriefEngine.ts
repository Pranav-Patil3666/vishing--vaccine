import {
  DeterministicDebriefSchema,
  LearnerTurnEventSchema,
  type DeterministicDebrief,
  type LearnerTurnEvent,
  type PressureTimelinePoint,
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
      const timingText = event.complianceMoment.localSegmentStart
        ? "local segment timing is approximate"
        : "local segment timing was unavailable; position is approximate";
      statements.push({
        kind: "compliance",
        text: `The first synthetic dummy-secret disclosure was observed within segment ${event.complianceMoment.segmentIndex}; ${timingText}.`,
        sourceTurnId: event.turnId,
        eventFact: `firstComplianceSegment=${event.complianceMoment.segmentIndex};precision=segment;approximate=true;timingSource=${event.complianceMoment.timingSource}`,
      });
    }
  }

  const scoreEvidence = new Set<string>();
  for (const event of parsedEvents) {
    if (event.dummySecretPrompted && event.recognizedWordCount !== undefined && event.recognizedWordCount > 0 && !event.complianceMoment) {
      scoreEvidence.add("did_not_disclose_dummy_secret");
    }
    for (const signal of event.behavior.safetySignals) scoreEvidence.add(signal);
  }
  const safetySignalPoints = [
    "CHALLENGED_URGENCY_OR_VERIFIED",
    "REFUSED_REMOTE_ACCESS",
    "REFUSED_PAYMENT_CREDENTIAL",
    "TERMINATED_OR_ESCALATED_SAFELY",
  ].filter((signal) => scoreEvidence.has(signal));
  const pointsAwarded = Number(scoreEvidence.has("did_not_disclose_dummy_secret")) + safetySignalPoints.length;
  const lastBehavior = parsedEvents.at(-1)?.behavior.label;
  const recommendedNextBehavior = lastBehavior === "VERIFIED_INDEPENDENTLY"
    ? "Continue using an independently known official channel before taking action."
    : lastBehavior === "REFUSED"
      ? "Maintain the refusal and verify through an independently known official channel."
      : lastBehavior === "DISCLOSED_DUMMY_SECRET" || lastBehavior === "COMPLIED"
        ? "Pause before sharing information; end the simulation and verify through an independently known official channel."
        : "Pause before acting and verify through an independently known official channel.";
  const unavailableRubricItems = [
    ...(parsedEvents.some((event) => event.dummySecretPrompted) ? [] : ["No event confirms a dummy-secret prompt, so that rubric item is not scored."]),
    ...(parsedEvents.some((event) => event.behavior.safetySignals.includes("REFUSED_REMOTE_ACCESS")) ? [] : ["No observable remote-access refusal was recorded."]),
    ...(parsedEvents.some((event) => event.behavior.safetySignals.includes("REFUSED_PAYMENT_CREDENTIAL")) ? [] : ["No observable payment-credential refusal was recorded."]),
  ];

  return DeterministicDebriefSchema.parse({
    sessionId,
    statements,
    pressureTimeline: parsedEvents.map(buildPressureTimelinePoint),
    firstComplianceMoment,
    sourceTurnIds: parsedEvents.map((event) => event.turnId),
    turnSummaries: parsedEvents.map((event) => ({
      turnId: event.turnId,
      callerTacticId: event.callerTacticId,
      callerPressureLevel: event.callerPressureLevel,
      learnerBehavior: event.behavior,
      responseLatencyMs: event.responseLatency?.valueMs ?? null,
      preSpeechSilenceMs: event.preSpeechSilence?.valueMs ?? null,
      fillerCount: event.fillerCount,
      speechRateWpm: event.speechRateWpm,
      interruption: event.interruption.status,
      complianceMoment: event.complianceMoment,
    })),
    recommendedNextBehavior,
    observableScoring: {
      pointsAwarded,
      pointsPossible: 5,
      evidence: [...scoreEvidence].sort(),
      unavailableRubricItems,
    },
  });
}

export function buildPressureTimelinePoint(event: LearnerTurnEvent): PressureTimelinePoint {
  return {
    turnId: event.turnId,
    callerTacticId: event.callerTacticId,
    callerResponseId: event.callerResponseId,
    callerPressureLevel: event.callerPressureLevel,
    selectedNextTacticId: event.selectedNextTacticId,
    nextPressureLevel: event.nextPressureLevel,
    policyDecisionCode: event.policyDecisionCode,
    responseLatency: event.responseLatency ?? null,
    responseLatencySource: event.responseLatencySource,
    responseLatencyPrecision: event.responseLatencyPrecision,
    preSpeechSilence: event.preSpeechSilence ?? null,
    fillerCount: event.fillerCount,
    speechRateWpm: event.speechRateWpm,
    learnerBehavior: event.behavior,
    interruptedCaller: event.interruption.status,
    interruptionOffsetMs: event.interruption.offsetMs ?? null,
    complianceMoment: event.complianceMoment,
    approximateTiming: event.complianceMoment?.approximate ?? false,
    timeReference: "session-local monotonic milliseconds",
    observedEvidence: event.observedEvidenceRuleIds,
  };
}

export function debriefForSession(state: SessionState): DeterministicDebrief | null {
  if (state.timelineEvents.length === 0) return null;
  return DeterministicDebriefSchema.parse({
    ...buildDeterministicDebrief(state.timelineEvents),
    pressureTimeline: state.pressureTimeline,
  });
}

function formatMs(valueMs: number): string {
  return Number.isInteger(valueMs) ? String(valueMs) : valueMs.toFixed(1);
}
