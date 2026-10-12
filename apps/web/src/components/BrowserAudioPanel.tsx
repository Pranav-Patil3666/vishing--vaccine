import { useState } from "react";
import { Activity, Mic2, Square } from "lucide-react";
import type { AudioDiagnostics } from "../audio/controller.js";

export function BrowserAudioPanel({ diagnostics, disabled, onPrepare, onStop, onFinish, onPlay }: {
  diagnostics: AudioDiagnostics | null; disabled: boolean;
  onPrepare: () => void; onStop: () => void; onFinish: () => void; onPlay: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const state = diagnostics?.state ?? "IDLE";
  const active = ["REQUESTING_PERMISSION", "READY", "CALIBRATING", "LISTENING", "SPEECH_ACTIVE", "FINISHING", "STOPPING"].includes(state);
  const listening = state === "LISTENING" || state === "SPEECH_ACTIVE";
  const summary = diagnostics?.summary;
  const completed = state === "COMPLETED" && Boolean(summary);
  const latest = summary?.observations.at(-1);
  const ms = (value: number | null | undefined) => value == null ? "Unavailable" : `${Math.round(value)} ms`;
  return <section className="panel browser-audio-panel" aria-label="Development microphone diagnostics">
    <div className="panel-heading"><div><span className="eyebrow">DEVELOPMENT AUDIO CHECK</span><h2>Local microphone timing</h2></div><span className="input-mode"><Mic2 size={14} /> {state.replaceAll("_", " ")}</span></div>
    <p>Optional microphone check. Audio is processed transiently and sent to the local development sink, then discarded. Typed responses still drive the mock session. Use headphones when possible.</p>
    <label className="consent-check"><input type="checkbox" checked={confirmed} disabled={active || disabled} onChange={(event) => setConfirmed(event.target.checked)} /><span>I consent to microphone capture for this check. No audio recording is retained.</span></label>
    <div className="audio-controls">
      <button className="button button-outline button-small" disabled={!confirmed || active || disabled} onClick={onPrepare}><Mic2 size={14} /> Prepare microphone</button>
      <button className="button button-outline button-small" disabled={state !== "LISTENING" || diagnostics?.callerPlayed || disabled} onClick={onPlay}>Play mock caller cue (3s)</button>
      <button className="button button-outline button-small" disabled={!listening} onClick={onFinish}>Finish check</button>
      <button className="button button-danger-soft button-small" disabled={!active} onClick={onStop}><Square size={12} /> Stop mic now</button>
    </div>
    <div role="status" aria-live="polite">{completed ? "Microphone check complete." : state === "FINISHING" ? "Finishing microphone check." : state === "CALIBRATING" ? "Remain quiet for ambient calibration; caller playback is disabled." : diagnostics?.callerPlaying ? "Mock cue is playing. It contains no caller dialogue." : state === "LISTENING" ? "Listening for local audio activity." : state === "SPEECH_ACTIVE" ? "Local speech activity detected." : "Microphone check is inactive."}</div>
    {completed && <p>Microphone stopped. Produced frames: {diagnostics!.frameCount} · Backend received frames: {summary!.frameCount} · Backend received bytes: {summary!.receivedBytes}. Expand Technical audio facts to review the final measurements.</p>}
    {diagnostics?.error && <p role="alert">{diagnostics.error.message}</p>}
    <div className="audio-meter"><Activity size={14} /><label htmlFor="mic-level">Microphone activity</label><meter id="mic-level" min={0} max={1} value={Math.min(1, diagnostics?.level ?? 0)} /></div>
    <details className="fixture-details"><summary>Technical audio facts</summary><dl className="audio-diagnostics">
      {import.meta.env?.DEV && <>
        <dt>Last successful pipeline stage</dt><dd>{diagnostics?.pipeline?.lastSuccessfulStage ?? "Not started"}</dd>
        <dt>Failure stage / code</dt><dd>{diagnostics?.failure ? `${diagnostics.failure.category} · ${diagnostics.failure.stage} · ${diagnostics.failure.code}` : "None"}</dd>
        {diagnostics?.failure && <><dt>Sanitized diagnostic</dt><dd><pre>{JSON.stringify(diagnostics.failure, null, 2)}</pre></dd></>}
      </>}
      <dt>Source / target rate</dt><dd>{diagnostics?.sourceRate ?? "Unavailable"} / 16000 Hz</dd>
      <dt>Requested constraints</dt><dd>Mono; echo cancellation, noise suppression and automatic gain control</dd>
      <dt>Reported track settings</dt><dd>{JSON.stringify(diagnostics?.settings ?? {})}</dd>
      <dt>Echo cancellation</dt><dd>Requested: yes; reported applied: {diagnostics?.settings.echoCancellation === undefined ? "unknown" : String(diagnostics.settings.echoCancellation)}; bleed validation: UNKNOWN</dd>
      <dt>VAD / noise floor</dt><dd>{diagnostics?.vadState ?? "idle"} / {diagnostics?.noiseFloor.toFixed(4) ?? "—"}</dd>
      <dt>Speech on / off thresholds</dt><dd>{diagnostics?.speechOn.toFixed(4) ?? "—"} / {diagnostics?.speechOff.toFixed(4) ?? "—"}</dd>
      <dt>Local speech start / end</dt><dd>{ms(diagnostics?.latestStartMs)} / {ms(diagnostics?.latestEndMs)}</dd>
      <dt>Confirmed speech segments</dt><dd>{diagnostics?.segmentCount ?? 0}</dd>
      <dt>PCM format</dt><dd>Raw mono PCM16LE · 16000 Hz · 1024 bytes/frame</dd>
      <dt>Produced / backend received frames</dt><dd>{diagnostics?.frameCount ?? 0} / {summary?.frameCount ?? "Finish check to inspect"}</dd>
      <dt>Backend received bytes</dt><dd>{summary?.receivedBytes ?? "Unavailable"}</dd>
      <dt>Queued / backpressured frames</dt><dd>{diagnostics?.queuedFrames ?? 0} / {diagnostics?.backpressuredFrames ?? 0}</dd>
      <dt>Final zero padding</dt><dd>{diagnostics?.paddedSamples ?? 0} samples</dd>
      <dt>Response latency / pre-speech silence</dt><dd>{ms(latest?.responseLatencyMs)} / {ms(latest?.preSpeechSilenceMs)}</dd>
      <dt>Local speech duration</dt><dd>{ms(latest?.speechDurationMs)}</dd>
      <dt>Overlap candidate</dt><dd>{latest?.overlapCandidate == null ? "Unavailable" : String(latest.overlapCandidate)}</dd>
      <dt>Interruption reporting</dt><dd>Unavailable · speaker-bleed QA has not passed</dd>
      <dt>Timing validity</dt><dd>{diagnostics?.timingValid === false ? "Unavailable" : "Local browser clock only"}</dd>
    </dl></details>
  </section>;
}
