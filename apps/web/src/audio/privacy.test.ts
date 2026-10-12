import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserAudioPanel } from "../components/BrowserAudioPanel.js";
import { BrowserAudioController, type AudioDiagnostics } from "./controller.js";

test("audio implementation has no persistence, raw-buffer logging or provider access", () => {
  const directory = resolve("apps/web/src/audio");
  const source = readdirSync(directory).filter((name) => !name.includes(".test.") && name !== "useBrowserAudio.ts").map((name) => readFileSync(resolve(directory, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|MediaRecorder|console\.|GNANI_API_KEY|api\.vachana|writeFile|caches\./u);
  const hook = readFileSync(resolve(directory, "useBrowserAudio.ts"), "utf8");
  assert.match(hook, /if \(import\.meta\.env\.DEV\) console\.info\("\[BROWSER_AUDIO_DIAGNOSTIC\]", diagnostic\)/u);
  assert.equal(hook.match(/console\./gu)?.length, 1);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|indexedDB|MediaRecorder|GNANI_API_KEY|api\.vachana/u);
  assert.match(hook, /audio\.stop\(\)/u); assert.doesNotMatch(hook, /audio\.prepare\(\)/u);
  const app = readFileSync(resolve("apps/web/src/App.tsx"), "utf8");
  assert.match(app, /import\.meta\.env\.DEV && canUseFixtures/u);
  assert.match(app, /audio\.stop\(\);\s*void onEnd\(\)/u);
});
test("diagnostic panel starts with preparation disabled and interruption unavailable", () => {
  const markup = renderToStaticMarkup(BrowserAudioPanelElement());
  assert.match(markup, /Prepare microphone/u); assert.match(markup, /disabled=""/u);
  assert.match(markup, /speaker-bleed QA has not passed/u); assert.match(markup, /No audio recording is retained/u);
  assert.doesNotMatch(markup, /INTERRUPTION DETECTED/u);
});
function BrowserAudioPanelElement() {
  // No browser/device API is accessed by rendering the component.
  return createElement(BrowserAudioPanel, { diagnostics: null, disabled: false, onPrepare: () => {}, onStop: () => {}, onFinish: () => {}, onPlay: () => {} });
}

function completedDiagnostics(): AudioDiagnostics {
  const controller = new BrowserAudioController({ sessionId: "s", turnNumber: 1, eligible: () => true,
    acquire: async () => { throw new Error("render must not acquire"); }, forwarder: () => { throw new Error("render must not forward"); }, onChange() {} });
  return { ...controller.diagnostics, state: "COMPLETED", sourceRate: 48000, frameCount: 17, segmentCount: 1,
    latestStartMs: 1000, latestEndMs: 1500, settings: { echoCancellation: true, channelCount: 1 },
    summary: { frameCount: 17, receivedBytes: 17408, observations: [{ segmentNumber: 1, responseLatencyMs: null,
      preSpeechSilenceMs: null, speechDurationMs: 500, overlapCandidate: null, interruptionStatus: "unknown" }],
    speakerBleedValidation: "UNKNOWN", interruptionReportingEnabled: false } };
}
function panelMarkup(diagnostics: AudioDiagnostics): string {
  return renderToStaticMarkup(createElement(BrowserAudioPanel, { diagnostics, disabled: false, onPrepare() {}, onStop() {}, onFinish() {}, onPlay() {} }));
}
function button(markup: string, label: string): string {
  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
  const found = buttons.find((value) => value.includes(label)); assert.ok(found); return found;
}

test("completed panel visibly preserves local and backend counts with Finish and Stop disabled", () => {
  const markup = panelMarkup(completedDiagnostics());
  assert.match(markup, /COMPLETED/u); assert.match(markup, /Microphone check complete\./u);
  assert.match(markup, /Produced frames: 17/u); assert.match(markup, /Backend received frames: 17/u);
  assert.match(markup, /Backend received bytes: 17408/u); assert.match(markup, /48000 \/ 16000 Hz/u);
  assert.doesNotMatch(markup, /Microphone check is inactive/u);
  assert.match(button(markup, "Finish check"), /disabled=""/u); assert.match(button(markup, "Stop mic now"), /disabled=""/u);
  assert.match(markup, /Response latency \/ pre-speech silence<\/dt><dd>Unavailable \/ Unavailable/u);
  assert.match(markup, /Local speech duration<\/dt><dd>500 ms/u);
});

test("finishing panel disables duplicate Finish and Prepare while retaining the emergency hard stop", () => {
  const markup = panelMarkup({ ...completedDiagnostics(), state: "FINISHING", summary: null });
  assert.match(markup, /Finishing microphone check/u); assert.doesNotMatch(markup, /Microphone check complete/u);
  assert.match(button(markup, "Finish check"), /disabled=""/u); assert.match(button(markup, "Prepare microphone"), /disabled=""/u);
  assert.doesNotMatch(button(markup, "Stop mic now"), /disabled=""/u);
});

test("hard-stopped panel never masquerades as a completed check", () => {
  const markup = panelMarkup({ ...completedDiagnostics(), state: "STOPPED", summary: null });
  assert.match(markup, /Microphone check is inactive/u); assert.doesNotMatch(markup, /Microphone check complete/u);
  assert.match(markup, /Backend received bytes<\/dt><dd>Unavailable/u);
});
