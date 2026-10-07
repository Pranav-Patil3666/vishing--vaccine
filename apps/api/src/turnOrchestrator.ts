import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  AudioInputSchema,
  TranscriptEventSchema,
  type AudioTimingFixture,
  type ApprovedCallerResponse,
  type BehaviorClassification,
  type DebriefEvent,
  type LatencyMeasurement,
  type LearnerTurnEvent,
  type SessionLifecycleState,
  type SessionState,
  type SpeechRecognizer,
  type SpeechSynthesizer,
} from "@vaccine/contracts";
import { evaluateCreditRequest, type CreditBudget } from "@vaccine/credit-guard";
import { isScenarioRuntimeEligible, type ScenarioDocument } from "@vaccine/scenario-schema";
import { AdaptivePolicyEngine, ApprovedResponseResolver, containsSafeWord, toSpeechSynthesisRequest } from "./adaptivePolicy.js";
import { LearnerBehaviorClassifier } from "./behaviorClassifier.js";
import { createTtsCacheKey } from "./cache/cacheKey.js";
import { appendLearnerTurnEvent } from "./eventLog.js";
import { buildPressureTimelinePoint } from "./debriefEngine.js";
import { LearnerTurnEventBuilder } from "./learnerTurnEventBuilder.js";
import { ApplicationError } from "./errors.js";
import { transitionSession } from "./session.js";
import { InMemorySessionStore } from "./sessionStore.js";
import {
  DeterministicAudioTimingClock,
  detectDummySecretDisclosure,
  SYNTHETIC_DUMMY_SECRET_FIXTURES,
  type AudioTimingClock,
  type CapturedAudioTiming,
} from "./timing.js";

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
  audioTimingClock?: AudioTimingClock;
}

export interface TtsMetadataCache {
  get(key: string): { mediaType: string; durationMs?: number } | undefined;
  set(key: string, value: { mediaType: string; durationMs?: number }): void;
}

export interface TurnResult {
  session: SessionState;
  transcript: { eventId: string; turnNumber: number; text: string; language: string; normalizationStatus: string };
  branch: {
    id: string | null;
    responseId: string;
    matched: boolean;
    reason: string;
    policyDecisionCode: string;
    nextPressureLevel: number;
    terminalState: SessionState["terminalState"];
  };
  response: { mediaType: string; cacheKey: string; cacheHit: boolean; playable: false; fallback: boolean; durationMs?: number };
  debriefEvent: DebriefEvent;
  learnerTurnEvent: LearnerTurnEvent;
  latency: readonly LatencyMeasurement[];
  creditMode: "none" | "demo";
}

export class TurnOrchestrator {
  private readonly audioCache: TtsMetadataCache;
  private readonly behaviorClassifier = new LearnerBehaviorClassifier();
  private readonly policyEngine = new AdaptivePolicyEngine();
  private readonly responseResolver = new ApprovedResponseResolver();
  private readonly eventBuilder = new LearnerTurnEventBuilder();
  private readonly audioTimingClock: AudioTimingClock;
  private readonly pendingSyntheses = new Map<string, Promise<{ mediaType: string; durationMs?: number }>>();
  private readonly turnTails = new Map<string, Promise<void>>();
  private readonly usedUnits = new Map<string, number>();

  constructor(private readonly options: TurnPipelineOptions) {
    this.audioCache = options.cache ?? new Map();
    this.audioTimingClock = options.audioTimingClock ?? new DeterministicAudioTimingClock();
  }

  async processTurn(sessionId: string, learnerText: string, timingFixture?: AudioTimingFixture): Promise<TurnResult> {
    const previous = this.turnTails.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.turnTails.set(sessionId, tail);
    await previous;
    try {
      return await this.processTurnNow(sessionId, learnerText, timingFixture);
    } finally {
      release();
      if (this.turnTails.get(sessionId) === tail) this.turnTails.delete(sessionId);
    }
  }

  private async processTurnNow(sessionId: string, learnerText: string, timingFixture?: AudioTimingFixture): Promise<TurnResult> {
    let session = this.options.store.get(sessionId);
    if (session.consent.status !== "granted" || !session.recordingEnabled) throw new ApplicationError("CONSENT_REQUIRED", "Explicit consent is required before processing a turn.");
    if (session.state !== "READY" && session.state !== "LISTENING" && session.state !== "FALLBACK") throw new ApplicationError("INVALID_STATE", "Session is not ready to accept a learner turn.");
    const noResponse = timingFixture?.noResponse === true;
    if (!learnerText.trim() && !noResponse) throw new ApplicationError("INVALID_REQUEST", "Mock text input must not be empty.");
    const scenario = this.options.scenarios.get(session.scenarioId);
    if (!scenario || scenario.simulation !== true || scenario.version !== session.scenarioVersion) throw new ApplicationError("INVALID_SCENARIO", "Scenario is unavailable or invalid for this session.");
    if (scenario.lifecycle_status !== session.scenarioRuntimeStatus) throw new ApplicationError("INVALID_SCENARIO", "Scenario lifecycle changed after session creation.");
    if (session.mode !== "demo" && !isScenarioRuntimeEligible(scenario)) throw new ApplicationError("INVALID_SCENARIO", "Only runtime-eligible content can use normal runtime behavior.");
    let timing: CapturedAudioTiming;
    try { timing = this.audioTimingClock.capture(timingFixture); }
    catch { throw new ApplicationError("INVALID_TIMING", "Timing fixture did not match the development timing contract."); }

    const turnSession = session;
    const turnNumber = session.turnNumber + 1;
    const stageMeasurements: LatencyMeasurement[] = [];
    const totalStartedAt = this.time();
    const totalStartedMono = performance.now();
    let selectedBranchId: string | null = null;
    let cacheHit: boolean | undefined;
    const step = (state: SessionLifecycleState) => { session = transitionSession(session, state); this.options.store.update(session); };
    try {
      if (session.state === "READY") { step("CALLER_SPEAKING"); step("LISTENING"); }
      step("TRANSCRIBING");
      const candidateTranscript = noResponse
        ? { eventId: `no-response-${sessionId}-${turnNumber}`, sessionId, turnNumber, text: "", language: session.language, normalizationStatus: "unchanged" as const }
        : await this.measure(stageMeasurements, sessionId, turnNumber, "transcription", async () => {
          this.authorizeBillable("stt", this.options.sttUnits, sessionId, false);
          const input = AudioInputSchema.parse({ bytes: new TextEncoder().encode(learnerText), mediaType: "text/mock" });
          const candidate = await this.options.recognizer.transcribe({ input, language: session.language, mode: "turn", sessionId, turnNumber });
          const parsed = TranscriptEventSchema.safeParse(candidate);
          if (!parsed.success) throw new ApplicationError("TRANSCRIPTION_FAILED", "Mock transcription returned an invalid transcript.");
          if (!parsed.data.text.trim()) throw new ApplicationError("INVALID_REQUEST", "Mock transcription was empty.");
          return parsed.data;
        });
      const normalizedText = normalizeTranscriptText(candidateTranscript.text);
      const transcript = { ...candidateTranscript, text: normalizedText };

      step("ROUTING");
      const turnId = `${session.sessionId}:turn-${turnNumber}`;
      const syntheticMatch = normalizedText.length > 0 && detectDummySecretDisclosure({
        turnId,
        text: normalizedText,
        segmentIndex: 0,
        segmentId: `${session.sessionId}:segment:${turnNumber}`,
        ...(timing.learnerSpeechStartedAt && timing.learnerSpeechEndedAt
          ? { localSegmentStart: timing.learnerSpeechStartedAt, localSegmentEnd: timing.learnerSpeechEndedAt }
          : {}),
        timingSource: timing.learnerSpeechStartedAt ? timing.learnerSpeechStartedAt.source : "UNKNOWN",
      }, SYNTHETIC_DUMMY_SECRET_FIXTURES) !== null;
      const safeWordPhrase = scenario.adaptive_policy?.safe_word ?? "stop simulation";
      const safeWordDetected = containsSafeWord(normalizedText, safeWordPhrase);
      const currentNode = scenario.nodes.find((node) => node.id === session.currentNodeId);
      let behavior: BehaviorClassification;
      try {
        behavior = safeWordDetected || noResponse
          ? {
            label: "UNKNOWN",
            evidenceRuleIds: [],
            source: "unknown",
            context: {
              activeTacticId: session.currentTacticId,
              activeTacticCategory: session.currentTacticCategory,
              relevantRedFlagIds: currentNode?.debrief_tags ?? scenario.red_flag_ids,
            },
            safetySignals: [],
          }
          : this.behaviorClassifier.classify({
            transcriptText: normalizedText,
            dummySecretDisclosureObserved: syntheticMatch,
            activeTactic: { tacticId: session.currentTacticId, category: session.currentTacticCategory },
            scenario: { red_flag_ids: scenario.red_flag_ids },
            relevantRedFlagIds: currentNode?.debrief_tags ?? scenario.red_flag_ids,
          });
      } catch { throw new ApplicationError("CLASSIFIER_FAILED", "Learner behavior could not be classified safely."); }

      const policyAction = await this.measure(stageMeasurements, sessionId, turnNumber, "policy_decision", async () => {
        try {
          const action = this.policyEngine.decide({
            scenario,
            behavior: behavior.label,
            turnNumber,
            currentPressureLevel: session.currentPressureLevel,
            previousTacticIds: session.previousTacticIds,
            previousResponseIds: session.timelineEvents.flatMap((event) => event.selectedNextResponseId ? [event.selectedNextResponseId] : []),
            learnerText: normalizedText,
            safeWordDetected,
            runtimeAllowed: session.mode === "safe",
          });
          const response = this.responseResolver.resolve({ scenario, language: session.language, action });
          return { ...action, response };
        } catch (error) {
          if (error instanceof ApplicationError) throw error;
          throw new ApplicationError("APPROVED_RESPONSE_UNAVAILABLE", "Policy could not resolve an approved response for this session.");
        }
      });
      const route = {
        branchId: policyAction.tacticId,
        responseId: policyAction.responseId,
        matched: policyAction.decisionCode === "SELECTED_TACTIC",
        reason: policyAction.reason,
      };
      selectedBranchId = route.branchId;
      const approvedResponse = policyAction.response;
      const cacheKey = createTtsCacheKey({
        responseId: route.responseId,
        text: approvedResponse.text,
        language: approvedResponse.language,
        voice: approvedResponse.voice,
        configurationVersion: scenario.version,
      });

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
      if (!audioMetadata && !ttsApproved) {
        fallbackUsed = true;
        audioMetadata = { mediaType: "application/x-vaccine-safe-text-fallback" };
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

      const learnerTurnEvent = this.eventBuilder.build({
        session: turnSession,
        scenario,
        turnNumber,
        timing,
        transcript: { text: normalizedText, segmentIndex: 0, segmentId: `${session.sessionId}:segment:${turnNumber}` },
        behavior,
        policy: policyAction,
        tts: { cacheHit, fallback: fallbackUsed, mediaType: audioMetadata.mediaType },
      });
      const selectedTactic = policyAction.tacticId
        ? scenario.adaptive_policy?.tactics.find((tactic) => tactic.tactic_id === policyAction.tacticId)
        : undefined;
      session = {
        ...session,
        turnNumber,
        currentTacticId: policyAction.tacticId,
        currentResponseId: policyAction.responseId,
        currentTacticCategory: policyAction.tacticCategory,
        currentTacticPromptedDummySecret: selectedTactic?.prompts_dummy_secret ?? false,
        currentPressureLevel: policyAction.nextPressureLevel,
        previousTacticIds: policyAction.tacticId ? [...session.previousTacticIds, policyAction.tacticId] : session.previousTacticIds,
        safeWordState: policyAction.decisionCode === "SAFE_WORD" ? "triggered" : session.safeWordState,
        behaviorHistory: [...session.behaviorHistory, behavior],
        baselineSpeechRateWpm: learnerTurnEvent.baselineSpeechRateWpm,
        baselineSpeechRateSampleCount: learnerTurnEvent.baselineSpeechRateSampleCount,
        terminalState: policyAction.terminalState ?? session.terminalState,
        cache: { hits: session.cache.hits + (cacheHit ? 1 : 0), misses: session.cache.misses + (cacheHit ? 0 : 1) },
      };
      session = appendLearnerTurnEvent(session, learnerTurnEvent);
      session = { ...session, pressureTimeline: [...session.pressureTimeline, buildPressureTimelinePoint(learnerTurnEvent)] };
      const callerTesting = turnSession.currentTacticId
        ? `Caller tactic ${turnSession.currentTacticId} was active at pressure ${turnSession.currentPressureLevel}.`
        : "No previous adaptive tactic was active; the system-safe fallback was used.";
      const debriefEvent = makeDebriefEvent(turnNumber, normalizedText, callerTesting);
      session = { ...session, observedEvents: [...session.observedEvents, debriefEvent] };
      const terminal = policyAction.terminalState !== null;
      session = transitionSession(session, fallbackUsed ? "FALLBACK" : terminal ? "COMPLETED" : "LISTENING");
      const totalEndedAt = this.time();
      session = {
        ...session,
        metrics: [
          ...session.metrics,
          ...stageMeasurements,
          {
            operation: "turn_total", stage: "turn_total", sessionId, turnNumber,
            startedAt: totalStartedAt.toISOString(), endedAt: totalEndedAt.toISOString(),
            durationMs: Math.max(0, performance.now() - totalStartedMono), measuredAt: totalEndedAt.toISOString(),
            success: true, branchId: route.branchId, cacheHit,
          },
        ],
      };
      this.options.store.update(session);
      return {
        session,
        transcript: { eventId: transcript.eventId, turnNumber, text: redactSensitiveText(transcript.text), language: transcript.language, normalizationStatus: transcript.normalizationStatus },
        branch: {
          id: route.branchId, responseId: route.responseId, matched: route.matched, reason: route.reason,
          policyDecisionCode: policyAction.decisionCode, nextPressureLevel: policyAction.nextPressureLevel,
          terminalState: policyAction.terminalState,
        },
        response: { mediaType: audioMetadata.mediaType, cacheKey, cacheHit, playable: false, fallback: fallbackUsed, ...(audioMetadata.durationMs === undefined ? {} : { durationMs: audioMetadata.durationMs }) },
        debriefEvent,
        learnerTurnEvent,
        latency: stageMeasurements,
        creditMode: fallbackUsed || session.mode === "demo" ? "demo" : "none",
      };
    } catch (error) {
      if (session.state !== "ENDED_BY_LEARNER" && session.state !== "COMPLETED") {
        const recoverable = session.state === "TRANSCRIBING" || session.state === "ROUTING" || session.state === "GENERATING_RESPONSE";
        try {
          session = transitionSession(session, recoverable ? "FALLBACK" : "ERROR");
          const endedAt = this.time();
          session = {
            ...session,
            metrics: [
              ...session.metrics,
              ...stageMeasurements,
              {
                operation: "turn_total", stage: "turn_total", sessionId, turnNumber,
                startedAt: totalStartedAt.toISOString(), endedAt: endedAt.toISOString(),
                durationMs: Math.max(0, performance.now() - totalStartedMono), measuredAt: endedAt.toISOString(),
                success: false, failureCode: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR",
                branchId: selectedBranchId, cacheHit,
              },
            ],
          };
          this.options.store.update(session);
        } catch { /* keep the original typed failure */ }
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
      try { result = await this.options.synthesizer.synthesize(toSpeechSynthesisRequest(response)); }
      catch { throw new ApplicationError("SYNTHESIS_FAILED", "Mock speech synthesis failed; safe text fallback is available."); }
      const metadata = { mediaType: result.mediaType, ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }) };
      try { this.audioCache.set(cacheKey, metadata); } catch { /* a cache write miss does not block a safe response */ }
      return metadata;
    }).finally(() => { this.pendingSyntheses.delete(cacheKey); });
    this.pendingSyntheses.set(cacheKey, synthesis);
    return synthesis;
  }

  private async measure<T>(measurements: LatencyMeasurement[], sessionId: string, turnNumber: number, operation: string, run: () => Promise<T>): Promise<T> {
    const startedAt = this.time();
    const startedMono = performance.now();
    let success = false;
    let failureCode: string | undefined;
    try { const result = await run(); success = true; return result; }
    catch (error) { failureCode = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR"; throw error; }
    finally {
      const endedAt = this.time();
      measurements.push({
        operation, stage: operation, sessionId, turnNumber,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
        durationMs: Math.max(0, performance.now() - startedMono), measuredAt: endedAt.toISOString(),
        success, ...(failureCode ? { failureCode } : {}),
      });
    }
  }

  private time(): Date { return (this.options.now ?? (() => new Date()))(); }
}

function normalizeTranscriptText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function makeDebriefEvent(turnNumber: number, text: string, callerTesting: string): DebriefEvent {
  const normalized = normalizeTranscriptText(text).toLocaleLowerCase();
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
  const disclosedSyntheticToken = SYNTHETIC_DUMMY_SECRET_FIXTURES.some((secret) => normalized.includes(secret.toLocaleLowerCase()));
  const intendedCredentialDisclosure = /\b(?:i will|i am going to|i'm going to|going to)\s+(?:share|give|tell|provide|disclose)\b.{0,40}\b(?:otp|pin|password|credential|secret)\b/i.test(normalized);
  const acceptedRemoteAccess = /\b(?:installing|installed|granting|granted)\b.{0,40}\b(?:remote access|screen control|remote app)\b/i.test(normalized);
  const risky = disclosedSyntheticToken || intendedCredentialDisclosure || acceptedRemoteAccess;
  const riskFlags = [
    ...(disclosedSyntheticToken || intendedCredentialDisclosure ? ["RF-05" as const] : []),
    ...(acceptedRemoteAccess ? ["RF-04" as const] : []),
  ];
  const flags = [...new Set([...evidence.map((item) => item.flag), ...riskFlags])];
  return {
    eventId: randomUUID(), turnNumber, callerTesting,
    observedBehavior: risky ? "risky" : flags.length ? "safe" : "unmatched",
    redFlagIds: flags,
    recommendedAction: risky ? "Do not share training data or grant remote access; stop and use a known official channel." : flags.length ? "Continue to verify through a known official channel." : "Pause and use an independently known official channel.",
    ...(!risky && evidence.some((item) => item.point !== undefined) ? { rubricPoints: [...new Set(evidence.flatMap((item) => item.point === undefined ? [] : [item.point]))].sort((left, right) => left - right) } : {}),
  };
}

function redactSensitiveText(text: string): string {
  return text.replace(/\b(?:otp|pin|cvv|password|card number|account number)\b\s*[:#=-]?\s*[\d -]{3,20}/gi, "[redacted sensitive value]").replace(/\b\d{6,19}\b/g, "[redacted number]");
}
