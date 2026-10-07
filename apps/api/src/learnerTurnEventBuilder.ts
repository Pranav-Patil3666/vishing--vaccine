import type {
  LearnerTurnEvent,
  SessionState,
} from "@vaccine/contracts";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import type { AdaptivePolicyAction } from "./adaptivePolicy.js";
import { normalizeTranscript } from "./behaviorClassifier.js";
import {
  deriveElapsed,
  deriveHesitation,
  deriveResponseLatency,
  deriveSpeechRate,
  detectInterruption,
  detectDummySecretDisclosure,
  SpeechRateBaseline,
  SYNTHETIC_DUMMY_SECRET_FIXTURES,
  type CapturedAudioTiming,
} from "./timing.js";

export interface LearnerTurnEventBuilderInput {
  session: SessionState;
  scenario: ScenarioDocument;
  turnNumber: number;
  timing: CapturedAudioTiming;
  transcript: { text: string; segmentIndex?: number; segmentId?: string };
  behavior: LearnerTurnEvent["behavior"];
  policy: AdaptivePolicyAction;
  tts: { cacheHit: boolean; fallback: boolean; mediaType: string };
}

/** The only constructor for normalized learner-turn timeline records. */
export class LearnerTurnEventBuilder {
  private readonly speechRateBaseline = new SpeechRateBaseline();

  build(input: LearnerTurnEventBuilderInput): LearnerTurnEvent {
    const { session, scenario, turnNumber, timing, policy, tts } = input;
    const turnId = `${session.sessionId}:turn-${turnNumber}`;
    const normalizedTranscript = normalizeTranscript(input.transcript.text);
    const hesitation = deriveHesitation(timing.callerAudioEndedAt, timing.learnerSpeechStartedAt, normalizedTranscript);
    const responseLatency = timing.noResponse ? undefined : deriveResponseLatency(timing.callerAudioEndedAt, timing.learnerSpeechStartedAt);
    const speechDuration = timing.noResponse ? undefined : deriveElapsed(timing.learnerSpeechStartedAt, timing.learnerSpeechEndedAt);
    const speech = deriveSpeechRate(normalizedTranscript, speechDuration?.valueMs ?? 0);
    const baseline = this.speechRateBaseline.evaluate({
      currentRate: speech.speechRateWpm,
      recognizedWordCount: speech.recognizedWordCount,
      existingBaseline: session.baselineSpeechRateWpm,
      existingSampleCount: session.baselineSpeechRateSampleCount,
    });
    const canMeasureSegment = !timing.noResponse && timing.learnerSpeechStartedAt !== undefined && timing.learnerSpeechEndedAt !== undefined;
    const localSegmentStart = canMeasureSegment ? timing.learnerSpeechStartedAt : undefined;
    const localSegmentEnd = canMeasureSegment ? timing.learnerSpeechEndedAt : undefined;
    const complianceMoment = normalizedTranscript && !session.timelineEvents.some((event) => event.complianceMoment !== null)
      ? detectDummySecretDisclosure({
        turnId,
        text: normalizedTranscript,
        segmentIndex: input.transcript.segmentIndex ?? 0,
        ...(input.transcript.segmentId ? { segmentId: input.transcript.segmentId } : {}),
        ...(localSegmentStart && localSegmentEnd ? { localSegmentStart, localSegmentEnd } : {}),
        timingSource: localSegmentStart ? localSegmentStart.source : "UNKNOWN",
      }, SYNTHETIC_DUMMY_SECRET_FIXTURES)
      : null;
    const interruption = timing.noResponse ? { status: "unknown" as const, source: "UNKNOWN" as const, playbackTimingCertain: false }
      : detectInterruptionForEvent(timing);
    const callerTactic = scenario.adaptive_policy?.tactics.find((tactic) => tactic.tactic_id === session.currentTacticId);
    const timingEvents = [
      ...(timing.callerAudioStartedAt ? [{ type: "CALLER_AUDIO_START" as const, at: timing.callerAudioStartedAt }] : []),
      ...(timing.callerAudioEndedAt ? [{ type: "CALLER_AUDIO_END" as const, at: timing.callerAudioEndedAt }] : []),
      ...(timing.learnerSpeechStartedAt ? [{ type: "LEARNER_SPEECH_START" as const, at: timing.learnerSpeechStartedAt }] : []),
      ...(timing.learnerSpeechEndedAt ? [{ type: "LEARNER_SPEECH_END" as const, at: timing.learnerSpeechEndedAt }] : []),
    ].sort((left, right) => left.at.monotonicMs - right.at.monotonicMs);
    const event: LearnerTurnEvent = {
      sessionId: session.sessionId,
      turnId,
      scenarioId: session.scenarioId,
      scenarioVersion: session.scenarioVersion,
      language: session.language,
      callerTacticId: session.currentTacticId,
      callerResponseId: session.currentResponseId,
      callerTacticCategory: session.currentTacticCategory,
      callerPressureLevel: session.currentPressureLevel,
      selectedNextTacticId: policy.tacticId,
      selectedNextResponseId: policy.responseId,
      nextPressureLevel: policy.nextPressureLevel,
      policyDecisionCode: policy.decisionCode,
      terminalState: policy.terminalState,
      cacheHit: tts.cacheHit,
      ttsFallback: tts.fallback,
      ttsMediaType: tts.mediaType,
      dummySecretPrompted: session.currentTacticPromptedDummySecret || callerTactic?.prompts_dummy_secret === true,
      ...(timing.callerAudioStartedAt ? { callerAudioStartedAt: timing.callerAudioStartedAt } : {}),
      ...(timing.callerAudioEndedAt ? { callerAudioEndedAt: timing.callerAudioEndedAt } : {}),
      ...(timing.learnerSpeechStartedAt ? { learnerSpeechStartedAt: timing.learnerSpeechStartedAt } : {}),
      ...(timing.learnerSpeechEndedAt ? { learnerSpeechEndedAt: timing.learnerSpeechEndedAt } : {}),
      timingEvents,
      responseLatency: responseLatency ?? null,
      responseLatencySource: responseLatency ? "DERIVED" : "UNKNOWN",
      responseLatencyPrecision: responseLatency ? "turn" : "unknown",
      preSpeechSilence: hesitation.preSpeechSilence ?? null,
      fillerWords: hesitation.fillerWords,
      fillerCount: hesitation.fillerCount,
      speechDuration: speechDuration ?? null,
      recognizedWordCount: speech.recognizedWordCount,
      speechRateWpm: speech.speechRateWpm ?? null,
      baselineSpeechRateWpm: baseline.baselineSpeechRateWpm,
      baselineSpeechRateSampleCount: baseline.sampleCount,
      speechRateDeltaPercent: baseline.speechRateDeltaPercent,
      baselineStatus: baseline.baselineStatus,
      interruption: {
        status: interruption.status,
        ...(interruption.at ? { at: interruption.at } : {}),
        offsetMs: interruption.offsetMs ?? null,
        source: interruption.source,
        playbackTimingCertain: interruption.playbackTimingCertain,
      },
      behavior: input.behavior,
      complianceMoment,
      observedEvidenceRuleIds: [...new Set([
        ...input.behavior.evidenceRuleIds,
        `policy.${policy.decisionCode.toLocaleLowerCase()}`,
        ...(timing.timingCertain ? ["timing.fixture_or_local_clock"] : ["timing.unavailable"]),
      ])],
    };
    return event;
  }

  baselineFromEvent(event: LearnerTurnEvent): { baselineSpeechRateWpm: number | null; baselineSpeechRateSampleCount: number } {
    return {
      baselineSpeechRateWpm: event.baselineSpeechRateWpm,
      baselineSpeechRateSampleCount: event.baselineSpeechRateWpm === null
        ? event.baselineSpeechRateSampleCount ?? 0
        : Math.max(1, event.baselineSpeechRateSampleCount ?? 1),
    };
  }
}

function detectInterruptionForEvent(timing: CapturedAudioTiming) {
  const callerAudioStartedAt = timing.callerAudioStartedAt;
  const callerAudioEndedAt = timing.callerAudioEndedAt;
  const learnerSpeechStartedAt = timing.learnerSpeechStartedAt;
  if (!callerAudioStartedAt || !learnerSpeechStartedAt) {
    return { status: "unknown" as const, source: "UNKNOWN" as const, playbackTimingCertain: false };
  }
  return detectInterruption({
    callerAudioStartedAt,
    ...(callerAudioEndedAt ? { callerAudioEndedAt } : {}),
    learnerSpeechStartedAt,
    ...(timing.callerPlaybackActive === undefined ? {} : { callerPlaybackActive: timing.callerPlaybackActive }),
    playbackTimingCertain: timing.timingCertain,
  });
}
