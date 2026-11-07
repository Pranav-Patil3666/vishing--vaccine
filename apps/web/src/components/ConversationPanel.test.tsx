import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { SafeSessionSchema, type SafeSession } from "@vaccine/contracts";
import { createSessionState, endSession, transitionConsent } from "../../../api/src/session.js";
import { ConversationPanel } from "./ConversationPanel.js";
import { BoundedConversationController } from "../audio/conversationController.js";
import type { ApiClient } from "../sessionApi.js";

function ready(mode: SafeSession["runtimeMode"] = "REAL_CONVERSATION"): SafeSession {
  return SafeSessionSchema.parse({ ...transitionConsent(createSessionState({ sessionId: "entry-test", scenarioId: "S-01", scenarioVersion: "0.2.0",
    language: "hi-IN", startingNodeId: "start", runtimeMode: mode, mode: "safe", maxTurns: 3, scenarioRuntimeStatus: "RUNTIME_ELIGIBLE" }), "granted", new Date("2026-10-19T00:00:00Z")), pressureDebrief: null, debriefEvents: [] });
}

async function mounted(context: TestContext, initial = ready()) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://127.0.0.1" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const setGlobal = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  let microphoneRequests = 0, ended = 0, actions = 0;
  setGlobal("window", dom.window); setGlobal("document", dom.window.document); setGlobal("navigator", {
    mediaDevices: { getUserMedia: () => { microphoneRequests++; return new Promise<MediaStream>(() => {}); } },
  });
  setGlobal("isSecureContext", true); setGlobal("AudioContext", class {}); setGlobal("AudioWorkletNode", class {});
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const stopControl = { current: null as (() => void) | null };
  let session = initial;
  const api = {
    conversationAction: async () => { actions++; throw new Error("No conversation API request is expected before microphone permission resolves."); },
    endSession: async () => { ended++; return SafeSessionSchema.parse(endSession({ ...createSessionState({ sessionId: session.sessionId, scenarioId: "S-01", scenarioVersion: "0.2.0", language: "hi-IN", startingNodeId: "start", runtimeMode: session.runtimeMode }), ...session }, new Date("2026-10-19T00:00:01Z"))); },
  } as unknown as ApiClient;
  const render = async (next = session) => {
    session = next;
    await act(async () => root.render(<StrictMode><ConversationPanel session={session} api={api} stopControl={stopControl}
      onSession={() => {}} onTurn={() => {}} onFinished={() => {}} /></StrictMode>));
  };
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  context.after(async () => {
    await unmount(); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  });
  await render();
  const button = () => [...dom.window.document.querySelectorAll("button")].find((value) => value.textContent === "Start automatic conversation");
  const status = () => dom.window.document.querySelector("strong[role='status']")?.textContent;
  // Mirrors LiveCallPage's unchanged End handler: synchronous audio stop, then backend end.
  const end = async () => { await act(async () => { stopControl.current?.(); session = await api.endSession(session.sessionId); }); await render(session); };
  return { dom, render, unmount, button, status, stopControl, end, counts: () => ({ microphoneRequests, ended, actions }) };
}

test("StrictMode READY with pre-call consent renders a visible enabled primary start CTA", async (context) => {
  const view = await mounted(context);
  const button = view.button(); assert.ok(button); assert.equal(button.disabled, false); assert.match(button.className, /button-primary/u);
  assert.equal(button.hidden, false); assert.equal(view.status(), "READY");
  assert.deepEqual(view.counts(), { microphoneRequests: 0, ended: 0, actions: 0 });
  assert.equal(view.dom.window.document.querySelector("input[type=checkbox]"), null, "pre-call consent needs no hidden second gate");
});

test("start click calls the existing getUserMedia path once, before any network await", async (context) => {
  const view = await mounted(context);
  await act(async () => { view.button()!.click(); assert.equal(view.counts().microphoneRequests, 1); assert.equal(view.counts().actions, 0); });
  assert.equal(view.status(), "MIC PREPARING"); assert.equal(view.button(), undefined);
});

test("duplicate clicks and rerender cannot request the microphone twice", async (context) => {
  const view = await mounted(context), button = view.button()!;
  await act(async () => { button.click(); button.click(); }); await view.render();
  assert.equal(view.counts().microphoneRequests, 1); assert.equal(view.status(), "MIC PREPARING");
});

test("StrictMode effect replay, idle disposal and READY rerenders never create STOPPED", async (context) => {
  const view = await mounted(context); await view.render(); await view.render();
  assert.equal(view.status(), "READY"); assert.equal(view.button()!.disabled, false); assert.equal(view.counts().ended, 0);
  const snapshots: string[] = [];
  const controller = new BoundedConversationController({ session: ready(), api: {} as ApiClient,
    onChange: (value) => snapshots.push(value.state), onSession: () => {}, onTurn: () => {}, onFinished: () => {} });
  controller.dispose(); assert.equal(controller.snapshot().state, "IDLE"); assert.deepEqual(snapshots, []);
});

test("missing session consent blocks startup with an explicit accessible reason", async (context) => {
  const session = ready(); session.consent.status = "not-requested";
  const view = await mounted(context, session), button = view.button()!;
  assert.equal(button.disabled, true); assert.equal(button.getAttribute("aria-describedby"), "automatic-start-reason");
  assert.match(view.dom.window.document.querySelector("[role=alert]")!.textContent!, /Session consent is required/u);
  await act(async () => button.click()); assert.equal(view.counts().microphoneRequests, 0); assert.equal(view.status(), "READY");
});

test("an updated consent handoff enables the same READY controller without restarting the session", async (context) => {
  const session = ready(); session.consent.status = "not-requested";
  const view = await mounted(context, session); await view.render(ready());
  assert.equal(view.button()!.disabled, false); await act(async () => view.button()!.click());
  assert.equal(view.counts().microphoneRequests, 1); assert.equal(view.status(), "MIC PREPARING");
});

for (const mode of ["MOCK", "REAL_STT"] as const) test(`${mode} cannot enter the automatic microphone path`, async (context) => {
  const view = await mounted(context, ready(mode)); assert.equal(view.button()!.disabled, true);
  assert.match(view.dom.window.document.querySelector("[role=alert]")!.textContent!, /Automatic conversation mode is required/u);
  await act(async () => view.button()!.click()); assert.equal(view.counts().microphoneRequests, 0);
});

for (const active of [false, true]) test(`End simulation explicitly stops ${active ? "starting" : "READY"} session`, async (context) => {
  const view = await mounted(context);
  if (active) await act(async () => view.button()!.click());
  await view.end(); assert.equal(view.status(), "STOPPED"); assert.equal(view.button(), undefined); assert.equal(view.counts().ended, 1);
  await view.render(); assert.equal(view.status(), "STOPPED"); assert.equal(view.counts().microphoneRequests, Number(active));
});

test("navigation unmount of untouched READY does not end the backend session", async (context) => {
  const view = await mounted(context); assert.equal(view.counts().microphoneRequests, 0);
  await view.unmount(); assert.equal(view.counts().ended, 0); assert.equal(view.counts().microphoneRequests, 0);
});

test("an intentional stop from READY blocks a stale start handler", () => {
  const controller = new BoundedConversationController({ session: ready(), api: {} as ApiClient,
    acquire: async () => assert.fail("Stopped controller must not request microphone access"),
    onChange: () => {}, onSession: () => {}, onTurn: () => {}, onFinished: () => {} });
  controller.stop(); controller.start(); assert.equal(controller.snapshot().state, "STOPPED"); controller.dispose();
});

for (const [phase, outcome] of [
  ["COMPLETED", "SAFE_VERIFIED"], ["COMPLETED", "DUMMY_SECRET_DISCLOSED"], ["COMPLETED", "SAFE_FALLBACK"],
  ["COMPLETED", "MAX_TURNS"], ["STOPPED", "LEARNER_ENDED"], ["STOPPED", "SAFE_WORD"], ["ERROR", null],
] as const) test(`5C ${phase}/${outcome} renders its final status and cannot expose start/resume controls`, async (context) => {
  const session = ready(); session.terminalState = outcome; session.recordingEnabled = false;
  session.state = phase === "STOPPED" ? "ENDED_BY_LEARNER" : phase;
  session.conversation = { phase, ...(phase === "ERROR" ? { failureCode: "PROVIDER_FAILED" as const } : {}) };
  const view = await mounted(context, session);
  assert.equal(view.status(), phase); assert.equal(view.button(), undefined);
  assert.equal(view.dom.window.document.querySelectorAll("button").length, 0);
  assert.equal(view.counts().microphoneRequests, 0);
  if (phase === "ERROR") assert.match(view.dom.window.document.querySelector("[role=alert]")!.textContent!, /Technical stop: PROVIDER_FAILED/u);
  await view.render(); assert.equal(view.status(), phase);
});
