import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AudioLines, Mic2 } from "lucide-react";
import type { SafeSession, RealVoiceTurnResult } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { acquireBrowserMicrophone } from "../audio/browserCapture.js";
import { automaticStartBlockedReason, BoundedConversationController, type ConversationSnapshot, type ConversationUiState } from "../audio/conversationController.js";
import { BrowserAudioError } from "../audio/errors.js";

const callInstructions: Record<ConversationUiState, string> = {
  IDLE: "Use headphones. The browser asks for microphone permission after you start the call.",
  MIC_PREPARING: "Allow microphone access when prompted. Keep quiet while audio is prepared.",
  CALLER_PREPARING: "Getting the next approved caller line ready.",
  CALLER_PLAYING: "The AI caller is speaking. Wait for the listening signal.",
  LEARNER_PREPARING: "Stay quiet briefly while the microphone prepares for your turn.",
  LEARNER_LISTENING: "Speak now. Use fictional information only.",
  LEARNER_FINALIZING: "Processing your response. The learner window has closed.",
  TERMINAL_CALLER_PLAYING: "The caller is closing the simulation. Your debrief will open when playback finishes.",
  COMPLETED: "The call is complete. Your recorded turns are ready to review.",
  STOPPED: "The call has stopped.",
  ERROR: "The call could not continue.",
};

export function ConversationPanel(props: { session: SafeSession; api: ApiClient; stopControl: MutableRefObject<(() => void) | null>;
  onSession(session: SafeSession): void; onTurn(result: RealVoiceTurnResult): void; onFinished(session: SafeSession): void }) {
  const callbacks = useRef(props); callbacks.current = props;
  const controller = useRef<BoundedConversationController | null>(null);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [preparationIssue, setPreparationIssue] = useState<string | null>(null);
  const initial = useRef(props.session);
  useEffect(() => {
    let mounted = true;
    const instance = new BoundedConversationController({ session: initial.current, api: props.api,
      acquire: async (signal) => {
        try { return await acquireBrowserMicrophone(signal); }
        catch (cause) {
          if (mounted && !signal.aborted) setPreparationIssue(cause instanceof BrowserAudioError ? cause.message : "The microphone could not be prepared.");
          throw cause;
        }
      },
      onChange: (value) => { if (mounted) setSnapshot(value); },
      onSession: (session) => { if (mounted) callbacks.current.onSession(session); },
      onTurn: (result) => { if (mounted) callbacks.current.onTurn(result); },
      onFinished: (session) => { if (mounted) callbacks.current.onFinished(session); } });
    controller.current = instance; props.stopControl.current = () => instance.stop();
    setSnapshot(instance.snapshot());
    return () => { mounted = false; props.stopControl.current = null; instance.dispose(); controller.current = null; };
  }, [props.api, props.stopControl]);
  const phase = props.session.conversation?.phase;
  const state = phase === "STOPPED" || phase === "COMPLETED" || phase === "ERROR" ? phase : snapshot?.state ?? "IDLE";
  const blockedReason = automaticStartBlockedReason(props.session);
  const failure = snapshot?.technical ?? props.session.conversation?.failure;
  const error = snapshot?.error ?? props.session.conversation?.failureCode;
  const cause = failure?.causeCode ?? error;
  const explanation = preparationIssue ?? (cause === "CREDIT_LIMIT_REACHED" ? "The local voice allowance has been reached."
    : cause === "STT_TIMEOUT" || cause === "STT_CONNECTION_FAILED" || cause === "STT_UNAVAILABLE" ? "Speech recognition did not respond."
    : cause === "MEDIA_STREAM_ENDED" || cause === "MICROPHONE_DISABLED" ? "The microphone was disconnected or disabled."
    : cause === "NETWORK_ERROR" ? "The local connection was interrupted."
    : error === "CALLER_AUDIO_FAILED" ? "The approved caller audio could not be played."
    : "The simulation stopped before the next step could finish.");
  function startAutomaticConversation() {
    if (automaticStartBlockedReason(callbacks.current.session)) return;
    controller.current?.start(callbacks.current.session);
  }
  return <section className="panel learner-input-panel call-stage" aria-label="Automatic conversation">
    <div className="panel-heading"><div><span className="eyebrow">AI-GENERATED CALLER VOICE · SIMULATION</span><h2>Automatic S-01 conversation</h2></div></div>
    <div className={`call-signal ${state === "LEARNER_LISTENING" ? "call-signal-listening" : ""}`}>
      {state === "LEARNER_LISTENING" ? <Mic2 size={24} aria-hidden="true" /> : <AudioLines size={24} aria-hidden="true" />}
      <div><strong role="status">{state === "IDLE" && props.session.state === "READY" ? "READY" : state.replaceAll("_", " ")}</strong><p>{callInstructions[state]}</p></div>
    </div>
    {state === "IDLE" && <>
      <button type="button" className="button button-primary" disabled={blockedReason !== null} aria-describedby={blockedReason ? "automatic-start-reason" : undefined} onClick={startAutomaticConversation}>Start automatic conversation</button>
      {blockedReason && <p id="automatic-start-reason" role="alert">{blockedReason}</p>}</>}
    {error && <div className="inline-error" role="alert"><div><strong>{explanation}</strong><p>Open the partial debrief to review any committed turns. You can start fresh in offline practice.</p><small>Technical stop: {error}{failure ? ` · ${failure.causeCode}` : ""}</small></div></div>}
    <details><summary>Technical audio facts</summary><pre>{JSON.stringify({ audioClockId: snapshot?.clockId, failure, microphone: snapshot?.microphone,
      callers: snapshot?.callers.map(({ responseId, position, terminal, asset }) => ({ responseId, position, terminal, cacheHit: asset.cacheHit })),
      learner: snapshot?.diagnostics ? { sourceRate: snapshot.diagnostics.sourceRate,
        frameCount: snapshot.diagnostics.frameCount, audioClockId: snapshot.diagnostics.audioClockId,
        callerStartMs: snapshot.diagnostics.callerStartMs, callerEndMs: snapshot.diagnostics.callerEndMs,
        learnerStartMs: snapshot.diagnostics.latestStartMs, learnerEndMs: snapshot.diagnostics.latestEndMs,
        timingValid: snapshot.diagnostics.timingValid, failure: snapshot.diagnostics.failure } : null }, null, 2)}</pre></details>
  </section>;
}
