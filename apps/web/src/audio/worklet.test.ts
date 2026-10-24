import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

function worklet() {
  const messages: Array<{ samples?: Float32Array; flushed?: boolean; error?: string }> = [];
  type Processor = { process(inputs: Float32Array[][]): boolean; port: { onmessage: (event: { data: string }) => void } };
  let Constructor!: new () => Processor;
  class Base { port = { onmessage: (_event: { data: string }) => {}, postMessage: (value: typeof messages[number]) => messages.push(value) }; }
  runInNewContext(readFileSync("apps/web/src/audio/capture.worklet.js", "utf8"), {
    AudioWorkletProcessor: Base, sampleRate: 48000, Float32Array,
    registerProcessor: (_name: string, processor: typeof Constructor) => { Constructor = processor; },
  });
  return { processor: new Constructor(), messages };
}
test("worklet downmixes native samples and flushes its last partial block explicitly", () => {
  const { processor, messages } = worklet();
  for (let i = 0; i < 10; i++) processor.process([[new Float32Array(128).fill(0.2), new Float32Array(128).fill(0.6)]]);
  assert.equal(messages[0]?.samples?.length, 960);
  assert.ok(Math.abs(messages[0]!.samples![0]! - 0.4) < 1e-6);
  processor.port.onmessage({ data: "flush" });
  assert.equal(messages[1]?.flushed, true); assert.equal(messages[1]?.samples?.length, 320);
  assert.equal(processor.process([[new Float32Array(128)]]), false);
});
test("worklet bounds unacknowledged messages and fails closed on backpressure", () => {
  const { processor, messages } = worklet();
  for (let i = 0; i < 70; i++) processor.process([[new Float32Array(128)]]);
  assert.equal(messages.filter((value) => value.samples).length, 8);
  assert.equal(messages.at(-1)?.error, "BACKPRESSURE"); assert.equal(messages.length, 9);
});
test("worklet acknowledgement permits continued capture and hard stop prevents later samples", () => {
  const { processor, messages } = worklet();
  for (let i = 0; i < 90; i++) {
    processor.process([[new Float32Array(128)]]);
    if (messages.at(-1)?.samples) processor.port.onmessage({ data: "ack" });
  }
  assert.equal(messages.some((value) => value.error), false);
  const count = messages.length; processor.port.onmessage({ data: "stop" }); processor.process([[new Float32Array(128)]]);
  assert.equal(messages.length, count);
});

test("turn flush drains the tail without terminating the processor or mixing old samples into the next block", () => {
  const { processor, messages } = worklet();
  processor.process([[new Float32Array(128).fill(0.8)]]);
  processor.port.onmessage({ data: "flush-turn" });
  assert.equal(messages[0]?.flushed, true); assert.equal(messages[0]?.samples?.length, 128);
  for (let index = 0; index < 8; index++) assert.equal(processor.process([[new Float32Array(128).fill(0.2)]]), true);
  assert.equal(messages[1]?.samples?.length, 960);
  assert.ok(messages[1]!.samples!.every((value) => Math.abs(value - 0.2) < 1e-6));
  processor.port.onmessage({ data: "ack" }); processor.port.onmessage({ data: "flush-turn" });
  assert.equal(messages[2]?.samples?.length, 64);
  assert.equal(processor.process([[new Float32Array(128)]]), true);
  processor.port.onmessage({ data: "stop" });
  assert.equal(processor.process([[new Float32Array(128)]]), false);
});

test("Vite serves the standalone AudioWorklet module without a browser or provider dependency", async () => {
  const vite = await createViteServer({ configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../..", import.meta.url)), optimizeDeps: { noDiscovery: true }, server: { host: "127.0.0.1", port: 0 } });
  try {
    await vite.listen(); const address = vite.httpServer?.address(); assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/src/audio/capture.worklet.js`);
    assert.equal(response.status, 200); const code = await response.text();
    assert.match(code, /registerProcessor\("local-audio-capture"/u); assert.doesNotMatch(code, /GNANI_API_KEY|api\.vachana/u);
    let registered = "";
    runInNewContext(code, { AudioWorkletProcessor: class {}, sampleRate: 48000,
      registerProcessor: (name: string) => { registered = name; } });
    assert.equal(registered, "local-audio-capture");
  } finally { await vite.close(); }
});
