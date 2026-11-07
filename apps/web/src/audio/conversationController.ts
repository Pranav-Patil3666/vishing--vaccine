import { CONVERSATION_CLOCK_LIMIT_MS, type CallerAudioAsset, type ConversationFailure, type RealVoiceTurnResult, type SafeSession, type TechnicalFailure } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { SessionApiError } from "../sessionApi.js";
import { BrowserAudioController, type AudioDiagnostics } from "./controller.js";
import { acquireBrowserMicrophone, type CaptureConnection } from "./browserCapture.js";
import { createCallerPlayback, type CallerPlayback } from "./callerPlayback.js";
import { ReusableMicrophone } from "./reusableMicrophone.js";
import { REAL_TURN_LIMITS } from "@vaccine/contracts";
import { BrowserAudioError } from "./errors.js";

export type ConversationUiState = "IDLE" | "MIC_PREPARING" | "CALLER_PREPARING" | "CALLER_PLAYING" | "LEARNER_PREPARING" | "LEARNER_LISTENING" | "LEARNER_FINALIZING" | "TERMINAL_CALLER_PLAYING" | "COMPLETED" | "STOPPED" | "ERROR";
export interface CallerObservation { position: number; responseId: string; terminal: boolean; asset: CallerAudioAsset; audioClockId: string; startedAtMs?: number; endedAtMs?: number; }
export interface ConversationSnapshot {
  state: ConversationUiState; session: SafeSession; clockId: string; callers: readonly CallerObservation[];
  diagnostics: AudioDiagnostics | null; latestResult: RealVoiceTurnResult | null; error: ConversationFailure | null;
  technical: TechnicalFailure | null;
  microphone: ReturnType<ReusableMicrophone["snapshot"]> | null;
}
interface Options {
  session: SafeSession; api: ApiClient; onChange(snapshot: ConversationSnapshot): void;
  onSession(session: SafeSession): void; onTurn(result: RealVoiceTurnResult): void; onFinished(session: SafeSession): void;
  acquire?: (signal: AbortSignal) => Promise<CaptureConnection>;
  makePlayback?: (asset: CallerAudioAsset, blob: Blob, signal: AbortSignal) => CallerPlayback;
  now?: () => number; newClockId?: () => string;
}
class ConversationError extends Error { constructor(readonly code: ConversationFailure, readonly technical?: TechnicalFailure) { super(code); } }

export function automaticStartBlockedReason(session: SafeSession): string | null {
  if (session.runtimeMode !== "REAL_CONVERSATION") return "Automatic conversation mode is required.";
  if (session.consent.status !== "granted") return "Session consent is required before microphone preparation can start.";
  if (session.state !== "READY" || session.conversation?.phase !== "IDLE" || session.turnNumber !== 0 || session.terminalState !== null) return "This conversation has already started or ended; automatic startup is unavailable.";
  return null;
}

/** One deterministic drive owns the session. React rerenders receive facts, never drive provider work. */
export class BoundedConversationController {
  private state: ConversationUiState = "IDLE";
  private session: SafeSession;
  private used = false;
  private generation = 0;
  private readonly abort = new AbortController();
  private origin = 0;
  private clockId = "";
  private lastTime = 0;
  private microphone: ReusableMicrophone | undefined;
  private learner: BrowserAudioController | undefined;
  private playback: CallerPlayback | undefined;
  private rejectPending: ((cause: unknown) => void) | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private callers: CallerObservation[] = [];
  private diagnostics: AudioDiagnostics | null = null;
  private latestResult: RealVoiceTurnResult | null = null;
  private error: ConversationFailure | null = null;
  private technical: TechnicalFailure | null = null;
  constructor(private readonly options: Options) { this.session = options.session; }
  snapshot(): ConversationSnapshot { return { state: this.state, session: this.session, clockId: this.clockId,
    callers: this.callers.map((value) => ({ ...value })), diagnostics: this.diagnostics, latestResult: this.latestResult, error: this.error, technical: this.technical,
    microphone: this.microphone?.snapshot() ?? null }; }
  private notify(): void { this.options.onChange(this.snapshot()); }
  private setState(state: ConversationUiState): void { this.state = state; this.notify(); }
  private clock(): number {
    const value = (this.options.now ?? (() => performance.now()))() - this.origin;
    if (!Number.isFinite(value) || value < this.lastTime || value > CONVERSATION_CLOCK_LIMIT_MS) throw new ConversationError("SESSION_TIMEOUT");
    this.lastTime = value; return value;
  }
  private active(generation: number): void { if (generation !== this.generation || this.abort.signal.aborted) throw new ConversationError("PROVIDER_FAILED"); }
  private update(session: SafeSession): void {
    if (session.sessionId !== this.session.sessionId || session.scenarioVersion !== this.session.scenarioVersion
      || session.runtimeMode !== "REAL_CONVERSATION" || session.turnNumber < this.session.turnNumber) throw new ConversationError("PROVIDER_FAILED");
    this.session = session; this.options.onSession(session); this.notify();
  }
  start(session: SafeSession = this.session): void {
    if (this.used || this.state !== "IDLE" || session.sessionId !== this.session.sessionId || automaticStartBlockedReason(session)) return;
    this.session = session; this.used = true;
    this.origin = (this.options.now ?? (() => performance.now()))(); this.clockId = (this.options.newClockId ?? (() => crypto.randomUUID()))();
    const generation = ++this.generation;
    this.deadline = setTimeout(() => { void this.fail(new ConversationError("SESSION_TIMEOUT")); }, CONVERSATION_CLOCK_LIMIT_MS);
    void this.drive(generation).catch((error: unknown) => { if (generation === this.generation) void this.fail(error); });
  }
  private async drive(generation: number): Promise<void> {
    this.setState("MIC_PREPARING");
    // Invoke the existing permission path from the explicit start gesture, before any network await.
    const driver = await (this.options.acquire ?? acquireBrowserMicrophone)(this.abort.signal);
    if (generation !== this.generation) { driver.stop(); return; }
    this.microphone = new ReusableMicrophone(driver, () => this.clock());
    const startedSession = await this.options.api.conversationAction!(this.session.sessionId, "start", { audioClockId: this.clockId }, this.abort.signal);
    this.active(generation); this.update(startedSession);
    await this.microphone.start((error) => { void this.fail(new ConversationError("LEARNER_AUDIO_FAILED", error.technical)); });
    this.active(generation);
    while (true) {
      this.active(generation);
      const terminal = this.session.terminalState !== null;
      if (this.session.conversation?.phase === "STOPPED") { this.cleanup(); this.setState("STOPPED"); this.options.onFinished(this.session); return; }
      if (!terminal && this.session.turnNumber >= this.session.maxTurns) throw new ConversationError("TURN_LIMIT");
      this.setState("CALLER_PREPARING");
      const responseId = this.session.currentResponseId;
      if (!responseId || !this.options.api.getCallerAudio) throw new ConversationError("CALLER_AUDIO_FAILED");
      if (terminal) { this.microphone?.stop(); this.microphone = undefined; }
      const audio = await this.options.api.getCallerAudio(this.session.sessionId, this.session.turnNumber, responseId, this.abort.signal);
      this.active(generation);
      if (audio.asset.sessionId !== this.session.sessionId || audio.asset.turnNumber !== this.session.turnNumber || audio.asset.responseId !== responseId) throw new ConversationError("CALLER_AUDIO_FAILED");
      const caller = await this.play(audio.asset, audio.blob, terminal, generation);
      this.active(generation);
      if (terminal) { this.cleanup(); this.setState("COMPLETED"); this.options.onFinished(this.session); return; }
      const previousTurn = this.session.turnNumber;
      this.setState("LEARNER_PREPARING");
      const calibration = this.microphone!.calibrate(this.abort.signal, previousTurn + 1);
      this.notify();
      const vad = await calibration.catch((error: unknown) => {
        throw new ConversationError("LEARNER_AUDIO_FAILED", error instanceof BrowserAudioError && error.technical ? error.technical
          : { stage: "CALIBRATION", causeCode: "CALIBRATION_INVALID_INPUT", providerAttempted: false });
      });
      this.active(generation);
      const result = await this.listen(caller, vad, generation);
      this.active(generation);
      if (result.turn.session.sessionId !== this.session.sessionId || result.turn.session.turnNumber !== previousTurn + 1
        || result.turn.session.timelineEvents.length !== previousTurn + 1 || result.turn.session.pressureTimeline.length !== previousTurn + 1
        || result.turn.learnerTurnEvent.turnId !== `${this.session.sessionId}:turn-${previousTurn + 1}`) throw new ConversationError("PROVIDER_FAILED");
      this.latestResult = result; this.update(result.turn.session); this.options.onTurn(result);
      // Only the committed Finish response can drive the next caller. No speculative policy/TTS call.
    }
  }
  private play(asset: CallerAudioAsset, blob: Blob, terminal: boolean, generation: number): Promise<CallerObservation> {
    const observation: CallerObservation = { position: asset.turnNumber, responseId: asset.responseId, terminal, asset, audioClockId: this.clockId };
    this.callers.push(observation);
    const player = (this.options.makePlayback ?? createCallerPlayback)(asset, blob, this.abort.signal); this.playback = player;
    return new Promise((resolve, reject) => {
      let started = false, ended = false, settled = false;
      const finish = (error?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer); this.abort.signal.removeEventListener("abort", cancel);
        this.rejectPending = undefined;
        if (error) reject(error); else { this.playback = undefined; resolve(observation); }
      };
      const cancel = () => finish(new ConversationError("PROVIDER_FAILED"));
      const timer = setTimeout(() => finish(new ConversationError("CALLER_AUDIO_FAILED")), 65_000);
      this.rejectPending = finish;
      this.abort.signal.addEventListener("abort", cancel, { once: true });
      let startAck: Promise<void> | undefined;
      player.play(() => {
        if (generation !== this.generation || settled || started) return; started = true;
        try {
          observation.startedAtMs = this.clock(); this.setState(terminal ? "TERMINAL_CALLER_PLAYING" : "CALLER_PLAYING");
          startAck = this.options.api.conversationAction!(this.session.sessionId, "caller-start", {
            turnNumber: asset.turnNumber, responseId: asset.responseId, audioClockId: this.clockId, atMs: observation.startedAtMs,
          }, this.abort.signal).then((session) => { this.active(generation); this.update(session); });
          void startAck.catch(finish);
        } catch (error) { finish(error); }
      }, () => {
        if (generation !== this.generation || settled || ended) return; ended = true;
        if (!started || !startAck) { finish(new ConversationError("CALLER_AUDIO_FAILED")); return; }
        try { observation.endedAtMs = this.clock(); } catch (error) { finish(error); return; }
        void startAck.then(async () => {
          this.active(generation);
          const session = await this.options.api.conversationAction!(this.session.sessionId, "caller-ended", {
            turnNumber: asset.turnNumber, responseId: asset.responseId, audioClockId: this.clockId, atMs: observation.endedAtMs,
          }, this.abort.signal);
          this.active(generation); this.update(session); finish();
        }).catch(finish);
      }, (technical) => finish(new ConversationError("CALLER_AUDIO_FAILED", technical ?? { stage: "CALLER_PLAYBACK", causeCode: "PLAYBACK_FAILED", providerAttempted: null })));
    });
  }
  private listen(caller: CallerObservation, vad: import("./vad.js").LocalVad, generation: number): Promise<RealVoiceTurnResult> {
    this.setState("LEARNER_PREPARING");
    return new Promise((resolve, reject) => {
      this.rejectPending = reject; let result: RealVoiceTurnResult | undefined, settled = false;
      const settle = (error?: unknown) => {
        if (settled) return; settled = true; this.rejectPending = undefined;
        if (error) reject(error); else if (result) resolve(result); else reject(new ConversationError("PROVIDER_FAILED"));
      };
      const learner: BrowserAudioController = new BrowserAudioController({ sessionId: this.session.sessionId, turnNumber: this.session.turnNumber + 1,
        eligible: () => generation === this.generation && this.learner === learner && !this.abort.signal.aborted && !this.session.terminalState,
        acquire: async () => this.microphone!.lease(this.session.turnNumber + 1), createVad: () => vad,
        ...(this.options.now ? { readClock: this.options.now } : {}), sessionClock: { origin: this.origin, audioClockId: this.clockId, callerStartedAtMs: caller.startedAtMs!, callerEndedAtMs: caller.endedAtMs! },
        forwarder: (onError) => this.options.api.createRealAudioForwarder!(this.session.sessionId, onError, (value) => { result = value; }),
        finishOnSpeechEnd: true, noSpeechTimeoutMs: REAL_TURN_LIMITS.noSpeechMs, maxCaptureMs: REAL_TURN_LIMITS.captureMs,
        onChange: (snapshot) => {
          if (generation !== this.generation || settled || this.learner !== learner) return;
          this.diagnostics = snapshot;
          if (["LISTENING", "SPEECH_ACTIVE"].includes(snapshot.state)) this.setState("LEARNER_LISTENING");
          else if (snapshot.state === "FINISHING") this.setState("LEARNER_FINALIZING");
          else this.notify();
          if (snapshot.error) settle(new ConversationError(snapshot.error.code === "CREDIT_LIMIT_REACHED" ? "CREDIT_LIMIT_REACHED"
            : snapshot.error.detail?.stage.startsWith("TRANSPORT_") ? "PROVIDER_FAILED" : "LEARNER_AUDIO_FAILED", snapshot.error.technical));
          else if (snapshot.state === "COMPLETED") settle();
        },
      });
      this.learner = learner;
      void learner.prepare().catch(settle);
    });
  }
  finishLearner(): void { if (this.state === "LEARNER_LISTENING") void this.learner?.finish(); }
  private cleanup(): void {
    this.abort.abort(); this.playback?.stop(); this.playback = undefined; this.learner?.stop(); this.learner = undefined;
    this.microphone?.stop(); this.microphone = undefined; if (this.deadline) clearTimeout(this.deadline); this.deadline = undefined;
  }
  private async fail(cause: unknown): Promise<void> {
    if (["ERROR", "COMPLETED", "STOPPED"].includes(this.state)) return;
    this.technical = cause instanceof ConversationError || cause instanceof SessionApiError || cause instanceof BrowserAudioError ? cause.technical ?? null : null;
    this.error = cause instanceof ConversationError ? cause.code : cause instanceof SessionApiError && cause.code === "CREDIT_LIMIT_REACHED" ? "CREDIT_LIMIT_REACHED"
      : ["CALLER_PREPARING", "CALLER_PLAYING", "TERMINAL_CALLER_PLAYING"].includes(this.state) ? "CALLER_AUDIO_FAILED" : "PROVIDER_FAILED";
    const generation = ++this.generation; this.rejectPending?.(cause); this.rejectPending = undefined; this.cleanup(); this.setState("ERROR");
    try {
      const session = await this.options.api.conversationAction!(this.session.sessionId, "fail", { code: this.error, ...(this.technical ? { technical: this.technical } : {}) });
      if (generation === this.generation && this.state === "ERROR") this.update(session);
    } catch { /* Preserve local typed failure and last committed session facts. */ }
  }
  stop(): void { if (["COMPLETED", "STOPPED", "ERROR"].includes(this.state)) return; ++this.generation; this.rejectPending?.(new ConversationError("PROVIDER_FAILED")); this.rejectPending = undefined; this.cleanup(); this.setState("STOPPED"); }
  dispose(): void {
    // Effect replay/unmount of an untouched controller is cleanup, not an intentional session stop.
    if (!this.used) return;
    const active = !["COMPLETED", "STOPPED", "ERROR"].includes(this.state);
    if (active) { this.stop(); void this.options.api.endSession(this.session.sessionId).catch(() => {}); }
  }
}
