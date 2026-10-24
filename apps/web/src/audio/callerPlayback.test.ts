import assert from "node:assert/strict";
import test from "node:test";
import { createCallerPlayback, type PlaybackDependencies } from "./callerPlayback.js";
import { callerAudioAssetFixture } from "../../../api/src/testing/callerAudioAssetFixture.js";

function fixture(failure?: "play" | "sync") {
  let plays = 0, pauses = 0, urls = 0, revoked = 0;
  const audio = { src: "", preload: "", error: null, onplaying: null as (() => void) | null, onended: null as (() => void) | null, onerror: null as (() => void) | null,
    onpause: null as (() => void) | null, ended: false,
    play() { plays++; if (failure === "sync") throw new Error("blocked"); return failure === "play" ? Promise.reject(new Error("blocked")) : Promise.resolve(); },
    pause() { pauses++; }, removeAttribute() { this.src = ""; }, load() {} };
  const deps: PlaybackDependencies = { makeAudio: () => audio as unknown as HTMLAudioElement, makeUrl: () => { urls++; return "blob:offline"; }, revokeUrl: () => { revoked++; } };
  const abort = new AbortController(), asset = callerAudioAssetFixture();
  return { audio, abort, playback: createCallerPlayback(asset, new Blob([new Uint8Array(asset.byteLength)], { type: "audio/wav" }), abort.signal, deps),
    counts: () => ({ plays, pauses, urls, revoked }) };
}
test("fetch/play request is not playback start; playing/ended callbacks report actual local observations once", () => {
  const h = fixture(); let time = 100, ended = 0; const events: number[] = [];
  const start = () => events.push(time), end = () => { ended++; events.push(time); };
  h.playback.play(start, end, () => assert.fail("unexpected failure"));
  assert.deepEqual(events, []); time = 200; h.audio.onplaying!(); h.audio.onplaying!();
  assert.deepEqual(events, [200]); time = 5000; h.audio.onended!(); assert.deepEqual(events, [200, 5000]); assert.equal(ended, 1);
  h.playback.play(start, end, () => {}); h.playback.stop();
  assert.deepEqual(h.counts(), { plays: 1, pauses: 1, urls: 1, revoked: 1 }); assert.equal(h.audio.src, "");
});
for (const kind of ["decode", "play", "sync", "ended without playing", "user pause"] as const) test(`${kind} stops caller playback without a false end`, async () => {
  const h = fixture(kind === "play" || kind === "sync" ? kind : undefined); let ended = 0, failed = 0;
  h.playback.play(() => {}, () => { ended++; }, () => { failed++; });
  if (kind === "decode") h.audio.onerror!();
  if (kind === "ended without playing") h.audio.onended!();
  if (kind === "user pause") { h.audio.onplaying!(); h.audio.onpause!(); }
  await Promise.resolve(); assert.equal(ended, 0); assert.equal(failed, 1); assert.equal(h.counts().revoked, 1); assert.equal(h.audio.src, "");
});
test("session abort stops playback immediately and stale playing/ended events cannot advance it", () => {
  const h = fixture(); let events = 0;
  h.playback.play(() => { events++; }, () => { events++; }, () => { events++; });
  const start = h.audio.onplaying!, end = h.audio.onended!; h.abort.abort(); start(); end();
  assert.equal(events, 0); assert.equal(h.counts().pauses, 1); assert.equal(h.counts().revoked, 1);
});
test("bad audio metadata or cancelled fetch cannot create playback", () => {
  const abort = new AbortController(); abort.abort();
  assert.throws(() => createCallerPlayback(callerAudioAssetFixture(), new Blob(), abort.signal));
});
