import { useEffect, useRef, useState } from "react";
import type { SafeSession } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { acquireBrowserMicrophone } from "./browserCapture.js";
import { BrowserAudioController, type AudioDiagnostics } from "./controller.js";

export function useBrowserAudio(session: SafeSession | null, api: ApiClient, enabled: boolean) {
  const current = useRef(session); current.current = session;
  const controller = useRef<BrowserAudioController | null>(null);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostics | null>(null);
  const sessionId = session?.sessionId, turnNumber = session?.turnNumber;
  useEffect(() => {
    if (!enabled || !sessionId || turnNumber === undefined) return;
    let mounted = true;
    const audio = new BrowserAudioController({
      sessionId, turnNumber: turnNumber + 1,
      eligible: () => Boolean(current.current?.sessionId === sessionId && current.current.turnNumber === turnNumber
        && current.current.consent.status === "granted" && current.current.recordingEnabled
        && !current.current.terminalState && ["READY", "LISTENING", "FALLBACK"].includes(current.current.state)),
      acquire: acquireBrowserMicrophone, forwarder: (onError) => api.createAudioForwarder(sessionId, onError),
      developmentDiagnostics: import.meta.env.DEV,
      onDiagnostic: (diagnostic) => { if (import.meta.env.DEV) console.info("[BROWSER_AUDIO_DIAGNOSTIC]", diagnostic); },
      onChange: (snapshot) => { if (mounted) setDiagnostics(snapshot); },
    });
    controller.current = audio; audio.requirePermission();
    return () => { mounted = false; audio.stop(); controller.current = null; };
  }, [api, enabled, sessionId, turnNumber]);
  useEffect(() => {
    if (session?.consent.status !== "granted" || !session.recordingEnabled || session.terminalState) controller.current?.stop();
  }, [session?.consent.status, session?.recordingEnabled, session?.terminalState]);
  return { diagnostics, prepare: () => controller.current?.prepare(), stop: () => controller.current?.stop(),
    finish: () => controller.current?.finish(), playMockCaller: () => controller.current?.playMockCaller() };
}
