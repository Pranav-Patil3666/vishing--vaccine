# Phase 4B physical microphone failure: diagnostic follow-up

Date: 2026-10-11. Status: **TRANSPORT_OPEN fetch receiver defect reproduced in Chromium and fixed; physical microphone retest PENDING**. Phase 4C has not started.

## Confirmed transport root cause and minimal fix

The user's expanded diagnostic identified `TRANSPORT_OPEN`, category `AUDIO_TRANSPORT_FAILED`, code `PCM_PIPELINE_FAILED`, exception name `TypeError`. All five acquisition/construction milestones were present; transport, graph, processor, VAD, resampler and PCM flags were false. The strict sanitizer had withheld the exception message.

`DevelopmentAudioForwarder` stored the native browser `fetch` function on the instance and invoked it as `this.fetcher(...)`. That call supplied the forwarder object as the receiver. Chromium rejected it with `TypeError: Illegal invocation` before issuing the start request. This explains the immediate stop with valid microphone settings and zero PCM/VAD activity. The same invocation also existed on cancellation. The normal session API used a standalone function call, so session creation/consent could still work.

Verified directly through a temporary local browser diagnostic page, without microphone/provider access:

```text
Before fix:
  native fetch as holder.fetcher('/health'): TypeError / Illegal invocation
  same native fetch as a standalone call: HTTP 200
  actual audio forwarder: TRANSPORT_OPEN / TypeError / message withheld
After fix (actual browser forwarder and local backend):
  start: accepted
  receivedFrames: 1
  receivedBytes: 1024
  cancel: called
  sessionEnded: true
```

The constructor now wraps the injected function with `(input, init) => fetcher(input, init)`, preserving a standalone invocation for start/frame/finish/cancel. No DSP, backend or provider change was needed. `Illegal invocation` is now an exact allowlisted diagnostic message, so it will not be hidden if this error occurs elsewhere. A receiver-sensitive regression test failed before the fix and passed after it, covering all four request actions. Node's native fetch and the earlier arrow-function mocks accepted the wrong receiver, which is why the existing transport tests missed this browser-only failure.

Browser evidence: [sanitized receiver comparison and successful transport](browser-audio-fetch-receiver.png). The temporary HTML reproduction page was removed after use; both agent-created mock sessions were ended. One synthetic all-zero frame was sent to the local sink and discarded. No physical microphone capture or provider calls occurred. This proves transport behavior, not completion of physical microphone QA.

## Reported observation

The user tested Windows + Chromium. Permission denial worked. With permission granted, the input opened at 48000 Hz, mono, with echo cancellation, noise suppression and automatic gain control reported true. The worklet module returned HTTP 200. The UI then displayed the generic PCM processing/forwarding error, with idle VAD, zero thresholds, zero produced/queued/backpressured frames and no uncaught console exception.

These are user-reported hardware observations, not physical QA performed by the agent. The initial report alone did not establish an exception or exact stage. The later expanded diagnostic and Chromium reproduction above established the transport receiver defect. The controller opens the transport window **before** it initializes VAD and starts the audio graph.

## Inspection and reproduction

Inspected capture driver, standalone worklet, controller, resampler/PCM assembler, VAD, forwarder, hook, panel, ingress, error mapping and Vite proxy configuration.

The actual startup order is microphone acquisition → AudioContext → module load → MediaStream source → worklet node → zero-gain sink → controller READY → local clock identity → transport construction/open → resampler/VAD/assembler initialization → AudioContext resume → source/worklet/silent-sink graph connection. Native-rate blocks reach VAD during calibration; resampling and PCM forwarding begin after calibration. Local monotonic timing remains authoritative.

Read the actual Vite-transformed driver and worklet responses. The module was standalone executable AudioWorkletGlobalScope code, with matching `local-audio-capture` registration/construction, no browser-window imports, strong node references, bounded transferable blocks and `true` while capture is live (including empty input). `false` is used after explicit stop/flush or backpressure. The graph remains source → worklet → gain(0) → destination. No microphone feedback is introduced. See [processor lifecycle and input layout](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) and [processor error reporting](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/processorerror_event).

A temporary mock session against the already-running local Vite/API services received create=201, consent=200 and audio/start=200. Its forwarding window was cancelled and session ended (200). No microphone or provider call was made. This establishes that this startup request could succeed at inspection time; it does not reconstruct the failed browser attempt.

The automated 48 kHz test executes the real worklet source, transfers/detaches buffers via structuredClone, and drives the actual capture driver/controller through quiet calibration, VAD, 48000→16000 resampling and 1024-byte PCM output. It uses browser API doubles and does not establish hardware/browser scheduling success.

## Minimal diagnostic changes

- Typed failure stage/category, existing error code, sanitized exception name/message, pre-cleanup context state/rate, last successful stage and the requested pipeline milestone flags.
- Development-only hook enables bounded first-occurrence recording and one `[BROWSER_AUDIO_DIAGNOSTIC]` console report per failed attempt. Production does not enable or render diagnostic reports. The learner-facing error text stays generic.
- Strict exception-message allowlist. Unrecognized text is withheld; raw exceptions, stack traces, server response bodies, device IDs, session/window tokens and audio data are never serialized into a diagnostic. Error names remain when recognized. The earliest typed error detail survives wrapping.
- Worklet emits one diagnostic `PROCESSOR_ACTIVE` marker when enabled. Sample payloads and transfer layout remain unchanged. Invalid messages have a specific WORKLET_MESSAGE diagnostic; control markers are handled separately from audio blocks. ACK is skipped once capture has stopped, so cleanup cannot be followed by an ACK on the closed port.
- Transport open/frame/finish errors retain separate stages. Non-success responses report only HTTP status. No backend ingress, provider, resampling, VAD threshold, target rate, frame size or timing-policy changes were made.

The initial diagnostic pass fixed the observability defect: catch blocks discarded the error and displayed the same message for startup, DSP and transport failures. The subsequent expanded user diagnostic enabled the specific Chromium transport reproduction and receiver fix documented above. Physical end-to-end microphone operation still requires user retest.

## Why the earlier tests missed this

The earlier controller tests replaced the capture connection with a fake; worklet unit tests used a VM port without real transfer detachment. The Vite test checked HTTP 200 and source text, not execution of the served module. None exercised a physical browser microphone. Those tests were insufficient to locate the reported failure, and passing them was never physical QA evidence.

New regression coverage exercises the actual driver plus transferable worklet at 48 kHz, injected module/source/node/resume/graph exceptions, malformed messages, HTTP startup rejection before any PCM, strict redaction, report-once behavior and disabled production diagnostics. The existing Vite test now executes the served module in a constrained worklet-like scope. The additional receiver-sensitive regression reproduces the identified browser transport defect. Hardware capture and browser audio scheduling remain outside these automated tests.

## Expected successful milestones

`MIC_ACQUIRED` → `AUDIO_CONTEXT_CREATED` → `WORKLET_MODULE_LOADED` → `SOURCE_NODE_CREATED` → `WORKLET_NODE_CREATED` → `TRANSPORT_READY` → `AUDIO_GRAPH_CONNECTED` → `PROCESSOR_ACTIVE` → `FIRST_AUDIO_BLOCK_RECEIVED` → `VAD_ACTIVE` → (after calibration) `RESAMPLER_ACTIVE` → `FIRST_PCM_FRAME` → `FIRST_FRAME_FORWARDED`.

The ordering reflects the current implementation. Source construction precedes worklet construction, transport opens before graph start, and VAD consumes native blocks before resampling. An HTTP frame acknowledgement establishes FIRST_FRAME_FORWARDED. Stages are recorded only once; there are no per-block logs or new timing timestamps.

## Exact user retest

1. If necessary restart API and web in separate terminals at the repository root with `npm run dev:api` and `npm run dev:web`. Do not start duplicates if the existing watchers have already loaded these changes.
2. Reload the development browser page. Open DevTools Console and keep the Network panel available.
3. Start a new mock session and grant simulation consent.
4. In Development audio check, select the separate microphone consent checkbox and click **Prepare microphone**.
5. Allow browser microphone permission.
6. Remain quiet for calibration (approximately one second); do not play the mock cue yet.
7. Expand **Technical audio facts**. Check that VAD leaves idle/calibrating, noise-floor/threshold values populate and Source / target rate shows 48000 / 16000 Hz on this device.
8. Speak a short sentence, then pause.
9. Check Produced frames > 0 and local speech activity/segment count. Optional caller-cue tests can follow once basic capture works.
10. Click **Finish check**. Confirm the microphone stops and the summary appears.
11. Confirm backend received frames > 0 and matches produced frames after finish. In Network, start/frame/finish should succeed. If failure recurs, share only the single `[BROWSER_AUDIO_DIAGNOSTIC]` object or the **Sanitized diagnostic** panel text; do not share raw request headers, audio bodies, environment files or credentials.

Physical microphone QA remains **PENDING / previously failed** until the user reports a successful retest. Headset/speaker bleed validation and interruption reporting remain unavailable.

## Files changed in this follow-up

- Created `apps/web/src/audio/diagnostics.ts`, `diagnostics.test.ts`, `browserCapture.test.ts`, this evidence note and `docs/evidence/browser-audio-fetch-receiver.png`.
- Updated `apps/web/src/audio/browserCapture.ts`, `capture.worklet.js`, `controller.ts`, `errors.ts`, `transport.ts`, `transport.test.ts`, `useBrowserAudio.ts`, `privacy.test.ts`, `worklet.test.ts`, `apps/web/src/components/BrowserAudioPanel.tsx`, root `package.json` (two test-file entries only) and `docs/evidence/evidence-ledger.md`.
- Changes specifically following the expanded diagnostic: `transport.ts`, `transport.test.ts`, `diagnostics.ts`, `diagnostics.test.ts`, this note, the evidence ledger and screenshot. Other listed files belong to the preceding instrumentation pass.

Existing Phase 4B work was already uncommitted before this follow-up and is preserved. No dependency or environment-file changes.

## Validation

Initial diagnostic suite: **211/211 tests**. Receiver regression: failed before fix, passed after fix. Final canonical **`npm run check` passed, 212/212 tests, zero failures**. Typecheck, lint, scenario validation, API/web builds and secret scan passed. `git diff --check` passed. Production contains neither the diagnostic log prefix nor diagnostic panel labels. Root `.env` remains gitignored and unchanged. Full check log: `C:\Users\Pranav\AppData\Local\Temp\vishing-audio-fetch-fix-check.log`.
