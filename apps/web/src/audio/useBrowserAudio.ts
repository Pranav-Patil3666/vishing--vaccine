import { useEffect, useRef, useState } from "react";
import { REAL_TURN_LIMITS, type SafeSession, type RealVoiceTurnResult } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { acquireBrowserMicrophone } from "./browserCapture.js";
import { BrowserAudioController, type AudioDiagnostics } from "./controller.js";
import { createCallerPlayback } from "./callerPlayback.js";

export function useBrowserAudio(session: SafeSession | null, api: ApiClient, enabled: boolean,
  options?: { realTurn: true; realCaller?: boolean; onResult: (result: RealVoiceTurnResult) => void }) {
  const current = useRef(session); current.current = session;
  const controller = useRef<BrowserAudioController | null>(null);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostics | null>(null);
  const sessionId = session?.sessionId, turnNumber = session?.turnNumber;
  const realTurn = options?.realTurn === true;
  const realCaller = options?.realCaller === true;
  const onResult = useRef(options?.onResult); onResult.current = options?.onResult;
  useEffect(() => {
    if (!enabled || !sessionId || turnNumber === undefined || (realTurn && turnNumber !== 0)) return;
    let mounted = true;
    let pendingResult: RealVoiceTurnResult | undefined;
    const audio = new BrowserAudioController({
      sessionId, turnNumber: turnNumber + 1,
      eligible: () => Boolean(current.current?.sessionId === sessionId && current.current.turnNumber === turnNumber
        && current.current.consent.status === "granted" && current.current.recordingEnabled
        && !current.current.terminalState && ["READY", "LISTENING", "FALLBACK"].includes(current.current.state)),
      acquire: acquireBrowserMicrophone, forwarder: (onError) => realTurn
        ? api.createRealAudioForwarder!(sessionId, onError, (result) => { pendingResult = result; }) : api.createAudioForwarder(sessionId, onError),
      ...(realTurn ? { autoPlayCaller: true, finishOnSpeechEnd: true, noSpeechTimeoutMs: REAL_TURN_LIMITS.noSpeechMs, maxCaptureMs: REAL_TURN_LIMITS.captureMs } : {}),
      ...(realCaller ? { prepareCaller: async (signal: AbortSignal) => {
        const responseId = current.current?.currentResponseId;
        if (!responseId || !api.getCallerAudio) throw new Error("Approved caller audio unavailable.");
        const { asset, blob } = await api.getCallerAudio(sessionId, turnNumber, responseId, signal);
        return createCallerPlayback(asset, blob, signal);
      } } : {}),
      developmentDiagnostics: import.meta.env.DEV,
      onDiagnostic: (diagnostic) => { if (import.meta.env.DEV) console.info("[BROWSER_AUDIO_DIAGNOSTIC]", diagnostic); },
      onChange: (snapshot) => {
        if (mounted) {
          setDiagnostics(snapshot);
          if (snapshot.state === "COMPLETED" && pendingResult) {
            const result = pendingResult; pendingResult = undefined; onResult.current?.(result);
          }
        }
      },
    });
    controller.current = audio; audio.requirePermission();
    return () => { mounted = false; audio.stop(); controller.current = null; };
  }, [api, enabled, sessionId, turnNumber, realTurn, realCaller]);
  useEffect(() => {
    if (session?.consent.status !== "granted" || !session.recordingEnabled || session.terminalState) controller.current?.stop();
  }, [session?.consent.status, session?.recordingEnabled, session?.terminalState]);
  return { diagnostics, prepare: () => controller.current?.prepare(), stop: () => controller.current?.stop(),
    finish: () => controller.current?.finish(), playMockCaller: () => controller.current?.playMockCaller() };
}
