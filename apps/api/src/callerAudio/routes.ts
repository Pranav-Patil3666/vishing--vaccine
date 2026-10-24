import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CallerAudioAssetSchema, CallerAudioRequestSchema, type CallerAudioAsset, type SessionState } from "@vaccine/contracts";
import type { InMemorySessionStore } from "../sessionStore.js";
import { requireLocalRuntimeRequest } from "../runtimeAudioIngress.js";
import { ApplicationError, withTechnical } from "../errors.js";
import type { CallerAudioService } from "./service.js";

interface Asset { metadata: CallerAudioAsset; expires: number; }
/** Session-scoped approved references only. Assets expire; GET can never initiate synthesis. */
export class CallerAudioRoutes {
  private readonly assets = new Map<string, Asset>();
  private readonly endedSessions = new Set<string>();
  private readonly pending = new Map<string, { sessionId: string; abort: AbortController; promise: Promise<CallerAudioAsset> }>();
  constructor(private readonly environment: string, private readonly store: InMemorySessionStore, readonly service?: CallerAudioService) {}
  private eligible(sessionId: string, turnNumber: number, responseId: string): SessionState {
    const session = this.store.get(sessionId);
    if (this.endedSessions.has(sessionId)) throw new ApplicationError("INVALID_STATE", "Caller playback was ended for this session.");
    if (session.consent.status !== "granted") throw new ApplicationError("CONSENT_REQUIRED", "Simulation consent is required before caller synthesis.");
    if (!["REAL_STT", "REAL_CONVERSATION"].includes(session.runtimeMode) || session.mode !== "safe" || session.scenarioId !== "S-01" || session.language !== "hi-IN"
      || session.turnNumber !== turnNumber || session.currentResponseId !== responseId || turnNumber > (session.runtimeMode === "REAL_CONVERSATION" ? session.maxTurns : 1)
      || ["ENDED_BY_LEARNER", "ERROR", "CONSENT_REQUIRED"].includes(session.state)) throw new ApplicationError("INVALID_STATE", "Caller response is unavailable or stale.");
    if (session.runtimeMode === "REAL_CONVERSATION" && !["CALLER_PREPARING", "TERMINAL_CALLER_PREPARING", "CALLER_PLAYING", "TERMINAL_CALLER_PLAYING"].includes(session.conversation?.phase ?? "")) throw new ApplicationError("INVALID_STATE", "Conversation is not preparing or playing this caller response.");
    this.service?.catalog.resolveId(session.scenarioId, session.scenarioVersion, responseId); return session;
  }
  async handle(request: IncomingMessage, response: ServerResponse, sessionId: string, action?: string): Promise<void> {
    try { await this.handleRequest(request, response, sessionId, action); }
    catch (error) { throw withTechnical(error, request.method === "GET" && action !== "status" ? "CALLER_AUDIO_FETCH" : "CALLER_AUDIO_RESOLUTION", false); }
  }
  private async handleRequest(request: IncomingMessage, response: ServerResponse, sessionId: string, action?: string): Promise<void> {
    try { requireLocalRuntimeRequest(request, this.environment); }
    catch (error) {
      if (error instanceof ApplicationError && error.code === "STT_UNAVAILABLE") throw new ApplicationError("TTS_UNAVAILABLE", "Caller audio is available only in local development.");
      throw error;
    }
    for (const [token, asset] of this.assets) if (asset.expires < Date.now()) this.assets.delete(token);
    const session = this.store.get(sessionId);
    if (request.method === "GET" && action === "status") {
      let available = false;
      if (this.service && !this.endedSessions.has(sessionId) && ["REAL_STT", "REAL_CONVERSATION"].includes(session.runtimeMode) && session.mode === "safe" && session.turnNumber <= session.maxTurns
        && session.currentResponseId && !["ENDED_BY_LEARNER", "ERROR"].includes(session.state)) {
        try { this.service.catalog.resolveId(session.scenarioId, session.scenarioVersion, session.currentResponseId); available = true; } catch { /* Honest unavailable status. */ }
      }
      json(response, { available, responseId: session.currentResponseId }); return;
    }
    if (!this.service) throw new ApplicationError("TTS_UNAVAILABLE", "Real caller audio is disabled or unconfigured.");
    if (request.method === "GET" && action) {
      const asset = this.assets.get(action);
      if (!asset || asset.metadata.sessionId !== sessionId) throw new ApplicationError("INVALID_STATE", "Caller audio reference expired or mismatched.");
      this.eligible(sessionId, asset.metadata.turnNumber, asset.metadata.responseId);
      const bytes = await this.service.cache.get(asset.metadata.cacheKey);
      this.eligible(sessionId, asset.metadata.turnNumber, asset.metadata.responseId);
      if (!bytes) throw withTechnical(new ApplicationError("TTS_PROVIDER_FAILED", "Cached caller audio is unavailable. No automatic synthesis."), "TTS_CACHE", false);
      response.writeHead(200, { "content-type": "audio/wav", "content-length": bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(bytes); return;
    }
    if (request.method !== "POST" || action) throw new ApplicationError("INVALID_REQUEST", "Unsupported caller audio action.");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 1024) throw new ApplicationError("INVALID_REQUEST", "Caller request is too large."); chunks.push(bytes); }
    const parsed = CallerAudioRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "Only turn number and approved response identity are accepted.");
    const { turnNumber, responseId } = parsed.data; this.eligible(sessionId, turnNumber, responseId);
    const ready = [...this.assets.values()].find((asset) => asset.metadata.sessionId === sessionId && asset.metadata.turnNumber === turnNumber && asset.metadata.responseId === responseId);
    if (ready) { json(response, ready.metadata); return; }
    const identity = `${sessionId}:${turnNumber}:${responseId}`;
    let work = this.pending.get(identity);
    if (!work) {
      if (this.pending.size >= 4 || this.assets.size >= 64) throw new ApplicationError("RATE_LIMITED", "Caller audio capacity reached.");
      const abort = new AbortController();
      const promise = this.service.get(session.scenarioId, session.scenarioVersion, responseId, sessionId, abort.signal).then((audio) => {
        abort.signal.throwIfAborted(); this.eligible(sessionId, turnNumber, responseId);
        const token = randomUUID(), { bytes: _bytes, ...facts } = audio;
        const metadata = CallerAudioAssetSchema.parse({ ...facts, sessionId, turnNumber, responseId,
          audioUrl: `/api/sessions/${encodeURIComponent(sessionId)}/caller-audio/${token}`,
          provider: this.service!.profile.provider, model: this.service!.profile.model, voice: this.service!.profile.voice, language: this.service!.profile.language });
        const currentSession = this.store.get(sessionId);
        this.store.update({ ...currentSession, cache: { hits: currentSession.cache.hits + (audio.cacheHit ? 1 : 0), misses: currentSession.cache.misses + (audio.cacheHit ? 0 : 1) } });
        this.assets.set(token, { metadata, expires: Date.now() + 120_000 }); return metadata;
      }).catch((error: unknown) => {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(abort.signal.aborted ? "TTS_CANCELLED" : "TTS_PROVIDER_FAILED", "Caller audio could not complete. No automatic retry.");
      }).finally(() => this.pending.delete(identity));
      work = { sessionId, abort, promise }; this.pending.set(identity, work);
    }
    const current = work;
    const disconnect = () => { if (!response.writableEnded) current.abort.abort(); };
    response.once("close", disconnect);
    try { const metadata = await current.promise; this.eligible(sessionId, turnNumber, responseId); if (!response.destroyed) json(response, metadata); }
    finally { response.off("close", disconnect); }
  }
  cancelSession(sessionId: string): void {
    this.store.get(sessionId); // Never retain tombstones for arbitrary unknown identifiers.
    this.endedSessions.add(sessionId);
    for (const work of this.pending.values()) if (work.sessionId === sessionId) work.abort.abort();
    for (const [token, asset] of this.assets) if (asset.metadata.sessionId === sessionId) this.assets.delete(token);
  }
  close(): void { for (const work of this.pending.values()) work.abort.abort(); this.assets.clear(); this.endedSessions.clear(); }
}
function json(response: ServerResponse, body: unknown): void { response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
