import { randomUUID } from "node:crypto";
import {
  AudioInputSchema, TranscriptEventSchema, type ApprovedCallerResponse, type BehaviorClassification, type DebriefEvent, type LearnerTurnEvent, type LatencyMeasurement,
  type SessionLifecycleState, type SessionState, type SpeechRecognizer, type SpeechSynthesizer,
} from "@vaccine/contracts";
import { evaluateCreditRequest, type CreditBudget } from "@vaccine/credit-guard";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { selectAdaptiveAction, toSpeechSynthesisRequest } from "./adaptivePolicy.js";
import { DeterministicBehaviorClassifier } from "./behaviorClassifier.js";
import { createTtsCacheKey } from "./cache/cacheKey.js";
import { appendLearnerTurnEvent } from "./eventLog.js";
import { countFillerWords, deriveSpeechRate } from "./timing.js";
import { ApplicationError } from "./errors.js";
import { transitionSession } from "./session.js";
import { InMemorySessionStore } from "./sessionStore.js";

export interface TurnPipelineOptions {
  store: InMemorySessionStore;
  scenarios: ReadonlyMap<string, ScenarioDocument>;
  recognizer: SpeechRecognizer;
  synthesizer: SpeechSynthesizer;
  budget: CreditBudget;
  sttUnits: number;
  ttsUnits: number;
  cache?: TtsMetadataCache;
  now?: () => Date;
}

export interface TtsMetadataCache {
  get(key: string): { mediaType: string; durationMs?: number } | undefined;
  set(key: string, value: { mediaType: string; durationMs?: number }): void;
}

export interface TurnResult {
  session: SessionState;
  transcript: { eventId: string; turnNumber: number; text: string; language: string; normalizationStatus: string };
  branch: { id: string | null; responseId: string; matched: boolean; reason: string };
  response: { mediaType: string; cacheKey: string; cacheHit: boolean; playable: false; fallback: boolean; durationMs?: number };
  debriefEvent: DebriefEvent;
  latency: readonly LatencyMeasurement[];
  creditMode: "none" | "demo";
}

export class TurnOrchestrator {
  private readonly audioCache: TtsMetadataCache;
  private readonly behaviorClassifier = new DeterministicBehaviorClassifier();
  private readonly pendingSyntheses = new Map<string, Promise<{ mediaType: string; durationMs?: number }>>();
  private readonly turnTails = new Map<string, Promise<void>>();
  private readonly usedUnits = new Map<string, number>();
  constructor(private readonly options: TurnPipelineOptions) { this.audioCache = options.cache ?? new Map(); }

  async processTurn(sessionId: string, learnerText: string): Promise<TurnResult> {
    const previous = this.turnTails.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.turnTails.set(sessionId, tail);
    await previous;
    try {
      return await this.processTurnNow(sessionId, learnerText);
    } finally {
      release();
      if (this.turnTails.get(sessionId) === tail) this.turnTails.delete(sessionId);
    }
  }

  private async processTurnNow(sessionId: string, learnerText: string): Promise<TurnResult> {
    let session = this.options.store.get(sessionId);
    if (session.consent.status !== "granted" || !session.recordingEnabled) throw new ApplicationError("CONSENT_REQUIRED", "Explicit consent is required before processing a turn.");
    if (session.state !== "READY" && session.state !== "LISTENING" && session.state !== "FALLBACK") throw new ApplicationError("INVALID_STATE", "Session is not ready to accept a learner turn.");
    if (!learnerText.trim()) throw new ApplicationError("INVALID_REQUEST", "Mock text input must not be empty.");
    const scenario = this.options.scenarios.get(session.scenarioId);
    if (!scenario) throw new ApplicationError("INVALID_SCENARIO", "Scenario is unavailable.");
    const turnNumber = session.turnNumber + 1;
    const stageMeasurements: LatencyMeasurement[] = [];
    const totalStarted = this.time();
    let selectedBranchId: string | null = null;
    let cacheHit: boolean | undefined;
    const step = (state: SessionLifecycleState) => { session = transitionSession(session, state); this.options.store.update(session); };
    try {
      if (session.state === "READY") { step("CALLER_SPEAKING"); step("LISTENING"); }
      step("TRANSCRIBING");
      const transcript = await this.measure(stageMeasurements, sessionId, turnNumber, "transcription", async () => {
        this.authorizeBillable("stt", this.options.sttUnits, sessionId, false);
        const input = AudioInputSchema.parse({ bytes: new TextEncoder().encode(learnerText), mediaType: "text/mock" });
        const candidate = await this.options.recognizer.transcribe({ input, language: session.language, mode: "turn", sessionId, turnNumber });
        const parsed = TranscriptEventSchema.safeParse(candidate);
        if (!parsed.success) throw new ApplicationError("TRANSCRIPTION_FAILED", "Mock transcription returned an invalid transcript.");
        if (!parsed.data.text.trim()) throw new ApplicationError("INVALID_REQUEST", "Mock transcription was empty.");
        return parsed.data;
      });
      step("ROUTING");
      const behavior = this.behaviorClassifier.classify({ transcriptText: transcript.text });
      const policyAction = await this.measure(stageMeasurements, sessionId, turnNumber, "routing", async () => {
        try {
          return selectAdaptiveAction({
            scenario,
            behavior: behavior.label,
            turnNumber,
            currentPressureLevel: session.currentPressureLevel,
            previousTacticIds: session.previousTacticIds,
            previousResponseIds: session.timelineEvents.flatMap((event) => event.callerResponseId ? [event.callerResponseId] : []),
            learnerText: transcript.text,
          });
        } catch { throw new ApplicationError("ROUTING_FAILED", "Approved adaptive policy or safe fallback could not be resolved."); }
      });
      const route = { branchId: policyAction.tacticId, responseId: policyAction.response.responseId, matched: policyAction.reason === "selected", reason: policyAction.reason };
      selectedBranchId = route.branchId;
      stageMeasurements.at(-1)!.branchId = route.branchId;
      const approvedResponse = policyAction.response;
      const responseText = approvedResponse.text;
      const cacheKey = createTtsCacheKey({ responseId: route.responseId, text: responseText, language: approvedResponse.language, voice: approvedResponse.voice, configurationVersion: scenario.version });
      step("GENERATING_RESPONSE");
      const ttsApproved = await this.measure(stageMeasurements, sessionId, turnNumber, "tts_credit_check", async () =>
        this.preflightBillable("tts", this.options.ttsUnits, sessionId, cacheKey));
      let cached: { mediaType: string; durationMs?: number } | undefined;
      try { cached = await this.measure(stageMeasurements, sessionId, turnNumber, "cache_lookup", async () => this.audioCache.get(cacheKey)); }
      catch { cached = undefined; }
      cacheHit = cached !== undefined;
      stageMeasurements.at(-1)!.cacheHit = cacheHit;
      let audioMetadata = cached;
      let fallbackUsed = false;
      if (!audioMetadata) {
        if (!ttsApproved) {
          fallbackUsed = true;
          audioMetadata = { mediaType: "application/x-vaccine-safe-text-fallback" };
        }
      }
      if (!audioMetadata) {
        try {
          audioMetadata = await this.measure(stageMeasurements, sessionId, turnNumber, "tts", async () =>
            this.synthesizeOnce(cacheKey, approvedResponse, sessionId));
        } catch (error) {
          if (!(error instanceof ApplicationError) || !["SYNTHESIS_FAILED", "CREDIT_LIMIT_REACHED"].includes(error.code)) throw error;
          fallbackUsed = true;
          audioMetadata = { mediaType: "application/x-vaccine-safe-text-fallback" };
        }
      }
      step("PLAYING_RESPONSE");
      const learnerTurnEvent = createLearnerTurnEvent({ session, turnNumber, behavior, policyAction, transcriptText: transcript.text });
      session = {
        ...session,
        turnNumber,
        currentTacticId: policyAction.tacticId,
        currentPressureLevel: policyAction.pressureLevel,
        previousTacticIds: policyAction.tacticId ? [...session.previousTacticIds, policyAction.tacticId] : session.previousTacticIds,
        safeWordState: policyAction.reason === "safe_word" ? "triggered" : session.safeWordState,
        behaviorHistory: [...session.behaviorHistory, behavior],
        terminalState: scenario.adaptive_policy ? policyAction.terminalState : session.terminalState,
        cache: { hits: session.cache.hits + (cacheHit ? 1 : 0), misses: session.cache.misses + (cacheHit ? 0 : 1) },
      };
      session = appendLearnerTurnEvent(session, learnerTurnEvent);
      const callerTesting = policyAction.tacticId
        ? `Approved adaptive tactic ${policyAction.tacticId} at pressure ${policyAction.pressureLevel} was selected.`
        : "No approved adaptive tactic was selected; the system-safe fallback was used.";
      const event = makeDebriefEvent(turnNumber, transcript.text, callerTesting);
      session = { ...session, observedEvents: [...session.observedEvents, event] };
      const adaptiveTerminal = scenario.adaptive_policy !== undefined && policyAction.terminalState !== null;
      session = transitionSession(session, fallbackUsed ? "FALLBACK" : adaptiveTerminal ? "COMPLETED" : "LISTENING");
      const totalMs = this.elapsed(totalStarted);
      session = { ...session, metrics: [...session.metrics, ...stageMeasurements, { operation: "turn_total", stage: "turn_total", sessionId, turnNumber, startedAt: totalStarted.toISOString(), endedAt: this.time().toISOString(), durationMs: totalMs, measuredAt: this.time().toISOString(), success: true, branchId: route.branchId, cacheHit }] };
      this.options.store.update(session);
      return {
        session,
        transcript: { eventId: transcript.eventId, turnNumber, text: redactSensitiveText(transcript.text), language: transcript.language, normalizationStatus: transcript.normalizationStatus },
        branch: { id: route.branchId, responseId: route.responseId, matched: route.matched, reason: route.reason },
        response: { mediaType: audioMetadata.mediaType, cacheKey, cacheHit, playable: false, fallback: fallbackUsed, ...(audioMetadata.durationMs === undefined ? {} : { durationMs: audioMetadata.durationMs }) },
        debriefEvent: event,
        latency: stageMeasurements,
        creditMode: fallbackUsed || session.mode === "demo" ? "demo" : "none",
      };
    } catch (error) {
      if (session.state !== "ENDED_BY_LEARNER" && session.state !== "COMPLETED") {
        const recoverable = session.state === "TRANSCRIBING" || session.state === "ROUTING" || session.state === "GENERATING_RESPONSE";
        try {
          session = transitionSession(session, recoverable ? "FALLBACK" : "ERROR");
          const endedAt = this.time();
          session = { ...session, metrics: [...session.metrics, ...stageMeasurements, { operation: "turn_total", stage: "turn_total", sessionId, turnNumber, startedAt: totalStarted.toISOString(), endedAt: endedAt.toISOString(), durationMs: Math.max(0, endedAt.getTime() - totalStarted.getTime()), measuredAt: endedAt.toISOString(), success: false, failureCode: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR", branchId: selectedBranchId, cacheHit }] };
          this.options.store.update(session);
        } catch { /* preserve the original typed failure */ }
      }
      throw error;
    }
  }

  private authorizeBillable(operation: string, units: number, sessionId: string, cacheAvailable: boolean): void {
    const usedUnits = this.usedUnits.get(operation) ?? this.options.budget.usedUnits;
    const decision = evaluateCreditRequest({ ...this.options.budget, usedUnits }, { operation, estimatedUnits: units, cacheAvailable, sessionId }, this.time());
    if (!decision.allowed) throw new ApplicationError("CREDIT_LIMIT_REACHED", `Configured ${operation} project-unit cap reached.`);
    if (units > 0) this.usedUnits.set(operation, usedUnits + units);
  }

  private preflightBillable(operation: string, units: number, sessionId: string, cacheKey: string): boolean {
    if (this.pendingSyntheses.has(cacheKey)) return true;
    const usedUnits = this.usedUnits.get(operation) ?? this.options.budget.usedUnits;
    return evaluateCreditRequest(
      { ...this.options.budget, usedUnits },
      { operation, estimatedUnits: units, cacheAvailable: true, sessionId },
      this.time(),
    ).allowed;
  }

  private synthesizeOnce(cacheKey: string, response: ApprovedCallerResponse, sessionId: string): Promise<{ mediaType: string; durationMs?: number }> {
    const pending = this.pendingSyntheses.get(cacheKey);
    if (pending) return pending;
    const synthesis = Promise.resolve().then(async () => {
      this.authorizeBillable("tts", this.options.ttsUnits, sessionId, false);
      let result;
      try {
        result = await this.options.synthesizer.synthesize(toSpeechSynthesisRequest(response));
      } catch {
        throw new ApplicationError("SYNTHESIS_FAILED", "Mock speech synthesis failed; safe text fallback is available.");
      }
      const metadata = { mediaType: result.mediaType, ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }) };
      try { this.audioCache.set(cacheKey, metadata); } catch { /* a cache write miss does not block the safe response */ }
      return metadata;
    }).finally(() => { this.pendingSyntheses.delete(cacheKey); });
    this.pendingSyntheses.set(cacheKey, synthesis);
    return synthesis;
  }

  private async measure<T>(measurements: LatencyMeasurement[], sessionId: string, turnNumber: number, operation: string, run: () => Promise<T>): Promise<T> {
    const startedAt = this.time();
    let success = false;
    let failureCode: string | undefined;
    try { const result = await run(); success = true; return result; }
    catch (error) { failureCode = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR"; throw error; }
    finally {
      const endedAt = this.time();
      measurements.push({ operation, stage: operation, sessionId, turnNumber, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()), measuredAt: endedAt.toISOString(), success, ...(failureCode ? { failureCode } : {}) });
    }
  }
  private time(): Date { return (this.options.now ?? (() => new Date()))(); }
  private elapsed(start: Date): number { return Math.max(0, this.time().getTime() - start.getTime()); }
}

function makeDebriefEvent(turnNumber: number, text: string, callerTesting: string): DebriefEvent {
  const normalized = text.normalize("NFKC").toLowerCase();
  const evidence = [
    /\b(?:pause|slow down|no rush|not act immediately)\b/i.test(normalized) ? { flag: "RF-01" as const, point: 2 } : undefined,
    /\b(?:verify|official channel|call back|independently)\b/i.test(normalized) ? { flag: "RF-02" as const, point: 2 } : undefined,
    /\b(?:won't keep|will not keep|refuse secrecy|not keep this secret)\b/i.test(normalized) ? { flag: "RF-03" as const } : undefined,
    /\b(?:refuse|won't|will not|not install)\b.{0,50}\b(?:remote access|screen control|remote app)\b/i.test(normalized) ? { flag: "RF-04" as const, point: 3 } : undefined,
    /\b(?:won't share|will not share|refuse to share|never disclose)\b.{0,50}\b(?:otp|pin|password|credential|secret)\b/i.test(normalized) ? { flag: "RF-05" as const, point: 1 } : undefined,
    /\b(?:refuse|won't|will not)\b.{0,50}\b(?:payment|upi|banking credential)\b/i.test(normalized) ? { flag: "RF-06" as const, point: 4 } : undefined,
    /\b(?:account lock|penalty|deadline|urgent)\b/i.test(normalized) && /\b(?:verify|pause|slow down|call back)\b/i.test(normalized) ? { flag: "RF-07" as const, point: 2 } : undefined,
    /\b(?:refund|payment)\b/i.test(normalized) && /\b(?:official|verify|support)\b/i.test(normalized) ? { flag: "RF-08" as const, point: 2 } : undefined,
    /\b(?:end the call|hang up|terminate)\b/i.test(normalized) && /\b(?:official|report|escalate|support)\b/i.test(normalized) ? { flag: "RF-02" as const, point: 5 } : undefined,
  ].filter((item): item is NonNullable<typeof item> => item !== undefined);
  const disclosedSecret = /\b(?:my\s+(?:otp|pin|password|cvv|credential)\s*(?:is|:)|i\s+(?:will|am going to)\s+(?:share|send|read out)\s+(?:my\s+)?(?:otp|pin|password|credential)|here is my\s+(?:otp|pin|password))\b/i.test(normalized);
  const acceptedRemoteAccess = /\b(?:installing|installed|granting|granted)\b.{0,40}\b(?:remote access|screen control|remote app)\b/i.test(normalized);
  const risky = disclosedSecret || acceptedRemoteAccess;
  const riskFlags = [
    ...(disclosedSecret ? ["RF-05" as const] : []),
    ...(acceptedRemoteAccess ? ["RF-04" as const] : []),
  ];
  const flags = [...new Set([...evidence.map((item) => item.flag), ...riskFlags])];
  return {
    eventId: randomUUID(), turnNumber,
    callerTesting,
    observedBehavior: risky ? "risky" : flags.length ? "safe" : "unmatched",
    redFlagIds: flags,
    recommendedAction: risky ? "Do not share credentials or grant remote access; stop and use a known official channel." : flags.length ? "Continue to verify through a known official channel." : "Pause and use an independently known official channel.",
    ...(!risky && evidence.some((item) => item.point !== undefined) ? { rubricPoints: [...new Set(evidence.flatMap((item) => item.point === undefined ? [] : [item.point]))].sort((left, right) => left - right) } : {}),
  };
}

function redactSensitiveText(text: string): string {
  return text.replace(/\b(?:otp|pin|cvv|password|card number|account number)\b\s*[:#=-]?\s*[\d -]{3,20}/gi, "[redacted sensitive value]").replace(/\b\d{6,19}\b/g, "[redacted number]");
}

function createLearnerTurnEvent(input: {
  session: SessionState;
  turnNumber: number;
  behavior: BehaviorClassification;
  policyAction: ReturnType<typeof selectAdaptiveAction>;
  transcriptText: string;
}): LearnerTurnEvent {
  const fillers = countFillerWords(input.transcriptText);
  const speech = deriveSpeechRate(input.transcriptText, 0);
  return {
    sessionId: input.session.sessionId,
    turnId: `${input.session.sessionId}:turn-${input.turnNumber}`,
    scenarioId: input.session.scenarioId,
    scenarioVersion: input.session.scenarioVersion,
    language: input.session.language,
    callerTacticId: input.policyAction.tacticId,
    callerResponseId: input.policyAction.response.responseId,
    callerPressureLevel: input.policyAction.pressureLevel,
    fillerWords: fillers,
    fillerCount: fillers.reduce((sum, item) => sum + item.count, 0),
    recognizedWordCount: speech.recognizedWordCount,
    speechRateWpm: null,
    baselineSpeechRateWpm: input.session.baselineSpeechRateWpm,
    speechRateDeltaPercent: null,
    baselineStatus: input.session.baselineSpeechRateWpm === null ? "insufficient_data" : "available",
    interruption: { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false },
    behavior: input.behavior,
    complianceMoment: null,
    observedEvidenceRuleIds: [...input.behavior.evidenceRuleIds, ...fillers.map((item) => `filler.${item.token}`)],
  };
}
