import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import { BrowserAudioStartSchema, BrowserAudioTimingFactsSchema } from "@vaccine/contracts";
import { ApplicationError } from "./errors.js";
import type { InMemorySessionStore } from "./sessionStore.js";
import { summarizeBrowserAudio } from "./browserAudioTiming.js";

interface AudioWindow {
  token: string; sessionId: string; turnNumber: number; audioClockId: string;
  expires: number; frameCount: number; lastProducedAt: number; inFlight: boolean;
}

/** Development sink only: keeps counts/identity, never PCM, transcripts or provider configuration. */
export class BrowserAudioIngress {
  private readonly windows = new Map<string, AudioWindow>();
  constructor(private readonly environment: string, private readonly store: InMemorySessionStore,
    private readonly now: () => number = () => performance.now()) {}

  async handle(request: IncomingMessage, response: ServerResponse, sessionId: string, action: string): Promise<void> {
    if (this.environment !== "development" && this.environment !== "test") throw new ApplicationError("INVALID_STATE", "Browser audio diagnostics are development-only.");
    const remote = request.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") throw new ApplicationError("INVALID_STATE", "Browser audio diagnostics require a local connection.");
    let hostname: string;
    try { hostname = new URL(`http://${request.headers.host}`).hostname; }
    catch { throw new ApplicationError("INVALID_REQUEST", "Invalid local audio host."); }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) throw new ApplicationError("INVALID_REQUEST", "Audio diagnostics require a loopback host.");
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) throw new ApplicationError("INVALID_REQUEST", "Cross-origin audio requests are not allowed.");
    const state = this.store.get(sessionId);
    if (state.consent.status !== "granted" || !state.recordingEnabled) throw new ApplicationError("CONSENT_REQUIRED", "Current session consent is required for microphone diagnostics.");
    if (!["READY", "LISTENING", "FALLBACK"].includes(state.state) || state.terminalState) throw new ApplicationError("INVALID_STATE", "Session is not ready for microphone diagnostics.");
    for (const [token, window] of this.windows) if (window.expires <= this.now()) this.windows.delete(token);
    if (action === "start") {
      const parsed = BrowserAudioStartSchema.safeParse(await readJson(request));
      if (!parsed.success || parsed.data.turnNumber !== state.turnNumber + 1) throw new ApplicationError("INVALID_REQUEST", "Invalid audio window identity.");
      const latest = this.store.get(sessionId);
      if (latest.consent.status !== "granted" || !latest.recordingEnabled || latest.turnNumber !== state.turnNumber || latest.state !== state.state) throw new ApplicationError("INVALID_STATE", "Audio window is no longer eligible.");
      if (this.windows.size >= 16 || [...this.windows.values()].some((window) => window.sessionId === sessionId)) throw new ApplicationError("RATE_LIMITED", "An audio window is already active or the development limit was reached.");
      const token = randomUUID();
      this.windows.set(token, { ...parsed.data, token, sessionId, expires: this.now() + 60_000, frameCount: 0, lastProducedAt: -1, inFlight: false });
      json(response, { token, maxDurationMs: 60_000 }); return;
    }
    const token = request.headers["x-audio-token"];
    const window = typeof token === "string" ? this.windows.get(token) : undefined;
    if (!window || window.sessionId !== sessionId || window.turnNumber !== state.turnNumber + 1) throw new ApplicationError("INVALID_STATE", "Audio window is missing, expired or belongs to another turn.");
    if (action === "cancel") { this.windows.delete(window.token); json(response, { stopped: true }); return; }
    if (window.inFlight) throw new ApplicationError("RATE_LIMITED", "Only one audio request may be in flight per window.");
    if (action === "frame") {
      if (request.headers["content-type"] !== "application/octet-stream" || Number(request.headers["x-audio-sequence"]) !== window.frameCount
        || window.frameCount >= 1876) throw new ApplicationError("INVALID_REQUEST", "Invalid PCM frame sequence, type or window limit.");
      const producedAt = Number(request.headers["x-audio-produced-at"]);
      if (!Number.isFinite(producedAt) || producedAt < 0 || producedAt > 120_000 || producedAt < window.lastProducedAt) throw new ApplicationError("INVALID_TIMING", "Invalid browser frame clock.");
      // Bounded read, zero each chunk immediately, keep only its size. Any PCM16LE bit pattern is valid audio.
      window.inFlight = true;
      try {
        let size = 0;
        for await (const chunk of request) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length; bytes.fill(0);
          if (size > 1024) throw new ApplicationError("INVALID_REQUEST", "PCM frame exceeds 1024 bytes.");
        }
        if (size !== 1024) throw new ApplicationError("INVALID_REQUEST", "PCM frames must be exactly 1024 bytes.");
        // Recheck consent/turn/expiry after asynchronous body reception.
        const latest = this.store.get(sessionId);
        if (latest.consent.status !== "granted" || !latest.recordingEnabled || latest.turnNumber + 1 !== window.turnNumber || this.now() >= window.expires || !this.windows.has(window.token)) throw new ApplicationError("INVALID_STATE", "Audio window is no longer eligible.");
        window.frameCount++; window.lastProducedAt = producedAt;
        json(response, { accepted: true }); return;
      } finally { window.inFlight = false; }
    }
    if (action === "finish") {
      this.windows.delete(window.token);
      const parsed = BrowserAudioTimingFactsSchema.safeParse(await readJson(request));
      if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.audioClockId !== window.audioClockId || parsed.data.turnNumber !== window.turnNumber) throw new ApplicationError("INVALID_TIMING", "Browser timing facts do not match this audio window.");
      const latest = this.store.get(sessionId);
      if (latest.consent.status !== "granted" || !latest.recordingEnabled || latest.turnNumber + 1 !== window.turnNumber || this.now() >= window.expires) throw new ApplicationError("INVALID_STATE", "Audio window is no longer eligible.");
      json(response, summarizeBrowserAudio(parsed.data, window.frameCount)); return;
    }
    throw new ApplicationError("INVALID_REQUEST", "Unknown audio diagnostic action.");
  }
  cancelSession(sessionId: string): void {
    for (const [token, window] of this.windows) if (window.sessionId === sessionId) this.windows.delete(token);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
    if (size > 49_152) throw new ApplicationError("INVALID_REQUEST", "Audio fact request is too large.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value));
}
