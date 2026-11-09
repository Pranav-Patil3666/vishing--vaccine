import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LearnerTurnEventSchema, SafeSessionSchema, type BehaviorLabel, type SafeSession } from "@vaccine/contracts";
import { createApiServer } from "../../api/src/health.js";
import { InMemorySessionStore } from "../../api/src/sessionStore.js";
import { createSessionState } from "../../api/src/session.js";
import { App } from "./App.js";
import { fetchApiHealth } from "./healthClient.js";
import { DashboardPage, DebriefPage } from "./pages/ResultsPages.js";
import { scenarioById } from "./scenarioCatalog.js";
import { createApiClient } from "./sessionApi.js";
import { activeSessionKey, parseSessionIds, sessionHistoryKey, summarizeSessions, uniqueRecentSessions } from "./trainingResults.js";

async function appHarness(t: TestContext, hash = "#/dashboard", environment = "test") {
  const store = new InMemorySessionStore();
  const synthesized: string[] = [];
  let providerStarts = 0, microphoneRequests = 0;
  let permission: () => Promise<MediaStream> = async () => { throw new DOMException("permission refused", "NotAllowedError"); };
  const noProvider = () => { providerStarts++; throw new Error("Live recognition is outside this test"); };
  const server = createApiServer({ environment, sessionStore: store, runtimeRecognizer: { openStream: noProvider, transcribe: noProvider },
    synthesizer: { async synthesize(request) {
      assert.equal(request.scenarioId, "S-01");
      assert.equal("text" in request, false);
      synthesized.push(request.responseId);
      return { bytes: new Uint8Array(), mediaType: "application/x-offline-test" };
    } },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  let intercept: (path: string, method: string) => Response | undefined = () => undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, base, "only the loopback API is reachable");
    const method = init?.method ?? "GET";
    requests.push({ path: url.pathname, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return intercept(url.pathname, method) ?? fetch(input, init);
  };
  const api = createApiClient(base, fetcher);
  const dom = new JSDOM("<div id='root'></div>", { url: base + "/" + hash });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (key: string, value: unknown) => {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  };
  setGlobal("window", dom.window); setGlobal("document", dom.window.document);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true); setGlobal("isSecureContext", true);
  setGlobal("AudioContext", class {}); setGlobal("AudioWorkletNode", class {});
  setGlobal("navigator", { mediaDevices: { getUserMedia: () => { microphoneRequests++; return permission(); } } });
  let root: Root | null = null;
  async function unmount() {
    if (root) { await act(async () => root?.unmount()); root = null; }
  }
  async function mount() {
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root?.render(<StrictMode><App client={api} loadHealth={() => fetchApiHealth(base, fetcher)} development /></StrictMode>));
  }
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await mount();
  const text = () => dom.window.document.querySelector("main")?.textContent ?? "";
  async function waitFor(pattern: RegExp) {
    for (let attempt = 0; attempt < 150 && !pattern.test(text()); attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
    }
    assert.match(text(), pattern);
  }
  const button = (label: string) => {
    const value = [...dom.window.document.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
    assert.ok(value, label);
    return value;
  };
  const click = async (label: string) => { await act(async () => button(label).click()); };
  const goto = async (next: string) => {
    await act(async () => { dom.window.location.hash = next; dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange")); });
  };
  const consent = async () => {
    await waitFor(/Before you begin/u);
    const checkbox = dom.window.document.querySelector<HTMLInputElement>(".consent-check input");
    assert.ok(checkbox);
    await act(async () => checkbox.click());
  };
  const count = (method: string, path: string) => requests.filter((entry) => entry.method === method && entry.path === path).length;
  return { api, store, synthesized, requests, dom, text, waitFor, button, click, goto, consent, count, mount, unmount,
    intercept: (handler: typeof intercept) => { intercept = handler; },
    permission: (handler: typeof permission) => { permission = handler; },
    providerStarts: () => providerStarts, microphoneRequests: () => microphoneRequests };
}

test("7A and 7C browser to API: consent, approved S-01 policy, terminal debrief and history after reload", async (t) => {
  const h = await appHarness(t);
  await h.waitFor(/No recorded sessions yet/u);
  await h.click("Start training");
  await h.waitFor(/Urgent account verification/u);
  assert.doesNotMatch(h.text(), /S-02|S-03|S-90|S-91|S-92|S-93/u);
  await h.click("Choose scenario");
  await h.waitFor(/Before you begin/u);
  assert.equal(h.button("Start simulation").disabled, true);
  await h.click("Decline and return to training");
  await h.waitFor(/Choose a practice call/u);
  assert.equal(h.count("POST", "/api/sessions"), 0);
  await h.click("Choose scenario"); await h.consent();
  const start = h.button("Start simulation");
  await act(async () => { start.click(); start.click(); });
  await h.waitFor(/Ready for your response/u);
  assert.equal(h.count("POST", "/api/sessions"), 1);
  const id = h.store.values()[0]!.sessionId;
  assert.equal(h.count("POST", `/api/sessions/${id}/consent`), 1);
  assert.equal(h.store.get(id).mode, "safe");
  assert.equal(h.microphoneRequests(), 0);
  assert.match(h.text(), /Offline demonstration/u);
  assert.ok(h.text().includes(scenarioById("S-01")!.responses["system.opening"]!.text));
  await h.click("Ask for time"); await h.click("Submit response");
  await h.waitFor(/1 \/ 3/u);
  assert.equal(h.store.get(id).timelineEvents[0]!.behavior.label, "STALLED");
  assert.equal(h.store.get(id).currentResponseId, "authority");
  assert.ok(h.text().includes(scenarioById("S-01")!.responses.authority!.text));
  await h.click("Verify independently"); await h.click("Submit response");
  await h.waitFor(/Session debrief/u);
  assert.match(h.text(), /2 committed turns/u);
  assert.match(h.text(), /Independent verification/u);
  assert.match(h.text(), /Claimed authority/u);
  assert.match(h.text(), /The session cannot confirm an external check/u);
  assert.equal(h.store.get(id).terminalState, "SAFE_VERIFIED");
  assert.ok(h.store.get(id).timelineEvents.every((event) => event.nextPressureLevel <= h.store.get(id).maxPressureLevel));
  assert.equal(h.store.get(id).recordingEnabled, false);
  await assert.rejects(h.api.submitMockTurn(id, "I refuse"), { status: 409 });
  assert.deepEqual(h.synthesized, ["authority", "system.safe-ending"]);
  assert.equal(h.providerStarts(), 0);
  const credit = await h.api.getRuntimeCredit!();
  assert.deepEqual([credit.stt.providerAttempts, credit.tts.providerAttempts], [0, 0]);
  assert.equal(h.dom.window.sessionStorage.getItem(sessionHistoryKey), JSON.stringify([id]));
  assert.equal(h.dom.window.sessionStorage.getItem(activeSessionKey), null);
  await h.click("Session history");
  await h.waitFor(/Open debrief/u);
  assert.equal(h.dom.window.document.querySelectorAll("tbody tr").length, 1);
  await h.unmount(); await h.mount();
  await h.waitFor(/Open debrief/u);
  assert.equal(h.count("POST", "/api/sessions"), 1);
  await h.click("Open debrief"); await h.waitFor(/2 committed turns/u);
  await h.waitFor(/Practice again/u);
  await h.click("Practice again"); await h.waitFor(/Before you begin/u);
  assert.equal(h.button("Start simulation").disabled, true);
});

test("7A reload closes an interrupted call and manual End is idempotent", async (t) => {
  const h = await appHarness(t, "#/training/precall/S-01");
  await h.consent(); await h.click("Start simulation"); await h.waitFor(/Ready for your response/u);
  const first = h.store.values()[0]!.sessionId;
  await h.click("Ask for time"); await h.click("Submit response"); await h.waitFor(/1 \/ 3/u);
  await h.unmount(); await h.mount();
  await h.waitFor(/This call has ended/u);
  assert.equal(h.store.get(first).terminalState, "LEARNER_ENDED");
  assert.equal(h.store.get(first).timelineEvents.length, 1);
  assert.equal(h.store.get(first).recordingEnabled, false);
  assert.equal(h.count("POST", "/api/sessions"), 1);
  await h.click("Open debrief"); await h.waitFor(/Stopped by learner/u);
  await h.waitFor(/Practice again/u);
  await h.click("Practice again"); await h.consent(); await h.click("Start simulation"); await h.waitFor(/Ready for your response/u);
  const second = h.store.values().at(-1)!.sessionId;
  const end = h.button("End simulation");
  await act(async () => { end.click(); end.click(); });
  await h.waitFor(/No learner turn was committed/u);
  assert.equal(h.count("POST", `/api/sessions/${second}/end`), 1);
  assert.equal(h.store.get(second).terminalState, "LEARNER_ENDED");
  assert.doesNotMatch(h.text(), /0 \/ 5|What you handled well/u);
  assert.equal(h.microphoneRequests(), 0);
});

test("7A unavailable and withdrawn catalog, invalid session start, and explicit retry fail closed", async (t) => {
  const h = await appHarness(t, "#/scenarios");
  await h.waitFor(/Choose scenario/u);
  await h.goto("#/training/precall/S-92");
  await h.waitFor(/Scenario unavailable/u);
  assert.equal(h.count("POST", "/api/sessions"), 0);
  await h.goto("#/training/precall/S-01"); await h.consent();
  h.intercept((path) => path === "/api/runtime/scenarios" ? new Response("", { status: 503 }) : undefined);
  await h.click("Start simulation"); await h.waitFor(/Training catalog unavailable/u);
  assert.equal(h.count("POST", "/api/sessions"), 0);
  h.intercept(() => undefined);
  await h.click("Retry connection"); await h.consent();
  h.intercept((path) => path === "/api/runtime/scenarios" ? Response.json({ scenarios: [] }) : undefined);
  await h.click("Start simulation"); await h.waitFor(/changed or been withdrawn/u);
  assert.equal(h.count("POST", "/api/sessions"), 0);
  await assert.rejects(h.api.createDemoSession({ scenarioId: "S-92", scenarioVersion: "0.1.1", language: "hi-en", demoMode: false }), { status: 404 });
  await assert.rejects(h.api.createDemoSession({ scenarioId: "S-01", scenarioVersion: "9.9.9", language: "hi-IN", demoMode: false }), { status: 422 });
  assert.equal(h.store.values().length, 0);
  assert.equal(h.providerStarts(), 0);
  await h.goto("#/debrief/nonexistent");
  await h.waitFor(/Session unavailable/u);
});

test("7A a failed response lookup never retries input automatically and allows an explicit retry", async (t) => {
  const h = await appHarness(t, "#/training/precall/S-01");
  await h.waitFor(/Before you begin/u);
  await h.unmount(); await h.mount();
  await h.waitFor(/Before you begin/u);
  assert.equal(h.button("Start simulation").disabled, true);
  assert.equal(h.count("POST", "/api/sessions"), 0);
  await h.consent(); await h.click("Start simulation"); await h.waitFor(/Ready for your response/u);
  const id = h.store.values()[0]!.sessionId;
  const path = `/api/sessions/${id}/turn`;
  h.intercept((url) => url === path ? Response.json({ error: { code: "TRANSCRIPTION_FAILED", message: "untrusted response detail" } }, { status: 502 }) : undefined);
  await h.click("Ask for time"); await h.click("Submit response");
  await h.waitFor(/The response could not be processed/u);
  assert.doesNotMatch(h.text(), /untrusted response detail/u);
  assert.equal(h.count("POST", path), 1);
  assert.equal(h.store.get(id).timelineEvents.length, 0);
  h.intercept(() => undefined);
  await h.click("Submit response"); await h.waitFor(/1 \/ 3/u);
  assert.equal(h.count("POST", path), 2);
  assert.equal(h.store.get(id).timelineEvents.length, 1);
  await h.click("End simulation"); await h.waitFor(/Stopped by learner/u);
});

test("7A explicit voice permission handles denial and exit while permission is pending", async (t) => {
  const h = await appHarness(t, "#/training/precall/S-01", "development");
  async function voiceReady() {
    await h.waitFor(/Live voice · automatic conversation/u);
    const voice = [...h.dom.window.document.querySelectorAll<HTMLInputElement>("input[type=radio]")]
      .find((radio) => radio.parentElement?.textContent?.includes("Live voice"));
    assert.ok(voice);
    await act(async () => voice.click());
    assert.match(h.text(), /sent to Prisma for transcription/u);
    await h.consent(); await h.click("Start simulation");
    await h.waitFor(/Start automatic conversation/u);
  }
  await voiceReady();
  assert.equal(h.microphoneRequests(), 0);
  await h.click("Start automatic conversation");
  await h.waitFor(/Microphone permission was denied/u);
  await h.waitFor(/Open debrief/u);
  await h.click("Open debrief"); await h.waitFor(/TECHNICAL STOP/u);
  assert.match(h.text(), /No learner turn was committed/u);
  await h.click("Practice again"); await voiceReady();
  let allow: ((stream: MediaStream) => void) | undefined;
  let stopped = 0;
  h.permission(() => new Promise((resolve) => { allow = resolve; }));
  await h.click("Start automatic conversation");
  await h.waitFor(/Allow microphone access when prompted/u);
  const id = h.store.values().at(-1)!.sessionId;
  await h.goto("#/scenarios");
  await h.waitFor(/Choose a practice call/u);
  await act(async () => allow?.({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream));
  assert.equal(stopped, 1);
  assert.equal(h.providerStarts(), 0);
  assert.equal(h.count("POST", `/api/sessions/${id}/conversation/start`), 0);
  assert.equal(h.microphoneRequests(), 2);
});

function result(overrides: Partial<SafeSession> = {}): SafeSession {
  return SafeSessionSchema.parse({
    ...createSessionState({ sessionId: randomUUID(), scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", startingNodeId: "start" }),
    pressureDebrief: null, debriefEvents: [], state: "COMPLETED", ...overrides,
  });
}

function committed(session: SafeSession, label: BehaviorLabel, index: number) {
  return LearnerTurnEventSchema.parse({ sessionId: session.sessionId, turnId: `${session.sessionId}:turn-${index}`, scenarioId: session.scenarioId,
    scenarioVersion: session.scenarioVersion, language: session.language, callerTacticId: index === 2 ? "authority" : null,
    callerResponseId: index === 2 ? "authority" : "system.opening", callerTacticCategory: index === 2 ? "AUTHORITY" : null,
    callerPressureLevel: index === 2 ? 1 : 0, selectedNextTacticId: index === 1 ? "fear" : null,
    fillerWords: [], fillerCount: 0, speechRateWpm: null, baselineSpeechRateWpm: null, speechRateDeltaPercent: null,
    baselineStatus: "insufficient_data", interruption: { status: "unknown", source: "UNKNOWN", playbackTimingCertain: false },
    behavior: { label, evidenceRuleIds: [], source: "deterministic_rules" }, complianceMoment: null, observedEvidenceRuleIds: [] });
}

test("7A evidence debrief describes all six behaviors and only recorded caller exposure", () => {
  const labels = ["STALLED", "VERIFIED_INDEPENDENTLY", "REFUSED", "COMPLIED", "DISCLOSED_DUMMY_SECRET", "UNKNOWN"] as const;
  const labelsShown = [/Asked for time/u, /Chose independent verification/u, /Refused a request/u, /Agreed to a request/u, /Disclosed a practice token/u, /Unclear response/u];
  for (const [index, label] of labels.entries()) {
    const session = result({ terminalState: "MAX_TURNS", turnNumber: 1 });
    session.timelineEvents = [committed(session, label, 2)];
    const html = renderToStaticMarkup(<DebriefPage session={session} lookup={() => scenarioById("S-01")} canPractice navigate={() => {}} />);
    assert.match(html, labelsShown[index]!);
    assert.match(html, /Claimed authority/u);
    assert.doesNotMatch(html, /Fear of consequences|completed an external|recognized the tactic|Observable rubric/u);
    if (label === "COMPLIED") assert.doesNotMatch(html, /synthetic training token|Practice token disclosed/u);
  }
});

test("7A terminal outcomes and missing optional evidence retain their separate meaning", () => {
  for (const [state, terminalState, expected] of [
    ["COMPLETED", "SAFE_VERIFIED", "Independent verification"],
    ["COMPLETED", "DUMMY_SECRET_DISCLOSED", "Practice token disclosed"],
    ["COMPLETED", "SAFE_FALLBACK", "Safe fallback"],
    ["COMPLETED", "MAX_TURNS", "Turn limit reached"],
    ["ENDED_BY_LEARNER", "LEARNER_ENDED", "Stopped by learner"],
    ["ENDED_BY_LEARNER", "SAFE_WORD", "Safe word used"],
    ["ERROR", null, "Technical stop"],
  ] as const) {
    const html = renderToStaticMarkup(<DebriefPage session={result({ state, terminalState })} lookup={() => undefined} canPractice={false} navigate={() => {}} />);
    assert.ok(new RegExp(expected, "iu").test(html));
    assert.match(html, /No learner turn was committed|Time unavailable/u);
    assert.doesNotMatch(html, /Observable rubric|What you handled well|What to practice/u);
  }
});

test("7C history validates tab IDs, deduplicates, sorts and excludes active records from distribution", () => {
  const a = result({ terminalState: "SAFE_VERIFIED" });
  const b = result({ runtimeMode: "REAL_CONVERSATION", state: "ENDED_BY_LEARNER", terminalState: "LEARNER_ENDED" });
  const c = result({ terminalState: "DUMMY_SECRET_DISCLOSED" });
  const active = result({ state: "READY" });
  a.timelineEvents = [committed(a, "REFUSED", 1), committed(a, "VERIFIED_INDEPENDENTLY", 2)];
  c.timelineEvents = [committed(c, "COMPLIED", 1), committed(c, "DISCLOSED_DUMMY_SECRET", 2)];
  assert.deepEqual(parseSessionIds([a.sessionId, a.sessionId, {}, "not-a-session", null, b.sessionId]), [a.sessionId, b.sessionId]);
  assert.deepEqual(parseSessionIds({ bad: "record" }), []);
  assert.equal(parseSessionIds(Array.from({ length: 50 }, () => randomUUID())).length, 20);
  const startedAt = "2026-11-09T08:00:00.000Z";
  b.metrics = [{ operation: "session_creation", sessionId: b.sessionId, startedAt, endedAt: startedAt, durationMs: 0, measuredAt: startedAt, success: true }];
  assert.equal(uniqueRecentSessions([a, c, b, a])[0]?.sessionId, b.sessionId);
  const summary = summarizeSessions([a, b, c, a, active]);
  assert.deepEqual([summary.total, summary.completed, summary.stopped, summary.verification, summary.disclosure, summary.ended], [4, 2, 1, 1, 1, 3]);
  assert.deepEqual(summary.tactics, [["AUTHORITY", 2]]);
  assert.equal(summary.behaviors.find(([label]) => label === "COMPLIED")?.[1], 1);
  const html = renderToStaticMarkup(<DashboardPage sessions={[a, b, c, active]} loading={false} issue={null} navigate={() => {}} refresh={() => {}} lookup={() => undefined} />);
  const dom = new JSDOM(html);
  const voice = dom.window.document.querySelector('[aria-label="Voice practice"]')?.textContent;
  const offline = dom.window.document.querySelector('[aria-label="Offline demonstration"]')?.textContent;
  assert.match(voice ?? "", /1 recorded/u);
  assert.match(offline ?? "", /3 recorded/u);
  assert.match(offline ?? "", /1 of 2/u);
  assert.match(offline ?? "", /Refused a request|Claimed authority/u);
  assert.doesNotMatch(offline ?? "", /Fear of consequences/u);
  dom.window.close();
});
