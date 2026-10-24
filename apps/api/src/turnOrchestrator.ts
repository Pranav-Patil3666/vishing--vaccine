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
  type TranscriptEvent,
  type RuntimeCreditReservation,
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
import { RuntimeCreditLedger } from "./runtimeCredit.js";
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
  initialTtsUsedUnits?: number;
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
  approvedResponseText: string;
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
  private readonly credits: RuntimeCreditLedger;

  constructor(private readonly options: TurnPipelineOptions) {
    this.audioCache = options.cache ?? new Map();
    this.audioTimingClock = options.audioTimingClock ?? new DeterministicAudioTimingClock();
    this.credits = new RuntimeCreditLedger(options.budget, { stt: options.sttUnits, tts: options.ttsUnits }, options.initialTtsUsedUnits, () => this.time());
  }

  async processTurn(sessionId: string, learnerText: string, timingFixture?: AudioTimingFixture): Promise<TurnResult> {
    return this.enqueue(sessionId, () => this.processTurnNow(sessionId, learnerText, timingFixture));
  }

  /** Reserve once before a runtime provider connection; never charge again on finalization. */
  creditDiagnostics() { return this.credits.snapshot(); }
  reserveRecognition(sessionId: string): RuntimeCreditReservation { return this.credits.reserve("stt", sessionId); }
  reserveCallerSynthesis(sessionId: string): RuntimeCreditReservation {
    if (!(this.options.ttsUnits > 0)) throw new ApplicationError("TTS_UNAVAILABLE", "Positive configured TTS project units are required.");
    return this.credits.reserve("tts", sessionId);
  }

  async processRecognizedTurn(sessionId: string, transcript: TranscriptEvent, timing: CapturedAudioTiming, isActive: () => boolean = () => true): Promise<TurnResult> {
    return this.enqueue(sessionId, () => this.processTurnNow(sessionId, transcript.text, undefined, { transcript, timing, isActive }));
  }

  private async enqueue(sessionId: string, run: () => Promise<TurnResult>): Promise<TurnResult> {
    const previous = this.turnTails.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.turnTails.set(sessionId, tail);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (this.turnTails.get(sessionId) === tail) this.turnTails.delete(sessionId);
    }
  }

  private async processTurnNow(sessionId: string, learnerText: string, timingFixture?: AudioTimingFixture,
    runtime?: { transcript: TranscriptEvent; timing: CapturedAudioTiming; isActive: () => boolean }): Promise<TurnResult> {
    let session = this.options.store.get(sessionId);
    if (session.consent.status !== "granted" || !session.recordingEnabled) throw new ApplicationError("CONSENT_REQUIRED", "Explicit consent is required before processing a turn.");
    if (session.state !== "READY" && session.state !== "LISTENING" && session.state !== "FALLBACK") throw new ApplicationError("INVALID_STATE", "Session is not ready to accept a learner turn.");
    const noResponse = timingFixture?.noResponse === true;
    if (runtime && (runtime.transcript.sessionId !== sessionId || runtime.transcript.turnNumber !== session.turnNumber + 1
      || (session.runtimeMode === "REAL_STT" ? session.turnNumber !== 0 : session.runtimeMode !== "REAL_CONVERSATION" || session.turnNumber >= session.maxTurns)
      || runtime.transcript.language !== session.language)) {
      throw new ApplicationError("INVALID_STATE", "Stale or mismatched real learner turn.");
    }
    if (!learnerText.trim() && !noResponse) throw new ApplicationError("INVALID_REQUEST", "Mock text input must not be empty.");
    const scenario = this.options.scenarios.get(session.scenarioId);
    if (!scenario || scenario.simulation !== true || scenario.version !== session.scenarioVersion) throw new ApplicationError("INVALID_SCENARIO", "Scenario is unavailable or invalid for this session.");
    if (scenario.lifecycle_status !== session.scenarioRuntimeStatus) throw new ApplicationError("INVALID_SCENARIO", "Scenario lifecycle changed after session creation.");
    if (session.mode !== "demo" && !isScenarioRuntimeEligible(scenario)) throw new ApplicationError("INVALID_SCENARIO", "Only runtime-eligible content can use normal runtime behavior.");
    let timing: CapturedAudioTiming;
    try { timing = runtime?.timing ?? this.audioTimingClock.capture(timingFixture); }
    catch { throw new ApplicationError("INVALID_TIMING", "Timing fixture did not match the development timing contract."); }

    const turnSession = session;
    const turnNumber = session.turnNumber + 1;
    const stageMeasurements: LatencyMeasurement[] = [];
    const totalStartedAt = this.time();
    const totalStartedMono = performance.now();
    let selectedBranchId: string | null = null;
    let cacheHit: boolean | undefined;
    const stillActive = () => {
      if (!runtime) return;
      const latest = this.options.store.get(sessionId);
      if (!runtime.isActive() || !latest.recordingEnabled || latest.consent.status !== "granted" || latest.turnNumber !== turnSession.turnNumber || latest.terminalState) {
        throw new ApplicationError("STT_CANCELLED", "The real learner turn was cancelled.");
      }
    };
    const step = (state: SessionLifecycleState) => { stillActive(); session = transitionSession(session, state); this.options.store.update(session); };
    try {
      if (session.state === "READY") { step("CALLER_SPEAKING"); step("LISTENING"); }
      step("TRANSCRIBING");
      const candidateTranscript = runtime ? TranscriptEventSchema.parse(runtime.transcript) : noResponse
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
      const normalizedText = runtime ? candidateTranscript.text.replace(/\s+/gu, " ").trim() : normalizeTranscriptText(candidateTranscript.text);
      const transcript = { ...candidateTranscript, text: normalizedText };

      step("ROUTING");
      const turnId = `${session.sessionId}:turn-${turnNumber}`;
      const runtimeDummyTokens = runtime ? normalizedText.match(/(?<![\p{L}\p{N}-])DUMMY-\d{4}(?![\p{L}\p{N}-])/gu) ?? [] : undefined;
      const syntheticMatch = runtime ? Boolean(runtimeDummyTokens?.length) : normalizedText.length > 0 && detectDummySecretDisclosure({
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
            sessionState: { scenarioId: session.scenarioId, scenarioVersion: session.scenarioVersion, currentNodeId: session.currentNodeId,
              turnNumber: session.turnNumber, terminalState: session.terminalState, state: session.state,
              currentTacticId: session.currentTacticId, currentResponseId: session.currentResponseId },
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
      const ttsApproved = runtime ? false : await this.measure(stageMeasurements, sessionId, turnNumber, "tts_credit_check", async () =>
        this.preflightBillable("tts", this.options.ttsUnits, sessionId, cacheKey));
      let cached: { mediaType: string; durationMs?: number } | undefined;
      try { if (!runtime) cached = await this.measure(stageMeasurements, sessionId, turnNumber, "cache_lookup", async () => this.audioCache.get(cacheKey)); }
      catch { cached = undefined; }
      cacheHit = cached !== undefined;
      if (!runtime) stageMeasurements.at(-1)!.cacheHit = cacheHit;
      let audioMetadata = runtime ? { mediaType: "text/plain" } : cached;
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
        transcript: { text: normalizedText,
          segmentIndex: runtime?.transcript.segments?.find((segment) => /\bDUMMY-\d{4}\b/u.test(segment.text))?.segmentIndex ?? 0,
          segmentId: runtime?.transcript.segments?.find((segment) => /\bDUMMY-\d{4}\b/u.test(segment.text))?.segmentId ?? `${session.sessionId}:segment:${turnNumber}` },
        ...(runtime ? { inputSource: "REAL_STT" as const, dummySecretTokens: runtimeDummyTokens ?? [] } : {}),
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
        cache: runtime ? session.cache : { hits: session.cache.hits + (cacheHit ? 1 : 0), misses: session.cache.misses + (cacheHit ? 0 : 1) },
      };
      session = appendLearnerTurnEvent(session, learnerTurnEvent);
      session = { ...session, pressureTimeline: [...session.pressureTimeline, buildPressureTimelinePoint(learnerTurnEvent)] };
      const callerTesting = turnSession.currentTacticId
        ? `Caller tactic ${turnSession.currentTacticId} was active at pressure ${turnSession.currentPressureLevel}.`
        : "No previous adaptive tactic was active; the system-safe fallback was used.";
      const debriefEvent = makeDebriefEvent(turnNumber, normalizedText, callerTesting);
      session = { ...session, observedEvents: [...session.observedEvents, debriefEvent] };
      const terminal = policyAction.terminalState !== null;
      if (session.runtimeMode === "REAL_CONVERSATION" && session.conversation) {
        if (policyAction.terminalState === "SAFE_WORD") {
          session = { ...transitionSession(session, "ENDED_BY_LEARNER"), recordingEnabled: false,
            conversation: { ...session.conversation, phase: "STOPPED" },
            consent: { ...session.consent, status: "withdrawn", updatedAt: this.time().toISOString() } };
        } else {
          const { caller: _previousCaller, ...conversation } = session.conversation;
          session = { ...session, recordingEnabled: false,
            conversation: { ...conversation, phase: terminal ? "TERMINAL_CALLER_PREPARING" : "CALLER_PREPARING" } };
          // PLAYING_RESPONSE is already reached above. Terminal completion awaits actual browser ended.
        }
      } else session = transitionSession(session, fallbackUsed ? "FALLBACK" : terminal ? "COMPLETED" : "LISTENING");
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
        approvedResponseText: approvedResponse.text,
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
      if (runtime && (this.options.store.get(sessionId).state === "ENDED_BY_LEARNER"
        || ["ERROR", "STOPPED"].includes(this.options.store.get(sessionId).conversation?.phase ?? ""))) throw error;
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
    this.credits.chargeSimulated(operation, units, sessionId, cacheAvailable);
  }

  private preflightBillable(operation: string, units: number, sessionId: string, cacheKey: string): boolean {
    if (this.pendingSyntheses.has(cacheKey)) return true;
    const usedUnits = this.credits.simulatedUsedUnits(operation);
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

export function redactSensitiveText(text: string): string {
  return text.replace(/\b(?:otp|pin|cvv|password|card number|account number)\b\s*[:#=-]?\s*[\d -]{3,20}/gi, "[redacted sensitive value]").replace(/\b\d{6,19}\b/g, "[redacted number]");
}
