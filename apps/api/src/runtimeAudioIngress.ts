import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  BrowserAudioStartSchema, BrowserAudioTimingFactsSchema, REAL_TURN_LIMITS, RealVoiceTurnResultSchema,
  type BrowserAudioTimingFacts, type RealVoiceStatus, type SafeSession, type SessionState,
  type SpeechRecognizer, type StreamingRecognitionSession,
} from "@vaccine/contracts";
import { isScenarioRuntimeEligible, type ScenarioDocument } from "@vaccine/scenario-schema";
import { ApplicationError, withTechnical } from "./errors.js";
import { captureBrowserAudioTiming, summarizeBrowserAudio } from "./browserAudioTiming.js";
import type { InMemorySessionStore } from "./sessionStore.js";
import { redactSensitiveText, type TurnOrchestrator } from "./turnOrchestrator.js";

interface RuntimeWindow {
  token: string; sessionId: string; turnNumber: number; audioClockId: string;
  stream: StreamingRecognitionSession; frameCount: number; lastProducedAt: number;
  state: "CONNECTING" | "CAPTURING" | "FINISHING"; inFlight: boolean;
  timer: ReturnType<typeof setTimeout>; result?: Promise<unknown>;
  captureFloorMs: number;
  captureCeilingMs: number;
}

/** Local opt-in, turn-bounded route. Keeps identity/counts and a bounded transient frame only. */
export class RuntimeAudioIngress {
  private readonly windows = new Map<string, RuntimeWindow>();
  constructor(private readonly environment: string, private readonly store: InMemorySessionStore,
    private readonly scenarios: ReadonlyMap<string, ScenarioDocument>, private readonly orchestrator: TurnOrchestrator,
    private readonly recognizer: SpeechRecognizer | undefined, private readonly projectSession: (state: SessionState) => SafeSession,
    private readonly callerAudioAvailable: () => boolean = () => false) {}

  status(sessionId: string): RealVoiceStatus {
    const session = this.store.get(sessionId), scenario = this.scenarios.get(session.scenarioId);
    const root = scenario?.nodes.find((node) => node.parent_node_id === null);
    const opening = root ? scenario?.responses[root.response_id] : undefined;
    const content = Boolean(scenario && scenario.scenario_id === "S-01" && scenario.language === "hi-IN"
      && scenario.adaptive_policy && isScenarioRuntimeEligible(scenario) && opening && opening.safety_status !== "draft");
    const mode = this.environment === "development" || this.environment === "test";
    const reason = !content ? "CONTENT_UNAVAILABLE" : !mode || !this.recognizer?.openStream ? "DISABLED"
      : (session.runtimeMode === "REAL_CONVERSATION"
        ? session.turnNumber >= session.maxTurns || !["LEARNER_LISTENING", "LEARNER_FINALIZING"].includes(session.conversation?.phase ?? "")
        : session.turnNumber !== 0 || session.runtimeMode !== "REAL_STT")
        || session.mode !== "safe" || session.terminalState ? "TURN_UNAVAILABLE" : "READY";
    return { available: reason === "READY", reason, openingText: content ? opening!.text : null, language: "hi-IN", playback: "mock_cue_only" };
  }
  private eligible(window: Pick<RuntimeWindow, "sessionId" | "turnNumber">): void {
    const state = this.store.get(window.sessionId);
    if (!this.status(window.sessionId).available || state.turnNumber + 1 !== window.turnNumber
      || !["READY", "LISTENING", "FALLBACK"].includes(state.state)) throw new ApplicationError("INVALID_STATE", "Real learner turn is unavailable or stale.");
    if (state.consent.status !== "granted" || !state.recordingEnabled) throw new ApplicationError("CONSENT_REQUIRED", "Simulation and microphone consent are required.");
  }
  async handle(request: IncomingMessage, response: ServerResponse, sessionId: string, action: string): Promise<void> {
    try { await this.handleRequest(request, response, sessionId, action); }
    catch (error) {
      const attempted = action !== "start" && (this.orchestrator.creditDiagnostics().events.filter((event) => event.operation === "stt" && event.sessionId === sessionId).at(-1)?.providerAttempted ?? false);
      throw withTechnical(error, action === "start" ? "STT_START" : action === "frame" ? "STT_STREAM" : "STT_FINALIZE", attempted);
    }
  }
  private async handleRequest(request: IncomingMessage, response: ServerResponse, sessionId: string, action: string): Promise<void> {
    requireLocalRuntimeRequest(request, this.environment);
    if (request.method === "GET" && action === "status") { json(response, this.status(sessionId)); return; }
    if (request.method !== "POST") throw new ApplicationError("INVALID_REQUEST", "Unsupported real audio action.");
    if (action === "start") {
      const identity = BrowserAudioStartSchema.extend({ microphoneConsent: z.literal(true) }).safeParse(await readJson(request));
      if (!identity.success) throw new ApplicationError("INVALID_REQUEST", "Explicit microphone consent and audio identity are required.");
      if (!this.status(sessionId).available) throw new ApplicationError("STT_UNAVAILABLE", "Real STT requires configured access and approved S-01 Hindi content.");
      this.eligible({ sessionId, turnNumber: identity.data.turnNumber });
      const session = this.store.get(sessionId);
      if (session.runtimeMode === "REAL_CONVERSATION" && (session.conversation?.phase !== "LEARNER_LISTENING"
        || identity.data.audioClockId !== session.conversation.audioClockId || session.conversation.caller?.endedAtMs === undefined)) throw new ApplicationError("INVALID_TIMING", "Actual caller completion and the session browser clock are required.");
      if (this.windows.size >= 4 || [...this.windows.values()].some((window) => window.sessionId === sessionId)) throw new ApplicationError("RATE_LIMITED", "A real learner audio window is already active or capacity is reached.");
      if (request.aborted || response.destroyed) throw new ApplicationError("STT_CANCELLED", "Capture was cancelled before provider start.");
      const reservation = this.orchestrator.reserveRecognition(sessionId);
      let stream: StreamingRecognitionSession;
      try {
        stream = this.recognizer!.openStream!({ sessionId, turnNumber: identity.data.turnNumber, language: "hi-IN" });
        reservation.attempted();
      } catch (error) { reservation.releaseBeforeAttempt(); throw withTechnical(error, "STT_START", false); }
      const token = randomUUID();
      const window: RuntimeWindow = { ...identity.data, token, sessionId, stream, frameCount: 0, lastProducedAt: -1,
        captureFloorMs: session.conversation?.caller?.endedAtMs ?? 0,
        captureCeilingMs: session.runtimeMode === "REAL_CONVERSATION" ? (session.conversation?.caller?.endedAtMs ?? 0) + REAL_TURN_LIMITS.captureMs + REAL_TURN_LIMITS.startRequestMs + 1000 : REAL_TURN_LIMITS.captureMs + 1000,
        state: "CONNECTING", inFlight: false, timer: setTimeout(() => {
          if (this.windows.get(token) === window) this.dispose(window);
        }, REAL_TURN_LIMITS.totalMs) };
      this.windows.set(token, window); this.onDisconnect(request, response, window);
      try {
        await stream.ready; this.eligible(window);
        if (!this.windows.has(token)) throw new ApplicationError("STT_CANCELLED", "Real audio capture was cancelled.");
        window.state = "CAPTURING"; json(response, { token, maxDurationMs: REAL_TURN_LIMITS.captureMs });
      } catch (error) { this.dispose(window); throw withTechnical(error, "STT_START", true); }
      return;
    }
    const header = request.headers["x-audio-token"], window = typeof header === "string" ? this.windows.get(header) : undefined;
    if (!window || window.sessionId !== sessionId) throw new ApplicationError("INVALID_STATE", "Real audio token is expired or belongs to another session.");
    this.onDisconnect(request, response, window);
    if (action === "cancel") { this.dispose(window); json(response, { stopped: true }); return; }
    if (action === "finish" && window.result) { json(response, await window.result); return; }
    try { this.eligible(window); } catch (error) { this.dispose(window); throw error; }
    if (window.state !== "CAPTURING" || window.inFlight) throw new ApplicationError("INVALID_STATE", "Real audio window is busy or finishing.");
    if (action === "frame") {
      const producedAt = Number(request.headers["x-audio-produced-at"]);
      if (request.headers["content-type"] !== "application/octet-stream" || request.headers["x-audio-sequence"] !== String(window.frameCount)
        || window.frameCount >= REAL_TURN_LIMITS.maxFrames || !Number.isFinite(producedAt) || producedAt < window.lastProducedAt
        || producedAt < window.captureFloorMs || producedAt > window.captureCeilingMs) {
        this.dispose(window); throw new ApplicationError("INVALID_REQUEST", "Invalid real PCM frame or sequence.");
      }
      window.inFlight = true; const frame = new Uint8Array(1024);
      try {
        let offset = 0;
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          try {
            if (offset + bytes.length > 1024) throw new ApplicationError("INVALID_REQUEST", "PCM frame exceeds the expected size.");
            frame.set(bytes, offset); offset += bytes.length;
          } finally { bytes.fill(0); }
        }
        if (offset !== 1024) throw new ApplicationError("INVALID_REQUEST", "PCM frame must be exactly 1024 bytes.");
        this.eligible(window);
        if (!this.windows.has(window.token)) throw new ApplicationError("STT_CANCELLED", "Real audio capture was cancelled.");
        await window.stream.sendFrame(frame);
        this.eligible(window);
        window.frameCount++; window.lastProducedAt = producedAt; json(response, { accepted: true });
      } catch (error) { this.dispose(window); throw error; }
      finally { frame.fill(0); window.inFlight = false; }
      return;
    }
    if (action === "finish") {
      window.state = "FINISHING";
      window.result = this.finish(window, request).finally(() => this.dispose(window));
      json(response, await window.result); return;
    }
    this.dispose(window); throw new ApplicationError("INVALID_REQUEST", "Unknown real audio action.");
  }
  private async finish(window: RuntimeWindow, request: IncomingMessage): Promise<unknown> {
    const parsed = BrowserAudioTimingFactsSchema.safeParse(await readJson(request));
    if (!parsed.success || parsed.data.sessionId !== window.sessionId || parsed.data.turnNumber !== window.turnNumber
      || parsed.data.audioClockId !== window.audioClockId) throw new ApplicationError("INVALID_TIMING", "Real audio timing identity does not match this turn.");
    const facts: BrowserAudioTimingFacts = parsed.data;
    this.eligible(window);
    const session = this.store.get(window.sessionId);
    if (session.runtimeMode === "REAL_CONVERSATION") {
      const caller = session.conversation!.caller!;
      const start = facts.events.find((fact) => fact.kind === "CALLER_AUDIO_START"), end = facts.events.find((fact) => fact.kind === "CALLER_AUDIO_END");
      if (start?.at.monotonicMs !== caller.startedAtMs || end?.at.monotonicMs !== caller.endedAtMs
        || caller.turnNumber + 1 !== window.turnNumber || caller.responseId !== session.currentResponseId
        || facts.events.some((fact) => fact.kind.startsWith("LEARNER_") && fact.at.monotonicMs < caller.endedAtMs!)) throw new ApplicationError("INVALID_TIMING", "Caller timing does not belong to the immediately preceding response.");
      this.store.update({ ...session, conversation: { ...session.conversation!, phase: "LEARNER_FINALIZING" } });
    }
    const starts = facts.events.filter((event) => event.kind === "LEARNER_SPEECH_START" && event.availability === "available");
    if (!starts.length) throw new ApplicationError("NO_SPEECH", "No local speech was detected. The turn was not advanced.");
    if (!window.frameCount) throw new ApplicationError("INVALID_REQUEST", "A real speech turn requires received PCM frames.");
    // One learner response may have provider segments; local facts describe the whole response window.
    const timing = captureBrowserAudioTiming(facts, starts[0]!.segmentNumber);
    const finalEnd = facts.timingValid ? facts.events.find((event) => event.kind === "LEARNER_SPEECH_END"
      && event.segmentNumber === starts.at(-1)!.segmentNumber && event.availability === "available")?.at : undefined;
    // An unfinished last segment cannot borrow an earlier segment's end to manufacture a duration.
    if (finalEnd) timing.learnerSpeechEndedAt = finalEnd;
    else delete timing.learnerSpeechEndedAt;
    const transcript = await window.stream.finish();
    if (!transcript.text.trim() || transcript.normalizationStatus === "failed") throw new ApplicationError("STT_EMPTY", "Speech was detected but transcription was unavailable. The turn was not advanced.");
    this.eligible(window);
    if (!this.windows.has(window.token)) throw new ApplicationError("STT_CANCELLED", "The real learner turn was cancelled.");
    const result = await this.orchestrator.processRecognizedTurn(window.sessionId, transcript, timing, () => this.windows.has(window.token));
    return RealVoiceTurnResultSchema.parse({ source: "PRISMA_REALTIME", turn: { ...result, session: this.projectSession(result.session) },
      audioSummary: summarizeBrowserAudio(facts, window.frameCount),
      segments: (transcript.segments ?? [{ text: transcript.text }]).map((segment) => ({ ...segment, text: redactSensitiveText(segment.text) })),
      approvedResponseText: result.approvedResponseText,
      callerAudio: { available: this.callerAudioAvailable(), responseId: result.branch.responseId, turnNumber: result.session.turnNumber },
      service: { connectionMs: numeric(transcript.providerMetadata?.connectionMs), firstTranscriptMs: numeric(transcript.providerMetadata?.firstTranscriptMs) } });
  }
  cancelSession(sessionId: string): void { for (const window of this.windows.values()) if (window.sessionId === sessionId) this.dispose(window); }
  close(): void { for (const window of this.windows.values()) this.dispose(window); }
  private dispose(window: RuntimeWindow): void { clearTimeout(window.timer); this.windows.delete(window.token); window.stream.cancel(); }
  private onDisconnect(request: IncomingMessage, response: ServerResponse, window: RuntimeWindow): void {
    request.once("aborted", () => this.dispose(window));
    response.once("close", () => { if (!response.writableEnded) this.dispose(window); });
  }
}
function numeric(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
export function requireLocalRuntimeRequest(request: IncomingMessage, environment: string): void {
  if (!["development", "test"].includes(environment) || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) {
    throw new ApplicationError("STT_UNAVAILABLE", "Real STT is available only in local development.");
  }
  const host = request.headers.host;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { throw new ApplicationError("INVALID_REQUEST", "Invalid local host."); }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)
    || (request.headers.origin && ![`http://${host}`, `https://${host}`].includes(request.headers.origin))) {
    throw new ApplicationError("INVALID_REQUEST", "Cross-origin runtime audio requests are not allowed.");
  }
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > 49_152) throw new ApplicationError("INVALID_REQUEST", "Real audio facts exceed the limit.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function json(response: ServerResponse, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value));
}
