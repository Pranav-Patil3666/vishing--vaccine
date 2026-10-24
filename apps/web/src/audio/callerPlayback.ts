import type { CallerAudioAsset, TechnicalFailure } from "@vaccine/contracts";
import { BrowserAudioError } from "./errors.js";

export interface CallerPlayback { readonly asset: CallerAudioAsset; play(onStart: () => void, onEnd: () => void, onFailure: (failure?: TechnicalFailure) => void): void; stop(): void; }
export interface PlaybackDependencies { makeAudio(): HTMLAudioElement; makeUrl(blob: Blob): string; revokeUrl(url: string): void; }
/** Browser lifecycle observations, never fetch/decode/provider completion as playback timing. */
export function createCallerPlayback(asset: CallerAudioAsset, blob: Blob, signal: AbortSignal,
  dependencies: PlaybackDependencies = { makeAudio: () => new Audio(), makeUrl: (value) => URL.createObjectURL(value), revokeUrl: (url) => URL.revokeObjectURL(url) }): CallerPlayback {
  if (signal.aborted || blob.size !== asset.byteLength || blob.type !== "audio/wav") throw new BrowserAudioError("CALLER_AUDIO_FAILED");
  const audio = dependencies.makeAudio(), url = dependencies.makeUrl(blob);
  audio.preload = "auto"; audio.src = url;
  let stopped = false, used = false, started = false;
  let failure: ((failure?: TechnicalFailure) => void) | undefined;
  const stop = () => {
    if (stopped) return; stopped = true;
    audio.onplaying = null; audio.onended = null; audio.onerror = null; audio.onpause = null;
    audio.pause(); audio.removeAttribute("src"); audio.load(); dependencies.revokeUrl(url); signal.removeEventListener("abort", stop);
  };
  const fail = () => { if (stopped) return; const callback = failure, decode = audio.error?.code === 3 || audio.error?.code === 4; stop(); callback?.({ stage: decode ? "CALLER_AUDIO_DECODE" : "CALLER_PLAYBACK", causeCode: "PLAYBACK_FAILED", providerAttempted: null }); };
  signal.addEventListener("abort", stop, { once: true });
  return { asset, stop, play(onStart, onEnd, onFailure) {
    if (used || stopped) return; used = true; failure = onFailure;
    audio.onplaying = () => { if (!stopped && !started) { started = true; onStart(); } };
    audio.onended = () => { if (stopped) return; if (!started || audio.error) { fail(); return; } stop(); onEnd(); };
    audio.onerror = fail;
    audio.onpause = () => { if (started && !audio.ended) fail(); };
    try { void audio.play().catch(fail); } catch { fail(); }
  } };
}
