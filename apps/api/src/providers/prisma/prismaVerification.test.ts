import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApplicationError } from "../../errors.js";
import { inspectCandidateEvent } from "./verificationEvents.js";
import { loadSyntheticFixture, readVerificationConfig, validateFixture, type VerificationConfig } from "./verificationConfig.js";
import { VerificationSocket, verifyPrisma, verifyPrismaMissingAuth, type VerificationDiagnostic } from "./verifyPrisma.js";

// Offline values are fabricated except the sanitized speech_start fixture below,
// which retains the type/reference timestamp observed in participant run L2.
const offlineCredential = "offline-placeholder-never-used-on-network";
function environment(): NodeJS.ProcessEnv {
  return { PRISMA_VERIFY_LIVE: "true", PRISMA_VERIFY_WS_URL: "wss://offline.invalid/stt/candidate",
    PRISMA_VERIFY_AUTH_HEADER: "x-candidate-auth", PRISMA_VERIFY_CREDENTIAL_ENV: "GNANI_API_KEY",
    GNANI_API_KEY: offlineCredential, PRISMA_VERIFY_LANGUAGE_HEADER: "lang_code", PRISMA_VERIFY_LANGUAGE_CODE: "hi-IN",
    PRISMA_VERIFY_SAMPLE_RATE_HEADER: "x-sample-rate", PRISMA_VERIFY_SAMPLE_RATE_HZ: "16000",
    PRISMA_VERIFY_FIXTURE_MANIFEST: "offline-manifest.json", CREDIT_CAP: "10", RESERVE_CAP: "1",
    PRISMA_VERIFY_USED_UNITS: "0", STT_COST_UNITS: "1" };
}
function manifest(bytes: Uint8Array) {
  return { source: "synthetic-local-speech", encoding: "PCM_S16LE", channels: 1, sampleRateHz: 16000,
    audioFile: "fixture.pcm", expectedText: "one second", sha256: createHash("sha256").update(bytes).digest("hex") };
}
function typedFailure(error: unknown): boolean { return error instanceof ApplicationError && error.code === "TRANSCRIPTION_FAILED"; }

test("verification configuration requires intentional live opt-in and explicit secrets/budget without exposing values", () => {
  for (const name of ["PRISMA_VERIFY_LIVE", "PRISMA_VERIFY_WS_URL", "PRISMA_VERIFY_CREDENTIAL_ENV", "GNANI_API_KEY", "CREDIT_CAP", "RESERVE_CAP", "PRISMA_VERIFY_USED_UNITS", "STT_COST_UNITS"]) {
    const env = environment(); delete env[name];
    assert.throws(() => readVerificationConfig(env), (error) => error instanceof ApplicationError && !error.message.includes(offlineCredential));
  }
  const config = readVerificationConfig(environment());
  assert.equal(config.headers["x-candidate-auth"], offlineCredential);
  assert.equal(config.headers.lang_code, "hi-IN");
  assert.equal(config.frameBytes, 1024);
});
test("credential selector is explicit and header names cannot collide, inject, or override the WebSocket", () => {
  const env = { ...environment(), PRISMA_VERIFY_CREDENTIAL_ENV: "GNANI_API_KEY_ID", GNANI_API_KEY_ID: "offline-id" };
  assert.equal(readVerificationConfig(env).headers["x-candidate-auth"], "offline-id");
  for (const header of ["lang_code", "Host", "sec-websocket-key", "invalid\r\nheader"]) {
    assert.throws(() => readVerificationConfig({ ...environment(), PRISMA_VERIFY_AUTH_HEADER: header }), ApplicationError);
  }
  assert.throws(() => readVerificationConfig({ ...environment(), GNANI_API_KEY: "abc\r\ndef" }), ApplicationError);
});
test("configuration rejects query credentials, insecure endpoints, blank numbers, and invalid frame geometry", () => {
  for (const url of ["ws://offline.invalid", "wss://offline.invalid/?key=secret", "wss://user:pass@offline.invalid", "wss://offline.invalid/#secret"]) {
    assert.throws(() => readVerificationConfig({ ...environment(), PRISMA_VERIFY_WS_URL: url }), ApplicationError);
  }
  for (const value of ["", " ", "-1", "Infinity"]) assert.throws(() => readVerificationConfig({ ...environment(), CREDIT_CAP: value }), ApplicationError);
  for (const value of ["1", "1023", "8192"]) assert.throws(() => readVerificationConfig({ ...environment(), PRISMA_VERIFY_FRAME_BYTES: value }), ApplicationError);
  assert.throws(() => readVerificationConfig({ ...environment(), PRISMA_VERIFY_FORMAT: "verbatim" }), ApplicationError);
});
test("fixture validation rejects containers, wrong hash/rate/channel, odd samples, excessive length and unsafe phrases", () => {
  const bytes = new Uint8Array(1024);
  assert.equal(validateFixture(manifest(bytes), bytes, 16000).expectedText, "one second");
  for (const candidate of [{ ...manifest(bytes), channels: 2 }, { ...manifest(bytes), sha256: "0".repeat(64) },
    { ...manifest(bytes), audioFile: "../fixture.pcm" }, { ...manifest(bytes), expectedText: "arbitrary personal text" }]) {
    assert.throws(() => validateFixture(candidate, bytes, 16000), ApplicationError);
  }
  for (const malformed of [new Uint8Array(), new Uint8Array(3), new Uint8Array(16000 * 2 * 9), Buffer.from("RIFF0000")]) {
    assert.throws(() => validateFixture(manifest(malformed), malformed, 16000), ApplicationError);
  }
  assert.throws(() => validateFixture(manifest(bytes), bytes, 8000), ApplicationError);
});
test("fixture loader reads only bounded local synthetic bytes and never writes audio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prisma-offline-test-"));
  try {
    const bytes = new Uint8Array(1024);
    const path = join(directory, "manifest.json");
    await writeFile(path, JSON.stringify(manifest(bytes))); await writeFile(join(directory, "fixture.pcm"), bytes);
    const config = { ...readVerificationConfig(environment()), fixtureManifest: path };
    assert.deepEqual((await loadSyntheticFixture(config)).bytes, Buffer.from(bytes));
    assert.deepEqual(await readFile(join(directory, "fixture.pcm")), Buffer.from(bytes));
    await writeFile(path, JSON.stringify({ ...manifest(bytes), audioFile: "../fixture.pcm" }));
    await assert.rejects(loadSyntheticFixture(config), (error) => error instanceof ApplicationError && !error.message.includes(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reviewed composite fixtures validate safe phrases, ordered ranges and exact zero-PCM pauses", () => {
  const bytes = new Uint8Array(1024);
  bytes.fill(1, 0, 256); bytes.fill(2, 384);
  const parts = [{ phrase: "okay", startSample: 0, endSample: 128 }, { phrase: "one second", startSample: 192, endSample: 512 }];
  const composite = { ...manifest(bytes), expectedText: "okay one second", probe: "SHORT", parts,
    voiceName: "Offline test voice", voiceCulture: "en-US" };
  const result = validateFixture(composite, bytes, 16000);
  assert.equal(result.probe, "SHORT"); assert.deepEqual(result.parts, parts);
  for (const bad of [{ ...composite, parts: [...parts].reverse() }, { ...composite, expectedText: "okay" },
    { ...composite, probe: "ERROR" }, { ...composite, parts: [{ ...parts[0], endSample: 1000 }] }]) {
    assert.throws(() => validateFixture(bad, bytes, 16000), ApplicationError);
  }
  const noisy = bytes.slice(); noisy[300] = 1;
  assert.throws(() => validateFixture({ ...composite, sha256: createHash("sha256").update(noisy).digest("hex") }, noisy, 16000), ApplicationError);
});

test("multi-part transcript matching logs only safe expected-part indexes, never text", () => {
  const result = inspectCandidateEvent('{"type":"transcript","text":"okay"}', 7, "okay one second", ["okay", "one second"]);
  assert.deepEqual(result.diagnostic.matchedSyntheticPartIndexes, [0]);
  assert.equal(result.diagnostic.matchesSyntheticPhrase, false);
  assert.ok(!JSON.stringify(result.diagnostic).includes("okay"));
});

test("observed L2 transcript metadata shape remains optional and separate from local receipt", () => {
  // Body/segment ID are substituted; numeric metadata and timestamp shape come from L2.
  const result = inspectCandidateEvent(JSON.stringify({ type: "transcript", text: "one second", segment_id: "offline-segment",
    segment_index: 1, audio_duration_ms: 1408, latency: 88, timestamp: "2026-10-09T11:35:09.124703+00:00" }), 2057.5488, "one second");
  assert.equal(result.diagnostic.audioDurationMs, 1408); assert.equal(result.diagnostic.providerLatencyMs, 88);
  assert.equal(result.diagnostic.receivedAtMonotonicMs, 2057.5488);
  assert.equal(Object.hasOwn(result.event!, "confidence"), false);
  assert.equal(Object.hasOwn(result.event!, "words"), false);
});
test("candidate normalization leaves all missing metadata undefined and never invents confidence/words", () => {
  const result = inspectCandidateEvent(JSON.stringify({ type: "transcript", text: "one second", words: [{ start: 42 }], confidence: 0.99 }), 17, "one second");
  assert.equal(result.event?.type, "transcript");
  assert.equal(result.diagnostic.matchesSyntheticPhrase, true);
  assert.equal(result.diagnostic.providerTimestamp, undefined);
  assert.equal(result.diagnostic.segmentIndex, undefined);
  assert.equal(result.diagnostic.unknownFieldCount, 2);
  assert.ok(!JSON.stringify(result.event).includes("confidence"));
  assert.ok(!JSON.stringify(result.diagnostic).includes("one second"));
});
test("metadata diagnostics preserve local arrival separately, fingerprint segment identity and discard text", () => {
  const raw = { type: "transcript", text: "हाँ okay DUMMY-4821", timestamp: "2099-01-01T00:00:00Z", audio_duration_ms: 50,
    segment_id: offlineCredential, segment_index: 2, latency: 9 };
  const result = inspectCandidateEvent(JSON.stringify(raw), 24, "one second");
  assert.equal(result.diagnostic.receivedAtMonotonicMs, 24);
  assert.equal(result.diagnostic.providerTimestamp, raw.timestamp);
  assert.equal(result.diagnostic.hasDevanagari, true); assert.equal(result.diagnostic.hasLatin, true);
  assert.equal(result.diagnostic.digitCount, 4); assert.equal(result.diagnostic.providerLatencyMs, 9);
  assert.ok(!JSON.stringify(result.diagnostic).includes(offlineCredential));
  assert.ok(!JSON.stringify(result.diagnostic).includes(raw.text));
});
test("processing and connected candidate events can omit metadata", () => {
  assert.equal(inspectCandidateEvent('{"type":"processing"}', 0, "okay").diagnostic.providerTimestamp, undefined);
  assert.equal(inspectCandidateEvent('{"type":"connected","config":{"sample_rate":16000,"chunk_size":512}}', 1, "okay").diagnostic.reportedChunkSize, 512);
});

test("live-observed speech_start preserves provider reference time separately from local receipt", () => {
  const sanitized = { type: "speech_start", timestamp: "2026-10-09T11:35:07.775190+00:00" };
  const result = inspectCandidateEvent(JSON.stringify(sanitized), 37, "one second");
  assert.deepEqual(result.event, sanitized);
  assert.equal(result.diagnostic.eventType, "speech_start");
  assert.equal(result.diagnostic.providerTimestamp, sanitized.timestamp);
  assert.equal(result.diagnostic.receivedAtMonotonicMs, 37);
  assert.equal(result.diagnostic.characterCount, undefined);
  assert.equal(result.diagnostic.recognizedUnknownType, undefined);
  assert.equal(Object.hasOwn(result.event!, "learnerSpeechStartedAt"), false);
});

test("speech_start does not invent missing provider time and rejects malformed supplied timestamps", () => {
  const result = inspectCandidateEvent('{"type":"speech_start"}', 38, "one second");
  assert.deepEqual(result.event, { type: "speech_start" });
  assert.equal(result.diagnostic.providerTimestamp, undefined);
  assert.throws(() => inspectCandidateEvent('{"type":"speech_start","timestamp":"invalid"}', 38, "one second"), typedFailure);
});
test("malformed known event shapes fail through typed provider errors", () => {
  for (const raw of ["invalid", "null", "[]", "{}", '{"type":"transcript"}', '{"type":"transcript","text":" "}',
    '{"type":"transcript","text":"okay","segment_index":-1}', '{"type":"processing","timestamp":"not-a-date"}',
    '{"type":"connected","config":false}', '{"type":"transcript","text":"okay","latency":null}']) {
    assert.throws(() => inspectCandidateEvent(raw, 0, "okay"), typedFailure);
  }
});
test("provider errors and unknown events never log arbitrary type names, codes, messages or extra values", () => {
  for (const raw of [{ type: "error", message: offlineCredential, code: offlineCredential },
    { type: offlineCredential, [offlineCredential]: offlineCredential }]) {
    const result = inspectCandidateEvent(JSON.stringify(raw), 0, "okay");
    assert.ok(!JSON.stringify(result).includes(offlineCredential));
  }
  assert.equal(inspectCandidateEvent('{"type":"speech_end"}', 0, "okay").diagnostic.recognizedUnknownType, "speech_end");
});

class OfflineSocket extends VerificationSocket {
  sent: Array<{ length: number; at: number }> = [];
  terminated = false;
  closeRequested = false;
  constructor(private readonly now: () => number, private readonly onSend?: (socket: OfflineSocket) => void,
    private readonly closeCode = 1000) { super(); }
  message(value: unknown, binary = false): void { this.emit("message", Buffer.from(JSON.stringify(value)), binary); }
  async send(bytes: Uint8Array): Promise<void> {
    this.sent.push({ length: bytes.length, at: this.now() });
    if (this.sent.length === 1) this.onSend?.(this);
  }
  close(): void { this.closeRequested = true; this.emit("close", this.closeCode); }
  terminate(): void { this.terminated = true; }
}
function offlineRun(overrides: { config?: VerificationConfig; initial?: (socket: OfflineSocket) => void;
  onSend?: (socket: OfflineSocket) => void; closeCode?: number; hangClose?: boolean; slowSend?: boolean } = {}) {
  let elapsed = 1000;
  let factoryCalls = 0;
  const logs: VerificationDiagnostic[] = [];
  const socket = new OfflineSocket(() => elapsed - 1000, overrides.onSend ?? ((s) => s.message({ type: "transcript", text: "one second" })), overrides.closeCode);
  if (overrides.hangClose) socket.close = () => { socket.closeRequested = true; };
  if (overrides.slowSend) {
    const send = socket.send.bind(socket);
    socket.send = async (bytes) => { await send(bytes); elapsed += 100; };
  }
  const result = verifyPrisma(overrides.config ?? readVerificationConfig(environment()), {
    loadFixture: async () => ({ bytes: new Uint8Array(1026), expectedText: "one second" }),
    now: () => elapsed,
    wait: async (ms) => { elapsed += ms; },
    createSocket: () => {
      factoryCalls++;
      queueMicrotask(() => { socket.emit("open"); (overrides.initial ?? ((s) => s.message({ type: "connected" })))(socket); });
      return socket;
    },
    emit: (event) => logs.push(event), deadlineMs: 30, drainMs: 1, closeWaitMs: 10,
  });
  return { result, socket, logs, factoryCalls: () => factoryCalls };
}
test("credit guard rejects before opening any socket", async () => {
  const config = readVerificationConfig({ ...environment(), CREDIT_CAP: "1", RESERVE_CAP: "1" });
  const run = offlineRun({ config });
  await assert.rejects(run.result, (error) => error instanceof ApplicationError && error.code === "CREDIT_LIMIT_REACHED");
  assert.equal(run.factoryCalls(), 0);
});
test("one offline lifecycle uses real-time paced binary frames, local receipts and a graceful close", async () => {
  const run = offlineRun(); const result = await run.result;
  assert.equal(result.closeCode, 1000); assert.equal(result.transcriptCount, 1); assert.equal(run.factoryCalls(), 1);
  assert.ok(run.socket.sent.every((frame) => frame.length === 1024));
  for (let index = 1; index < run.socket.sent.length; index++) assert.equal(run.socket.sent[index]!.at - run.socket.sent[index - 1]!.at, 32);
  assert.equal(run.socket.listenerCount("message"), 0); assert.equal(run.socket.terminated, false);
  assert.ok(!JSON.stringify(run.logs).includes("one second")); assert.ok(!JSON.stringify(run.logs).includes(offlineCredential));
  assert.equal(run.logs[0]?.eventType, "credit-approved");
});
test("slow sends do not trigger catch-up bursts", async () => {
  const run = offlineRun({ slowSend: true }); await run.result;
  for (let index = 1; index < run.socket.sent.length; index++) assert.equal(run.socket.sent[index]!.at - run.socket.sent[index - 1]!.at, 132);
});

test("offline verification continues streaming after speech_start without promoting it to learner timing", async () => {
  const run = offlineRun({ onSend: (socket) => {
    socket.message({ type: "speech_start", timestamp: "2026-10-09T00:00:00Z" });
    socket.message({ type: "transcript", text: "one second" });
  } });
  const result = await run.result;
  assert.equal(result.transcriptCount, 1);
  assert.ok(run.socket.sent.length > 1);
  const event = run.logs.find((entry) => entry.eventType === "speech_start");
  assert.equal(event?.receivedAtMonotonicMs, 0);
  assert.equal(run.logs.some((entry) => entry.eventType === "unknown"), false);
});
test("trailing partial framing is a separate explicit experiment, never a production contract change", async () => {
  const run = offlineRun({ config: readVerificationConfig({ ...environment(), PRISMA_VERIFY_TRAILING_PARTIAL: "true" }) });
  await run.result;
  assert.equal(run.socket.sent.at(-1)?.length, (1026 + 64000) % 1024);
});
for (const [name, initial] of Object.entries({
  unknown: (s: OfflineSocket) => s.message({ type: "partial", text: offlineCredential }),
  providerError: (s: OfflineSocket) => s.message({ type: "error", message: offlineCredential }),
  malformed: (s: OfflineSocket) => s.emit("message", Buffer.from("bad-json"), false),
  binary: (s: OfflineSocket) => s.message({ type: "connected" }, true),
  prematureClose: (s: OfflineSocket) => s.emit("close", 1000),
  upgradeRejection: (s: OfflineSocket) => s.emit("upgradeRejected", 401),
  transportError: (s: OfflineSocket) => s.emit("failure"),
  wrongOrder: (s: OfflineSocket) => s.message({ type: "transcript", text: "okay" }),
  duplicateConnected: (s: OfflineSocket) => { s.message({ type: "connected" }); s.message({ type: "connected" }); },
  timeout: (_s: OfflineSocket) => {},
})) {
  test(`offline ${name} fails closed without retry or raw error logs`, async () => {
    const run = offlineRun({ initial }); await assert.rejects(run.result, typedFailure);
    assert.equal(run.factoryCalls(), 1); assert.equal(run.socket.sent.length, 0);
    assert.equal(run.socket.listenerCount("message"), 0);
    assert.ok(!JSON.stringify(run.logs).includes(offlineCredential));
  });
}
test("missing transcript, abnormal close and missing close handshake fail closed", async () => {
  for (const overrides of [{ onSend: (_s: OfflineSocket) => {} }, { closeCode: 1008 }, { hangClose: true }]) {
    const run = offlineRun(overrides); await assert.rejects(run.result, typedFailure); assert.equal(run.factoryCalls(), 1);
  }
});
test("a malformed event after audio starts does not return an earlier stale transcript", async () => {
  const run = offlineRun({ onSend: (s) => { s.message({ type: "transcript", text: "one second" }); s.message({ type: "transcript", text: 42 }); } });
  await assert.rejects(run.result, typedFailure); assert.equal(run.socket.terminated, true);
});

test("observed omitted-auth path removes only auth, sends no audio and recognizes sanitized 401/1006", async () => {
  const config = readVerificationConfig(environment());
  const socket = new OfflineSocket(() => 0);
  const logs: VerificationDiagnostic[] = [];
  let calls = 0;
  const result = await verifyPrismaMissingAuth(config, { loadFixture: async () => ({ bytes: new Uint8Array(1024), expectedText: "okay" }),
    createSocket: (observed) => {
      calls++;
      assert.equal(observed.headers[config.authHeaderName], undefined);
      assert.equal(observed.headers.lang_code, config.headers.lang_code);
      assert.equal(observed.endpoint, config.endpoint);
      queueMicrotask(() => { socket.emit("upgradeRejected", 401); socket.emit("close", 1006); });
      return socket;
    }, emit: (entry) => logs.push(entry) });
  assert.deepEqual(result, { result: "expected-auth-rejection", httpStatus: 401 });
  assert.equal(calls, 1); assert.equal(socket.sent.length, 0);
  assert.equal(config.headers[config.authHeaderName], offlineCredential);
  assert.ok(!JSON.stringify(logs).includes(offlineCredential));
  assert.ok(logs.some((entry) => entry.eventType === "socket-closed" && entry.closeCode === 1006));
});

test("negative probe does not call a network failure or accepted anonymous connection an auth rejection", async () => {
  for (const accepted of [false, true]) {
    const socket = new OfflineSocket(() => 0);
    await assert.rejects(verifyPrismaMissingAuth(readVerificationConfig(environment()), {
      loadFixture: async () => ({ bytes: new Uint8Array(1024), expectedText: "okay" }),
      createSocket: () => {
        queueMicrotask(() => { if (accepted) { socket.emit("open"); socket.message({ type: "connected" }); } else socket.emit("failure"); });
        return socket;
      },
    }), typedFailure);
    assert.equal(socket.sent.length, 0); assert.equal(socket.terminated, true);
  }
});

test("negative probe remains guarded before opening a socket", async () => {
  let calls = 0;
  const config = readVerificationConfig({ ...environment(), CREDIT_CAP: "0" });
  await assert.rejects(verifyPrismaMissingAuth(config, {
    loadFixture: async () => ({ bytes: new Uint8Array(1024), expectedText: "okay" }),
    createSocket: () => { calls++; return new OfflineSocket(() => 0); },
  }), (error) => error instanceof ApplicationError && error.code === "CREDIT_LIMIT_REACHED");
  assert.equal(calls, 0);
});
