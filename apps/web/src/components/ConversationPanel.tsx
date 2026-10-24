import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { SafeSession, RealVoiceTurnResult, RuntimeCreditSnapshot } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { automaticStartBlockedReason, BoundedConversationController, type ConversationSnapshot } from "../audio/conversationController.js";

export function ConversationPanel(props: { session: SafeSession; api: ApiClient; stopControl: MutableRefObject<(() => void) | null>;
  onSession(session: SafeSession): void; onTurn(result: RealVoiceTurnResult): void; onFinished(session: SafeSession): void }) {
  const callbacks = useRef(props); callbacks.current = props;
  const controller = useRef<BoundedConversationController | null>(null);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [credit, setCredit] = useState<RuntimeCreditSnapshot | null>(null);
  const initial = useRef(props.session);
  useEffect(() => {
    let mounted = true;
    const instance = new BoundedConversationController({ session: initial.current, api: props.api,
      onChange: (value) => { if (mounted) setSnapshot(value); },
      onSession: (session) => { if (mounted) callbacks.current.onSession(session); },
      onTurn: (result) => { if (mounted) callbacks.current.onTurn(result); },
      onFinished: (session) => { if (mounted) callbacks.current.onFinished(session); } });
    controller.current = instance; props.stopControl.current = () => instance.stop();
    setSnapshot(instance.snapshot());
    return () => { mounted = false; props.stopControl.current = null; instance.dispose(); controller.current = null; };
  }, [props.api, props.stopControl]);
  useEffect(() => {
    let mounted = true;
    void props.api.getRuntimeCredit?.().then((value) => { if (mounted) setCredit(value); }).catch(() => {});
    return () => { mounted = false; };
  }, [props.api, props.session.turnNumber, props.session.conversation?.phase, snapshot?.state]);
  const state = ["STOPPED", "COMPLETED", "ERROR"].includes(props.session.conversation?.phase ?? "")
    ? props.session.conversation!.phase : snapshot?.state ?? "IDLE";
  const blockedReason = automaticStartBlockedReason(props.session);
  const failure = snapshot?.technical ?? props.session.conversation?.failure;
  const error = snapshot?.error ?? props.session.conversation?.failureCode;
  function startAutomaticConversation() {
    if (automaticStartBlockedReason(callbacks.current.session)) return;
    controller.current?.start(callbacks.current.session);
  }
  return <section className="panel learner-input-panel" aria-label="Automatic conversation">
    <div className="panel-heading"><div><span className="eyebrow">AI-GENERATED CALLER VOICE · SIMULATION</span><h2>Automatic S-01 conversation</h2></div><strong role="status">{state === "IDLE" && props.session.state === "READY" ? "READY" : state.replaceAll("_", " ")}</strong></div>
    <p>Up to {props.session.maxTurns} learner turns. Caller audio plays automatically; speak after it ends and LEARNER LISTENING appears. Use headphones. Keep quiet while preparing audio and calibrating.</p>
    <p>The microphone stays granted between turns. Samples during caller playback are discarded. Learner windows stream transiently to Prisma. End simulation stops capture and playback immediately.</p>
    {state === "IDLE" && <><p>Start automatic conversation authorizes microphone preparation and transient learner transcription under your session consent. Navigation alone does not request microphone access.</p>
      <button type="button" className="button button-primary" disabled={blockedReason !== null} aria-describedby={blockedReason ? "automatic-start-reason" : undefined} onClick={startAutomaticConversation}>Start automatic conversation</button>
      {blockedReason && <p id="automatic-start-reason" role="alert">{blockedReason}</p>}</>}
    {error && <p role="alert">Technical stop: {error}{failure ? ` · ${failure.stage} · ${failure.causeCode}` : ""}. Committed events are preserved; use End simulation to open the partial debrief.</p>}
    <p>Session {props.session.sessionId} · committed learner turns {props.session.turnNumber}/{props.session.maxTurns}</p>
    <details><summary>Technical audio facts</summary><pre>{JSON.stringify({ audioClockId: snapshot?.clockId, failure, credit, microphone: snapshot?.microphone,
      callers: snapshot?.callers, learner: snapshot?.diagnostics ? { sourceRate: snapshot.diagnostics.sourceRate,
        frameCount: snapshot.diagnostics.frameCount, audioClockId: snapshot.diagnostics.audioClockId,
        callerStartMs: snapshot.diagnostics.callerStartMs, callerEndMs: snapshot.diagnostics.callerEndMs,
        learnerStartMs: snapshot.diagnostics.latestStartMs, learnerEndMs: snapshot.diagnostics.latestEndMs,
        timingValid: snapshot.diagnostics.timingValid, failure: snapshot.diagnostics.failure } : null }, null, 2)}</pre></details>
  </section>;
}
