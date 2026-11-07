import assert from "node:assert/strict";
import test from "node:test";
import { LocalVad, type VadBoundary } from "./vad.js";

function fixture() {
  const vad = new LocalVad(); let time = 0; const events: VadBoundary[] = [];
  const feed = (level: number, frames: number) => {
    for (let i = 0; i < frames; i++) { time += 20; events.push(...vad.process(level, 20, time)); }
  };
  return { vad, feed, events };
}
test("5E a fresh turn/session VAD has no old speech/hangover state", () => {
  const old = fixture(); old.feed(0.004, 38); old.feed(0.2, 20); assert.equal(old.vad.state, "speech"); old.vad.clear();
  const fresh = fixture(); assert.equal(fresh.vad.state, "calibrating"); fresh.feed(0.004, 38);
  assert.equal(fresh.vad.state, "silence"); assert.deepEqual(fresh.events, []);
});
test("ambient calibration derives bounded separate thresholds without speech events", () => {
  const { vad, feed, events } = fixture();
  feed(0.004, 37); assert.equal(vad.state, "calibrating");
  feed(0.004, 1); assert.equal(vad.state, "silence");
  assert.ok(Math.abs(vad.noiseFloor - 0.004) < 1e-6); assert.equal(vad.speechOn, 0.012);
  assert.ok(vad.speechOff < vad.speechOn); assert.deepEqual(events, []);
});
test("silence, low noise, one-frame impulses and subminimum bursts do not activate VAD", () => {
  const { feed, events } = fixture(); feed(0.002, 38); feed(0, 10); feed(0.005, 30);
  feed(0.8, 1); feed(0, 1); feed(0.2, 4); feed(0, 20); assert.deepEqual(events, []);
});
test("sustained speech confirms one start, uses hysteresis and ends only after hangover", () => {
  const { vad, feed, events } = fixture(); feed(0.002, 38); feed(0.1, 6);
  assert.deepEqual(events.map((event) => event.kind), ["start"]); const start = events[0]?.monotonicMs;
  feed((vad.speechOff + vad.speechOn) / 2, 20); assert.equal(vad.state, "speech");
  feed(0, 14); assert.equal(events.length, 1); feed(0, 1);
  assert.deepEqual(events.map((event) => event.kind), ["start", "end"]); assert.equal(events[0]?.monotonicMs, start);
});
test("short pauses remain one segment; long pauses allow two separate segments", () => {
  const { feed, events } = fixture(); feed(0.002, 38); feed(0.1, 10); feed(0, 5); feed(0.1, 10);
  assert.equal(events.length, 1); feed(0, 15); feed(0.1, 6); feed(0, 15);
  assert.deepEqual(events.map((event) => event.kind), ["start", "end", "start", "end"]);
});
test("quiet noise-floor adaptation is slow and calibration rejects a brief impulse", () => {
  const { vad, feed } = fixture(); feed(0.5, 1); feed(0.003, 37);
  assert.equal(vad.noiseFloor, 0.003); feed(0.004, 100); assert.ok(vad.noiseFloor > 0.003 && vad.noiseFloor < 0.004);
});
test("VAD rejects decreasing clocks and invalid input/configuration", () => {
  const vad = new LocalVad(); vad.process(0, 20, 20); assert.throws(() => vad.process(0, 20, 19));
  assert.throws(() => vad.process(NaN, 20, 40)); assert.throws(() => vad.process(0, 0, 40));
});

test("VAD boundaries estimate first candidate start and last active end without debounce or hangover", () => {
  const { feed, events } = fixture(); feed(0.002, 38); // Calibration ends at 760 ms.
  feed(0.1, 5); assert.equal(events.length, 0);
  feed(0.1, 1); assert.deepEqual(events, [{ kind: "start", monotonicMs: 760 }]); // Confirmed at 880.
  feed(0.1, 4); feed(0, 14); assert.equal(events.length, 1);
  feed(0, 1); assert.deepEqual(events[1], { kind: "end", monotonicMs: 960 }); // Confirmed at 1260.
  assert.equal(events[1]!.monotonicMs - events[0]!.monotonicMs, 200);
});

test("failed candidates reset their start and a brief pause does not replace the final active end", () => {
  const { feed, events } = fixture(); feed(0.002, 38); feed(0.1, 4); feed(0, 1);
  feed(0.1, 6); assert.equal(events[0]?.monotonicMs, 860);
  feed(0, 5); feed(0.1, 2); feed(0, 15);
  assert.equal(events[1]?.monotonicMs, 1120);
  feed(0.1, 6); assert.equal(events[2]?.monotonicMs, 1420);
});
