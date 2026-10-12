# Phase 4B: successful Finish rendering correction

Date: 2026-10-12. Status: implementation validated; physical microphone retest **PENDING**. Phase 4B is not closed. Phase 4C has not started.

## Root cause and inspected flow

The user reports working physical Windows/Chromium capture at 48 kHz, repeated frame HTTP 200 responses, and a Finish HTTP 200 response, followed by “Microphone check is inactive.” The user's response body was not supplied; HTTP 200 alone does not establish that it matched the contract.

For a valid response, the existing implementation already parsed `BrowserAudioSummarySchema` in `DevelopmentAudioForwarder.finish`, assigned `diagnostics.summary`, and copied diagnostics into React through `useBrowserAudio`. Capture teardown happened before awaiting Finish and preserved the final technical facts. Neither teardown nor the hook erased that valid summary.

The defect was success ending in `STOPPED`, the same state used for hard cancellation. `BrowserAudioPanel` rendered the generic inactive message for that state. Backend counts were available only inside the collapsed Technical audio facts disclosure. A regression added before the correction confirmed that summary/count assertions passed while the required `COMPLETED` assertion failed with actual `STOPPED`.

Inspected: transport, controller, hook, panel, error diagnostics, shared contracts, backend ingress and timing summary builder, and their tests. No reducer or separate completed-result contract was needed.

## Minimal correction

The shared capture-state enum now includes `FINISHING` and `COMPLETED`. Successful flow:

1. Enter `FINISHING` immediately; reject duplicate Finish and Prepare calls.
2. Use the existing bounded worklet flush and existing resampler/final-padding behavior. Final VAD callbacks may record facts but cannot replace the finishing status.
3. Snapshot local timing facts, invalidate late capture callbacks, release the microphone/worklet/context/timers/DSP buffers, and clear the transient facts collection. Keep final safe measurements in diagnostics.
4. Wait for the existing bounded forwarding/ack policy and parse the existing Finish response contract.
5. Freeze the technical summary and its observations, release the forwarder reference, and enter `COMPLETED`.
6. Render “Microphone check complete.” and the final local produced count, backend received count and backend received bytes outside the disclosure. Existing detailed facts remain available inside it. Finish and Stop are disabled after completion.

The microphone is released **before** the backend response wait; slow/failing Finish cannot keep it open. Repeated cleanup after completion retains its result and status. Explicit Prepare starts a new check and clears the previous result, counts, boundaries and calibration thresholds. Session unmount can discard the controller as before.

Stop mic now remains an immediate cancellation: it releases capture, discards pending audio under the existing transport policy and uses `STOPPED`, without a completion result. While finishing, emergency Stop remains usable and cancellation wins deterministically; a late response cannot overwrite it with success. HTTP failure, unreadable JSON or a malformed HTTP 200 contract produces `ERROR`, with sanitized diagnostics and safe local measurements retained.

## Sources and contract

Reused `BrowserAudioSummary`: backend `frameCount`, `receivedBytes`, `observations`, `speakerBleedValidation: "UNKNOWN"`, and `interruptionReportingEnabled: false`. Each observation has segment number, nullable response latency/pre-speech silence/speech duration/overlap candidate, and unknown interruption status. No new backend fields were invented.

Local counts, settings, source rate, thresholds, VAD boundaries and timing validity remain in `AudioDiagnostics`. Backend ingress counts remain distinct. Observation timing still comes from the existing canonical backend derivation of browser monotonic facts; no formula or clock authority changed. Null timings display “Unavailable”. The retained result contains technical metadata only, never PCM, buffers, device IDs, microphone labels or credentials. No browser persistence was added.

DSP, VAD thresholds, resampling, frame size, backend ingress, provider logic, consent, timing formulas, fetch receiver handling and the separate Pressure Curve were unchanged.

## Validation

- Focused controller, transport and panel/privacy tests: **32/32 passed**.
- `npm run check`: **226/226 passed**, including typecheck, lint, scenario validation, production build and secret scan. Baseline was 212; 14 tests added. Existing Chromium fetch receiver regression retained.
- Added coverage: successful summary/resource cleanup; cleanup retention and late callbacks; explicit new-check reset; hard cancellation; duplicate Finish/Prepare; cancellation during flush and response wait; non-2xx, invalid JSON and malformed contract; completed/finishing/stopped panel states; final frame acknowledgement before Finish; metadata-only immutable summary.
- Actual React hook was exercised in Chromium by the smoke below; hook production code required no change.

### Chromium smoke: synthetic audio, not physical QA

A temporary local Vite fixture used the actual hook, capture driver, AudioWorklet, controller, panel, native browser fetch and local API. Only `getUserMedia` was replaced in that temporary page with a synthetic 48 kHz MediaStream. A gain-controlled oscillator exercised calibration and one VAD segment. No provider was called and no physical microphone was opened.

The first fixture startup omitted the existing scenario language fallback and was rejected before creating a session; the fixture was corrected. A longer first capture reached 219 produced frames and then reported a sanitized `TRANSPORT_FRAME` TypeError “Failed to fetch”; its cause was not established, and it was not counted as a successful Finish check. The second, bounded capture completed:

| Observed fact | Value |
| --- | --- |
| Terminal state and visible status | `COMPLETED`; Microphone check complete. |
| Local produced / backend received frames | 55 / 55 |
| Backend received bytes | 56,320 |
| Source / target sample rate | 48,000 / 16,000 Hz |
| Final padding | 469 samples |
| Confirmed segments / local speech duration | 1 / approximately 721 ms |
| Response latency, pre-speech silence, overlap | Unavailable; no caller cue played |
| Synthetic track after cleanup | ended |
| Parent React rerender | completion and counts remained visible |
| Finish / Stop after completion | both disabled |

Both agent-created mock sessions were explicitly ended. The synthetic contexts/tracks, temporary tab and agent-started dev servers were closed. Temporary fixture files were removed. Screenshot contains only technical facts: [completed panel](browser-audio-finish-completed.png).

This is one successful synthetic finish/render check, with the earlier failed smoke disclosed above. It establishes neither physical-device compatibility nor speaker-bleed/timing accuracy. User physical retest remains mandatory.

## User retest

1. Start the usual local API/web dev servers and reload the development page.
2. Start a fresh mock session and grant simulation consent.
3. Enable the Development Audio Check microphone consent checkbox.
4. Click Prepare microphone; grant browser permission if requested.
5. Remain quiet through calibration, then speak a short sentence.
6. Confirm frame requests return HTTP 200; click Finish check once and confirm Finish returns HTTP 200.
7. Confirm “Microphone check complete.”, positive produced/backend frame counts, and that the physical mic indicator switches off while the summary stays visible.
8. Expand Technical audio facts and inspect source/target rates, reported settings, counts, padding and available timing. Missing values must remain Unavailable. Finish and Stop should be disabled.

Only after this physical success should remaining Phase 4B manual QA continue. Pressure Curve is not the success indicator for this development check.

PHASE 4B PHYSICAL QA STATUS:
PENDING USER RETEST
