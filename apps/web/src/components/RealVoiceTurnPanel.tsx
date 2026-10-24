import { useEffect, useRef, useState, type RefObject } from "react";
import type { CallerAudioAsset, RealVoiceStatus, RealVoiceTurnResult, SafeSession } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { useBrowserAudio } from "../audio/useBrowserAudio.js";
import { createCallerPlayback, type CallerPlayback } from "../audio/callerPlayback.js";

export function RealVoiceTurnPanel({ session, api, onResult, stopControl }: {
  session: SafeSession; api: ApiClient; onResult: (result: RealVoiceTurnResult) => void;
  stopControl?: RefObject<(() => void) | null>;
}) {
  const [status, setStatus] = useState<RealVoiceStatus | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RealVoiceTurnResult | null>(null);
  const [callerAvailable, setCallerAvailable] = useState(false);
  const [realCaller, setRealCaller] = useState(false);
  const [nextAudioState, setNextAudioState] = useState("NOT PLAYED");
  const [nextAsset, setNextAsset] = useState<CallerAudioAsset | null>(null);
  const [nextDuration, setNextDuration] = useState<number | null>(null);
  const nextPlayback = useRef<CallerPlayback | null>(null), nextAbort = useRef<AbortController | null>(null);
  const nextUsed = useRef(false);
  const stopNext = () => { nextUsed.current = true; nextAbort.current?.abort(); nextPlayback.current?.stop(); nextPlayback.current = null; };
  useEffect(() => {
    let mounted = true;
    void api.getCallerAudioStatus?.(session.sessionId).then((value) => { if (mounted) setCallerAvailable(value.available); }).catch(() => {});
    void api.getRealVoiceStatus?.(session.sessionId).then((next) => { if (mounted) setStatus(next); }).catch(() => {
      if (mounted) setStatus({ available: false, reason: "DISABLED", openingText: null, language: "hi-IN", playback: "mock_cue_only" });
    });
    return () => { mounted = false; nextAbort.current?.abort(); nextPlayback.current?.stop(); };
  }, [api, session.sessionId]);
  const audio = useBrowserAudio(session, api, Boolean(status?.available && api.createRealAudioForwarder), {
    realTurn: true, realCaller, onResult: (next) => { setResult(next); onResult(next); },
  });
  useEffect(() => {
    if (stopControl) stopControl.current = () => { audio.stop(); stopNext(); };
    return () => { if (stopControl) stopControl.current = null; };
  }, [audio.stop, stopControl]);
  const state = audio.diagnostics?.state ?? "IDLE";
  const active = ["REQUESTING_PERMISSION", "READY", "CALIBRATING", "LISTENING", "SPEECH_ACTIVE", "FINISHING", "STOPPING"].includes(state);
  const unavailable = !status?.available || session.turnNumber !== 0 || session.consent.status !== "granted" || Boolean(session.terminalState);
  async function playSelected() {
    if (nextUsed.current || !result || !api.getCallerAudio) return;
    nextUsed.current = true; const abort = new AbortController(); nextAbort.current = abort; setNextAudioState("LOADING");
    try {
      const { asset, blob } = await api.getCallerAudio(session.sessionId, result.turn.session.turnNumber, result.turn.branch.responseId, abort.signal);
      if (abort.signal.aborted) return;
      setNextAsset(asset); const playback = createCallerPlayback(asset, blob, abort.signal); nextPlayback.current = playback;
      const origin = performance.now(); let start: number | null = null;
      playback.play(() => { start = performance.now() - origin; setNextAudioState("PLAYING"); }, () => {
        if (!abort.signal.aborted && start !== null) { setNextDuration(performance.now() - origin - start); setNextAudioState("ENDED"); }
      }, () => setNextAudioState("CALLER_AUDIO_FAILED"));
    } catch { if (!abort.signal.aborted) setNextAudioState("CALLER_AUDIO_FAILED"); }
  }
  return <section className="panel browser-audio-panel" aria-label="Real Prisma learner turn">
    <div className="panel-heading"><div><span className="eyebrow">{realCaller ? "REAL STT · REAL CALLER AUDIO" : "REAL STT · MOCK CALLER CUE"} · ONE LEARNER TURN · HI-IN</span><h2>Voice response</h2></div><span className="input-mode">{state.replaceAll("_", " ")}</span></div>
    <p>Microphone audio streams transiently to Prisma. {realCaller ? "The approved caller opening uses backend Timbre/cache audio. Playback end is measured locally. AI-generated voice · SIMULATION." : "The caller uses the existing mock tone cue; spoken caller audio is not connected."}</p>
    <label className="consent-check"><input type="checkbox" checked={realCaller} disabled={!callerAvailable || active || unavailable} onChange={(event) => setRealCaller(event.target.checked)} /><span>Use real caller audio (Timbre/cache){!callerAvailable ? " — unavailable on this server" : ""}</span></label>
    {status?.openingText && <p><strong>Approved caller opening (text):</strong> {status.openingText}</p>}
    {status && !status.available && <p role="status">{status.reason === "CONTENT_UNAVAILABLE" ? "Real STT is blocked: approved S-01 Hindi/Hinglish runtime content is required." : "Real STT is unavailable for this session or server configuration."}</p>}
    <label className="consent-check"><input type="checkbox" checked={confirmed} disabled={active || unavailable} onChange={(event) => setConfirmed(event.target.checked)} /><span>I consent to transient microphone audio being sent to Prisma for this simulation. No raw audio is retained by this application.</span></label>
    <div className="audio-controls">
      <button className="button button-outline button-small" disabled={!confirmed || unavailable || active} onClick={() => { void audio.prepare(); }}>Start real voice turn</button>
      <button className="button button-outline button-small" disabled={!["LISTENING", "SPEECH_ACTIVE"].includes(state)} onClick={() => { void audio.finish(); }}>Finish real turn</button>
      <button className="button button-danger-soft button-small" disabled={!active} onClick={audio.stop}>Stop real microphone now</button>
    </div>
    <div role="status" aria-live="polite">{result ? "Real learner turn complete. One event added to the pressure timeline."
      : state === "CALIBRATING" ? `Remain quiet for calibration; ${realCaller ? "the approved caller audio" : "the mock caller cue"} will play next.`
        : audio.diagnostics?.callerPlaying ? `${realCaller ? "Approved caller audio" : "Mock caller cue"} playing. Wait for its end, then respond.`
          : state === "FINISHING" ? "Microphone stopped. Waiting for transcription and the approved policy response."
            : state === "SPEECH_ACTIVE" ? "Local speech detected; this turn will finish after local VAD completion."
              : state === "LISTENING" ? "Respond now. Local browser timing is authoritative." : "Real voice turn is inactive."}</div>
    {audio.diagnostics?.error && <p role="alert">{audio.diagnostics.error.code === "CALLER_AUDIO_FAILED" ? "CALLER_AUDIO_FAILED: caller audio could not load, decode or play; no normal playback end was recorded." : "Speech transcription could not complete."} The turn was not advanced.</p>}
    {result && <RealVoiceTurnDetails result={result} />}
    {realCaller && result && <div><p>Approved next response audio: {nextAudioState}. This does not start another learner turn.</p>
      <button className="button button-outline button-small" disabled={nextUsed.current || !callerAvailable} onClick={() => { void playSelected(); }}>Play approved next line</button>
      <button className="button button-outline button-small" onClick={() => { stopNext(); setNextAudioState("STOPPED"); }}>Stop caller playback</button>
      {nextAsset && <p>Next response: {nextAsset.responseId} · {nextAsset.cacheHit ? "TTS CACHE" : "TIMBRE LIVE"} · {nextAsset.voice} · Browser playback: {nextDuration === null ? "Unavailable" : `${Math.round(nextDuration)} ms`}</p>}</div>}
    <details className="fixture-details"><summary>Real turn technical facts</summary>
      <p>Source / target: {audio.diagnostics?.sourceRate ?? "Unavailable"} / 16000 Hz · PCM16LE mono · 1024 bytes/frame</p>
      <p>Produced frames: {audio.diagnostics?.frameCount ?? 0} · Backend received frames: {result?.audioSummary.frameCount ?? "Unavailable"}</p>
      <p>Timing: local browser clock. Provider timestamps are reference metadata only. Interruption reporting remains unavailable.</p>
      {audio.diagnostics?.callerAsset && <div>
        <p>Response: {audio.diagnostics.callerAsset.responseId} · {audio.diagnostics.callerAsset.cacheHit ? "TTS CACHE" : "TIMBRE LIVE"} · {audio.diagnostics.callerAsset.model} / {audio.diagnostics.callerAsset.voice} / {audio.diagnostics.callerAsset.language}</p>
        <p>Caller source: {audio.diagnostics.callerAsset.mediaType} · {audio.diagnostics.callerAsset.byteLength} bytes · {audio.diagnostics.callerAsset.sampleRateHz} Hz · Provider attempts for asset: {audio.diagnostics.callerAsset.providerAttempts}</p>
        <p>Synthesis: {audio.diagnostics.callerAsset.synthesisMs ?? "Cache; no provider call"} · Cache lookup: {Math.round(audio.diagnostics.callerAsset.cacheLookupMs)} ms · Source duration: {audio.diagnostics.callerAsset.durationMs} ms</p>
        <p>Local clock: {audio.diagnostics.audioClockId} · Playback start: {audio.diagnostics.callerStartMs ?? "Unavailable"} ms · End: {audio.diagnostics.callerEndMs ?? "Unavailable"} ms · Duration: {audio.diagnostics.callerPlaybackDurationMs ?? "Unavailable"} ms</p>
      </div>}
      {audio.diagnostics?.failure && <p>Sanitized failure: {audio.diagnostics.failure.stage} · {audio.diagnostics.failure.code}</p>}
    </details>
  </section>;
}

export function RealVoiceTurnDetails({ result }: { result: RealVoiceTurnResult }) {
  const event = result.turn.learnerTurnEvent;
  const ms = (value?: number | null) => value == null ? "Unavailable" : `${Math.round(value)} ms`;
  return <div className="turn-detail-grid" aria-label="Real turn result">
    <span>Transcript · Prisma <strong>{result.turn.transcript.text}</strong></span>
    <span>Behavior · deterministic classifier <strong>{event.behavior.label}</strong></span>
    <span>Tactic · existing policy <strong>{result.turn.branch.id ?? "Terminal / safe response"}</strong></span>
    <span>Next pressure · policy metadata <strong>{result.turn.branch.nextPressureLevel}</strong></span>
    <span>Approved response ID <strong>{result.turn.branch.responseId}</strong></span>
    <span>{result.callerAudio?.available ? "Approved next line · audio available" : "Approved next line · text only"} <strong>{result.approvedResponseText}</strong></span>
    <span>Local response latency <strong>{ms(event.responseLatency?.valueMs)}</strong></span>
    <span>Local speech duration <strong>{ms(event.speechDuration?.valueMs)}</strong></span>
    <span>Overlap candidate <strong>{result.audioSummary.observations[0]?.overlapCandidate == null ? "Unavailable" : String(result.audioSummary.observations[0].overlapCandidate)}</strong></span>
    <span>Provider segments <strong>{result.segments.length}</strong></span>
    <span>Provider connection / first transcript · service clock <strong>{ms(result.service.connectionMs)} / {ms(result.service.firstTranscriptMs)}</strong></span>
    <details><summary>Provider segment reference metadata</summary>{result.segments.map((segment, index) => <p key={index}>
      Segment index: {segment.segmentIndex ?? "Unavailable"} · Reference timestamp: {segment.providerTimestamp ?? "Unavailable"} · Provider duration: {ms(segment.providerAudioDurationMs)} · Provider latency: {ms(segment.providerLatencyMs)}
    </p>)}</details>
  </div>;
}
