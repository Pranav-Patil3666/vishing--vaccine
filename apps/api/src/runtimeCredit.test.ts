import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeCreditLedger } from "./runtimeCredit.js";
import { ApplicationError } from "./errors.js";

const make = (cap = 4, seed = 0, reserve = 0) => new RuntimeCreditLedger({ mode: "development", developmentCap: cap, publicDemoCap: 0, reserveCap: reserve, usedUnits: 0 }, { stt: 1, tts: 1 }, seed, () => new Date("2026-10-20T00:00:00Z"));

test("runtime cap four allows used three plus one, denies used four plus one, and exposes exact decision", () => {
  const credits = make(4, 3); credits.reserve("tts", "boundary").attempted();
  assert.equal(credits.snapshot().tts.usedUnits, 4);
  assert.throws(() => credits.reserve("tts", "boundary"), (error: unknown) => {
    assert.ok(error instanceof ApplicationError); assert.equal(error.code, "CREDIT_LIMIT_REACHED");
    assert.deepEqual(error.technical?.credit, { operation: "tts", cap: 4, reserveCap: 0, usableCap: 4, usedUnits: 4, costUnits: 1, projectedUnits: 5, remainingUnits: 0, allowed: false });
    assert.equal(error.technical?.providerAttempted, false); return true;
  });
  assert.equal(credits.snapshot().tts.providerAttempts, 1);
});
test("reserve cap is an untouched buffer subtracted from capacity, not current usage", () => {
  const credits = make(5, 3, 1); credits.reserve("tts", "buffer").attempted();
  assert.equal(credits.snapshot().usableCap, 4); assert.throws(() => credits.reserve("tts", "buffer"));
});
test("one provider boundary consumes one unit despite duplicate callbacks and cannot be refunded after attempt", () => {
  const credits = make(), reservation = credits.reserve("stt", "once");
  reservation.attempted(); reservation.attempted(); reservation.releaseBeforeAttempt();
  assert.equal(credits.snapshot().stt.usedUnits, 1); assert.equal(credits.snapshot().stt.providerAttempts, 1);
  assert.equal(credits.snapshot().events.length, 1); assert.equal(credits.snapshot().events[0]!.state, "ATTEMPTED");
});
test("a local rejection/cancellation before transport releases only its own held unit, exactly once", () => {
  const credits = make(), first = credits.reserve("stt", "first"), second = credits.reserve("stt", "second");
  first.releaseBeforeAttempt(); first.releaseBeforeAttempt(); second.attempted();
  assert.equal(credits.snapshot().stt.usedUnits, 1); assert.equal(credits.snapshot().stt.providerAttempts, 1);
  assert.equal(credits.snapshot().events[0]!.state, "RELEASED");
});
test("typed/mock simulation accounting never consumes real runtime provider units", () => {
  const credits = make(1); credits.chargeSimulated("stt", 1, "mock"); credits.chargeSimulated("tts", 1, "mock");
  credits.reserve("stt", "real").attempted(); credits.reserve("tts", "real").attempted();
  assert.deepEqual(credits.snapshot().simulation, { sttUsedUnits: 1, ttsUsedUnits: 1 });
  assert.equal(credits.snapshot().stt.usedUnits, 1); assert.equal(credits.snapshot().tts.usedUnits, 1);
  assert.equal(credits.snapshot().events.length, 2);
});
test("new process ledger resets runtime STT but honors the TTS seed; counters are independent", () => {
  const old = make(4, 1); old.reserve("stt", "old").attempted(); old.reserve("tts", "old").attempted();
  const fresh = make(4, 1).snapshot(); assert.equal(fresh.stt.usedUnits, 0); assert.equal(fresh.tts.usedUnits, 1);
  assert.equal(fresh.stt.remainingUnits, 4); assert.equal(fresh.tts.remainingUnits, 3); assert.notEqual(fresh.bootId, old.snapshot().bootId);
});
test("two learner calls plus two caller misses total four new units without theoretical-turn precharge", () => {
  const credits = make(4, 1); assert.equal(credits.snapshot().stt.usedUnits, 0); assert.equal(credits.snapshot().tts.usedUnits, 1);
  for (const operation of ["stt", "tts", "stt", "tts"] as const) credits.reserve(operation, "two-turn").attempted();
  assert.equal(credits.snapshot().stt.usedUnits, 2); assert.equal(credits.snapshot().tts.usedUnits, 3);
  assert.equal(credits.snapshot().stt.providerAttempts + credits.snapshot().tts.providerAttempts, 4);
});
test("audit history is bounded and returned snapshots cannot mutate counters or records", () => {
  const credits = make(100); for (let index = 0; index < 80; index++) credits.reserve("stt", `s${index}`).attempted();
  const copy = credits.snapshot(); assert.equal(copy.events.length, 64); copy.stt.usedUnits = 0; copy.events[0]!.state = "RELEASED";
  assert.equal(credits.snapshot().stt.usedUnits, 80); assert.equal(credits.snapshot().events[0]!.state, "ATTEMPTED");
});
