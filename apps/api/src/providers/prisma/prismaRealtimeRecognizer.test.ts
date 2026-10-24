import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import WebSocket from "ws";
import { ApplicationError } from "../../errors.js";
import { PrismaRealtimeSpeechRecognizer, type PrismaRuntimeDiagnostic } from "./prismaRealtimeRecognizer.js";
import { readPrismaRuntimeConfig } from "./runtimeConfig.js";
import { TranscriptAssembler } from "./transcriptAssembly.js";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN as number;
  bufferedAmount = 0;
  readonly sent: number[] = [];
  readonly closeCodes: number[] = [];
  terminated = 0;
  stallClose = false;
  send(frame: Uint8Array, _options: unknown, done: (error?: Error) => void) { this.sent.push(frame.length); queueMicrotask(() => done()); }
  close(code: number) { this.closeCodes.push(code); if (!this.stallClose) { this.readyState = WebSocket.CLOSED; queueMicrotask(() => this.emit("close", code)); } }
  terminate() { this.terminated++; this.readyState = WebSocket.CLOSED; queueMicrotask(() => this.emit("close", 1006)); }
  event(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
}
function harness(limits: { connectMs?: number; totalMs?: number; closeMs?: number } = {}) {
  const socket = new FakeSocket(), diagnostics: PrismaRuntimeDiagnostic[] = [];
  const recognizer = new PrismaRealtimeSpeechRecognizer({ endpoint: "wss://offline.invalid", headers: {} }, {
    socketFactory: () => socket as unknown as WebSocket, onDiagnostic: (item) => diagnostics.push(item),
    limits: { silenceMs: 0, settleMs: 0, connectMs: 100, totalMs: 1000, closeMs: 50, ...limits },
  });
  const stream = recognizer.openStream({ sessionId: "offline", turnNumber: 1, language: "hi-IN" });
  const connect = () => socket.event({ type: "connected", timestamp: "2026-10-09T09:00:00.000Z", config: { sample_rate: 16000, chunk_size: 512 } });
  return { socket, stream, recognizer, diagnostics, connect };
}
const code = (expected: string) => (error: unknown) => error instanceof ApplicationError && error.code === expected;

test("runtime config is opt-in and freezes the verified participant baseline", () => {
  assert.equal(readPrismaRuntimeConfig({}), undefined);
  assert.equal(readPrismaRuntimeConfig({ PRISMA_RUNTIME_ENABLED: "true" }), undefined);
  assert.equal(readPrismaRuntimeConfig({ PRISMA_RUNTIME_ENABLED: "true", GNANI_API_KEY: "offline-placeholder", STT_COST_UNITS: "0" }), undefined);
  const config = readPrismaRuntimeConfig({ PRISMA_RUNTIME_ENABLED: "true", GNANI_API_KEY: "offline-placeholder", STT_COST_UNITS: "1" })!;
  assert.equal(config.endpoint, "wss://api.vachana.ai/stt/v3/stream");
  assert.deepEqual(Object.keys(config.headers).sort(), ["lang_code", "x-api-key-id", "x-sample-rate"]);
  assert.equal(config.headers.lang_code, "hi-IN"); assert.equal(config.headers["x-sample-rate"], "16000");
});

for (const turnNumber of [2, 3]) test(`real adapter accepts bounded learner turn ${turnNumber} with unchanged wire contract`, async () => {
  const socket = new FakeSocket(); let calls = 0;
  const recognizer = new PrismaRealtimeSpeechRecognizer({ endpoint: "wss://offline.invalid", headers: {} }, { socketFactory: () => { calls++; return socket as unknown as WebSocket; }, limits: { silenceMs: 0, settleMs: 0 } });
  const stream = recognizer.openStream({ sessionId: "bounded", turnNumber, language: "hi-IN" });
  socket.event({ type: "connected", config: { sample_rate: 16000, chunk_size: 512 } }); await stream.ready;
  socket.event({ type: "transcript", text: "Main independently verify karunga" });
  const result = await stream.finish(); assert.equal(result.turnNumber, turnNumber); assert.equal(calls, 1); assert.deepEqual(socket.closeCodes, [1000]);
});
for (const turnNumber of [0, 4, 1.5]) test(`invalid turn ${turnNumber} rejects locally before a provider transport`, () => {
  let calls = 0; const recognizer = new PrismaRealtimeSpeechRecognizer({ endpoint: "wss://offline.invalid", headers: {} }, { socketFactory: () => { calls++; throw new Error("Must not transport"); } });
  assert.throws(() => recognizer.openStream({ sessionId: "invalid", turnNumber, language: "hi-IN" })); assert.equal(calls, 0);
});
test("connected, observed speech_start and transcript normalize optional reference metadata", async () => {
  const h = harness(); h.connect(); await h.stream.ready;
  h.socket.event({ type: "speech_start", timestamp: "2099-01-01T00:00:00.000Z" });
  await h.stream.sendFrame(new Uint8Array(1024));
  h.socket.event({ type: "transcript", text: " मैं खुद सत्यापन करूंगा ", timestamp: "2099-01-01T00:00:01.000Z",
    segment_id: "sanitized-observed-segment", segment_index: 1, audio_duration_ms: 99999, latency: 45 });
  const result = await h.stream.finish();
  assert.equal(result.text, "मैं खुद सत्यापन करूंगा"); assert.equal(result.sessionId, "offline"); assert.equal(result.turnNumber, 1);
  assert.equal(result.segments?.[0]?.providerAudioDurationMs, 99999); assert.equal(result.segments?.[0]?.segmentIndex, 1);
  assert.equal(result.providerMetadata?.providerSpeechStartReferenceTimestamp, "2099-01-01T00:00:00.000Z");
  assert.equal(result.timing, undefined); assert.equal(result.confidence, undefined); assert.equal("final" in result, false);
  assert.deepEqual(h.socket.sent, [1024]); assert.deepEqual(h.socket.closeCodes, [1000]); assert.equal(h.socket.terminated, 0);
  h.stream.cancel(); assert.equal(h.socket.terminated, 0);
});
test("metadata-free segments are valid and duplicate emissions do not duplicate text", async () => {
  const h = harness(); h.socket.event({ type: "connected" }); await h.stream.ready;
  h.socket.event({ type: "transcript", text: "official channel se verify karunga" });
  h.socket.event({ type: "transcript", text: "official channel se verify karunga" });
  const result = await h.stream.finish(); assert.equal(result.segments?.length, 1);
  assert.equal(result.segments?.[0]?.segmentId, undefined); assert.equal(result.text, "official channel se verify karunga");
});
test("provider indexes order multiple segments and finish finalizes once", async () => {
  const h = harness(); h.connect();
  h.socket.event({ type: "transcript", text: "verify karunga", segment_index: 2, segment_id: "two" });
  h.socket.event({ type: "transcript", text: "Main official channel se", segment_index: 1, segment_id: "one" });
  const a = h.stream.finish(), b = h.stream.finish(); assert.equal(a, b);
  assert.equal((await a).text, "Main official channel se verify karunga"); assert.deepEqual(h.socket.closeCodes, [1000]);
});
for (const [name, value] of [
  ["malformed transcript", { type: "transcript", text: 42 }],
  ["invalid supplied optional metadata", { type: "transcript", text: "hello", latency: -1 }],
  ["unknown event", { type: "new_event", message: "PRIVATE PROVIDER BODY" }],
  ["unverified processing", { type: "processing" }],
  ["unverified speech_end", { type: "speech_end" }],
  ["wrong accepted configuration", { type: "connected", config: { sample_rate: 8000 } }],
] as const) {
  test(`${name} fails safely without leaking provider fields`, async () => {
    const h = harness(); if (name !== "wrong accepted configuration") h.connect(); h.socket.event(value);
    await assert.rejects(h.stream.finish(), code("STT_PROTOCOL_ERROR"));
    assert.equal(h.socket.terminated, 1); assert.doesNotMatch(JSON.stringify(h.diagnostics), /PRIVATE|message|header/u);
  });
}
test("conflicting duplicate segment does not assume replacement semantics", async () => {
  const h = harness(); h.connect(); h.socket.event({ type: "transcript", text: "one", segment_id: "same" });
  h.socket.event({ type: "transcript", text: "replacement", segment_id: "same" });
  await assert.rejects(h.stream.finish(), code("STT_PROTOCOL_ERROR"));
});
test("malformed JSON and binary provider responses fail closed", async () => {
  for (const binary of [false, true]) {
    const h = harness(); h.connect(); h.socket.emit("message", Buffer.from("not-json"), binary);
    await assert.rejects(h.stream.finish(), code("STT_PROTOCOL_ERROR"));
  }
});
test("socket error and early close terminate without retries", async () => {
  for (const event of ["error", "close"] as const) {
    const h = harness(); h.connect(); h.socket.emit(event, event === "error" ? new Error("private transport") : 1000);
    await assert.rejects(h.stream.finish(), code("STT_CONNECTION_FAILED")); assert.equal(h.socket.terminated, 1);
  }
});
test("rejected provider upgrade maps safely and closes without exposing auth details", async () => {
  const h = harness(); let drained = false;
  h.socket.emit("unexpected-response", {}, { resume: () => { drained = true; } });
  await assert.rejects(h.stream.ready, code("STT_CONNECTION_FAILED"));
  assert.equal(drained, true); assert.equal(h.socket.terminated, 1);
  assert.deepEqual(h.diagnostics, [{ code: "STT_CONNECTION_FAILED", event: "transport" }]);
});
test("no transcript is distinct from no local speech", async () => {
  const h = harness(); h.connect(); await assert.rejects(h.stream.finish(), code("STT_EMPTY"));
  assert.equal(h.socket.terminated, 1);
});
test("connect timeout closes its socket", async () => {
  const h = harness({ connectMs: 5 }); await assert.rejects(h.stream.ready, code("STT_TIMEOUT")); assert.equal(h.socket.terminated, 1);
});
test("total transcript deadline cancels a stalled provider", async () => {
  const h = harness({ totalMs: 5 }); h.connect(); await new Promise((resolve) => setTimeout(resolve, 12));
  await assert.rejects(h.stream.finish(), code("STT_TIMEOUT")); assert.equal(h.socket.terminated, 1);
});
test("graceful close has a bounded timeout", async () => {
  const h = harness({ closeMs: 5 }); h.connect(); h.socket.stallClose = true; h.socket.event({ type: "transcript", text: "hello" });
  await assert.rejects(h.stream.finish(), code("STT_TIMEOUT")); assert.equal(h.socket.terminated, 1);
});
test("cancelled stream ignores stale transcript callbacks and never sends later PCM", async () => {
  const h = harness(); h.connect(); await h.stream.ready; h.stream.cancel();
  h.socket.event({ type: "transcript", text: "STALE" });
  await assert.rejects(h.stream.sendFrame(new Uint8Array(1024)), code("STT_CANCELLED"));
  await assert.rejects(h.stream.finish(), code("STT_CANCELLED")); assert.equal(h.socket.sent.length, 0);
});
test("backpressure and invalid PCM cannot be forwarded", async () => {
  const h = harness(); h.connect(); await h.stream.ready; h.socket.bufferedAmount = 9000;
  await assert.rejects(h.stream.sendFrame(new Uint8Array(1024)), code("STT_CONNECTION_FAILED"));
  assert.equal(h.socket.sent.length, 0);
  const invalid = harness(); invalid.connect(); await assert.rejects(invalid.stream.sendFrame(new Uint8Array(100))); invalid.stream.cancel();
});

for (const [name, text] of [
  ["Latin", "Main verify karunga"], ["Devanagari", "मैं खुद सत्यापन करूंगा"],
  ["mixed-script Hinglish", "मैं official channel se verify करूंगा"],
  ["Unicode preservation", "का e\u0301 🔒"],
] as const) test(`assembly preserves ${name}`, () => {
  const assembler = new TranscriptAssembler(); assembler.add({ text }); assert.equal(assembler.result().text, text);
});
test("assembly trims transport whitespace without translating or transliterating", () => {
  const a = new TranscriptAssembler(); a.add({ text: "  मैं\n official\tchannel  " }); assert.equal(a.result().text, "मैं official channel");
});
test("assembly retains arrival slots when segment indexes are missing", () => {
  const a = new TranscriptAssembler(); a.add({ text: "third", segmentIndex: 3 }); a.add({ text: "arrival" }); a.add({ text: "first", segmentIndex: 1 });
  assert.equal(a.result().text, "first arrival third");
});
test("empty segments produce no invented text", () => {
  const a = new TranscriptAssembler(); a.add({ text: "\n " }); assert.deepEqual(a.result(), { text: "", segments: [] });
});
