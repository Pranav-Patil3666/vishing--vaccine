import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import { evaluateCreditRequest } from "@vaccine/credit-guard";
import { ApplicationError } from "../../errors.js";
import { createSessionMonotonicClock } from "../../timing.js";
import { inspectCandidateEvent, type SanitizedEvent } from "./verificationEvents.js";
import { loadSyntheticFixture, type SyntheticFixture, type VerificationConfig } from "./verificationConfig.js";

type SocketEvents = {
  open: []; message: [Uint8Array, boolean]; close: [number]; failure: [];
  upgradeRejected: [number]; ping: []; pong: [];
};
export abstract class VerificationSocket extends EventEmitter<SocketEvents> {
  abstract send(bytes: Uint8Array): Promise<void>;
  abstract close(): void;
  abstract terminate(): void;
}
class ProviderVerificationSocket extends VerificationSocket {
  private readonly socket: WebSocket;
  constructor(config: VerificationConfig) {
    super();
    this.socket = new WebSocket(config.endpoint, { headers: config.headers,
      followRedirects: false, handshakeTimeout: 5000, maxPayload: 32768, perMessageDeflate: false });
    this.socket.on("open", () => this.emit("open"));
    this.socket.on("message", (data: RawData, binary: boolean) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
      this.emit("message", bytes, binary);
    });
    this.socket.on("close", (code) => this.emit("close", code));
    this.socket.on("error", () => this.emit("failure"));
    this.socket.on("unexpected-response", (_request, response) => {
      this.emit("upgradeRejected", response.statusCode ?? 0);
      response.destroy();
      this.socket.terminate();
    });
    this.socket.on("ping", () => this.emit("ping"));
    this.socket.on("pong", () => this.emit("pong"));
  }
  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => this.socket.send(bytes, { binary: true }, (error) => error ? reject(new Error()) : resolve()));
  }
  close(): void { this.socket.close(1000); }
  terminate(): void { this.socket.terminate(); }
}

export interface VerificationDependencies {
  createSocket?: (config: VerificationConfig) => VerificationSocket;
  loadFixture?: (config: VerificationConfig) => Promise<SyntheticFixture>;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  emit?: (diagnostic: VerificationDiagnostic) => void;
  // Offline tests may shorten bounds. CLI uses the fixed bounded defaults.
  deadlineMs?: number;
  drainMs?: number;
  closeWaitMs?: number;
}
export type VerificationDiagnostic = SanitizedEvent | {
  eventType: "credit-approved" | "socket-open" | "audio-sent" | "close-requested" | "socket-closed" | "upgrade-rejected" | "ping" | "pong";
  receivedAtMonotonicMs: number;
  frameCount?: number; minFrameBytes?: number; maxFrameBytes?: number; sentAudioDurationMs?: number;
  closeCode?: number; httpStatus?: number;
};
export interface VerificationResult { transcriptCount: number; frameCount: number; closeCode: number; localElapsedMs: number }

/** One opt-in connection. Never imported by /health, sessions, or the production recognizer. */
export async function verifyPrisma(config: VerificationConfig, dependencies: VerificationDependencies = {}): Promise<VerificationResult> {
  return runVerification(config, dependencies, false);
}

/** Explicit controlled negative path. Baseline validation and credentials remain unchanged. */
export async function verifyPrismaMissingAuth(config: VerificationConfig, dependencies: VerificationDependencies = {}): Promise<{ result: "expected-auth-rejection"; httpStatus?: number }> {
  let rejection: { httpStatus?: number } | undefined;
  try {
    await runVerification(config, { ...dependencies, emit: (diagnostic) => {
      dependencies.emit?.(diagnostic);
      if (diagnostic.eventType === "upgrade-rejected" && [401, 403].includes(diagnostic.httpStatus ?? 0)) {
        rejection = { httpStatus: diagnostic.httpStatus! };
      } else if (diagnostic.eventType === "error") rejection = {};
    } }, true);
  } catch (error) {
    if (rejection && error instanceof ApplicationError && error.code === "TRANSCRIPTION_FAILED") {
      return { result: "expected-auth-rejection", ...rejection };
    }
    throw error;
  }
  throw new ApplicationError("TRANSCRIPTION_FAILED", "Missing-auth probe did not establish an authentication rejection.");
}

async function runVerification(config: VerificationConfig, dependencies: VerificationDependencies, missingAuth: boolean): Promise<VerificationResult> {
  const fixture = await (dependencies.loadFixture ?? loadSyntheticFixture)(config);
  const authorization = evaluateCreditRequest({ mode: "development", developmentCap: config.credit.cap,
    publicDemoCap: 0, reserveCap: config.credit.reserve, usedUnits: config.credit.used },
  { operation: "prisma-realtime-verification", estimatedUnits: config.credit.estimated, cacheAvailable: false });
  if (!authorization.allowed) throw new ApplicationError("CREDIT_LIMIT_REACHED", "Configured verification credit budget does not permit a connection.");

  const clock = createSessionMonotonicClock(dependencies.now);
  const emit = dependencies.emit ?? (() => {});
  const wait = dependencies.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  const abort = new AbortController();
  let rejectFailure!: (error: ApplicationError) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  // The closure is called only after the promise constructor has assigned it.
  let failed = false;
  let failureError: ApplicationError | undefined;
  function fail(message: string): void {
    if (!failed) { failed = true; failureError = new ApplicationError("TRANSCRIPTION_FAILED", message); rejectFailure(failureError); }
  }
  void failure.catch(() => {});
  const race = async <T>(work: Promise<T>): Promise<T> => {
    if (failureError) { void work.catch(() => {}); throw failureError; }
    const value = await Promise.race([work, failure]);
    if (failureError) throw failureError;
    return value;
  };
  let resolveConnected!: () => void;
  const connected = new Promise<void>((resolve) => { resolveConnected = resolve; });
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  let socket: VerificationSocket | undefined;
  let opened = false;
  let serverConnected = false;
  let closing = false;
  let closed = false;
  let closeCode = 0;
  let transcriptCount = 0;
  let eventCount = 0;
  let frameCount = 0;
  let minFrameBytes = Infinity;
  let maxFrameBytes = 0;
  const deadline = setTimeout(() => fail("Prisma verification timed out."), dependencies.deadlineMs ?? 20000);
  const publish = (diagnostic: VerificationDiagnostic) => { if (++eventCount > 100) fail("Prisma verification event limit exceeded."); else emit(diagnostic); };
  try {
    publish({ eventType: "credit-approved", receivedAtMonotonicMs: clock.now() });
    const socketConfig = missingAuth ? { ...config, headers: Object.fromEntries(Object.entries(config.headers)
      .filter(([name]) => name !== config.authHeaderName)) } : config;
    socket = (dependencies.createSocket ?? ((configuration) => new ProviderVerificationSocket(configuration)))(socketConfig);
    socket.on("open", () => { opened = true; publish({ eventType: "socket-open", receivedAtMonotonicMs: clock.now() }); });
    socket.on("failure", () => fail("Prisma verification connection or authentication failed."));
    socket.on("upgradeRejected", (status) => {
      publish({ eventType: "upgrade-rejected", receivedAtMonotonicMs: clock.now(), httpStatus: status });
      fail("Prisma rejected the WebSocket upgrade.");
    });
    socket.on("ping", () => publish({ eventType: "ping", receivedAtMonotonicMs: clock.now() }));
    socket.on("pong", () => publish({ eventType: "pong", receivedAtMonotonicMs: clock.now() }));
    socket.on("close", (code) => {
      closed = true; closeCode = code;
      publish({ eventType: "socket-closed", receivedAtMonotonicMs: clock.now(), closeCode: code });
      if (!closing || code !== 1000) fail("Prisma closed unexpectedly during verification.");
      resolveClosed();
    });
    socket.on("message", (bytes, binary) => {
      if (failed) return;
      try {
        if (!opened || binary || bytes.length > 32768) throw new Error();
        const inspected = inspectCandidateEvent(new TextDecoder("utf-8", { fatal: true }).decode(bytes), clock.now(), fixture.expectedText,
          fixture.parts?.map((part) => part.phrase));
        publish(inspected.diagnostic);
        const event = inspected.event;
        if (!event) { fail("Prisma emitted an unsupported verification event; review sanitized diagnostics before changing the candidate parser."); return; }
        if (event.type === "error") { fail("Prisma reported a verification error."); return; }
        if (event.type === "connected") {
          if (serverConnected || closing) throw new Error();
          serverConnected = true; resolveConnected();
        } else if (!serverConnected || closing) throw new Error();
        if (event.type === "transcript") transcriptCount++;
      } catch { fail("Prisma returned malformed data or an invalid verification lifecycle."); }
    });
    await race(connected);
    if (missingAuth) throw new ApplicationError("TRANSCRIPTION_FAILED", "Missing-auth probe unexpectedly connected; no audio sent.");
    // Two seconds of generated zero PCM are a local flush experiment, not a verified EOS protocol.
    const audio = new Uint8Array(fixture.bytes.length + config.sampleRateHz * 2 * 2);
    audio.set(fixture.bytes);
    const startedAt = clock.now();
    let nextSendAt = startedAt;
    let sentBytes = 0;
    for (let offset = 0; offset < audio.length; offset += config.frameBytes) {
      await race(wait(Math.max(0, nextSendAt - clock.now()), abort.signal));
      const source = audio.subarray(offset, Math.min(audio.length, offset + config.frameBytes));
      const frame = source.length === config.frameBytes || config.trailingPartial ? source : new Uint8Array(config.frameBytes);
      if (frame !== source) frame.set(source);
      await race(socket.send(frame));
      // Never compensate for a slow callback by bursting a backlog of frames.
      nextSendAt = clock.now() + frame.length / (config.sampleRateHz * 2) * 1000;
      sentBytes += frame.length; frameCount++;
      minFrameBytes = Math.min(minFrameBytes, frame.length); maxFrameBytes = Math.max(maxFrameBytes, frame.length);
    }
    await race(wait(Math.max(0, nextSendAt - clock.now()), abort.signal));
    publish({ eventType: "audio-sent", receivedAtMonotonicMs: clock.now(), frameCount, minFrameBytes, maxFrameBytes,
      sentAudioDurationMs: sentBytes / (config.sampleRateHz * 2) * 1000 });
    await race(wait(dependencies.drainMs ?? 3000, abort.signal));
    if (transcriptCount === 0) throw new ApplicationError("TRANSCRIPTION_FAILED", "Prisma verification received no transcript before the bounded drain ended.");
    closing = true;
    publish({ eventType: "close-requested", receivedAtMonotonicMs: clock.now() });
    socket.close();
    await race(Promise.race([closedPromise, wait(dependencies.closeWaitMs ?? 1000, abort.signal).then(() => { throw new Error(); })]));
    return { transcriptCount, frameCount, closeCode, localElapsedMs: clock.now() };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("TRANSCRIPTION_FAILED", "Prisma verification failed without a valid result.");
  } finally {
    abort.abort(); clearTimeout(deadline);
    if (socket) {
      try { if (!closed) socket.terminate(); } catch { /* No raw transport error escapes. */ }
      socket.removeAllListeners();
    }
  }
}
