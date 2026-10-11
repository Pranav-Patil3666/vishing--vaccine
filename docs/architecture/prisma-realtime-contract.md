# Prisma realtime STT contract

Phase4A contract verification is **COMPLETE** under its explicit closure rule. The baseline and reviewed composite establish working backend connection/authentication, 16 kHz PCM/1,024-byte framing, segment events, one short utterance/segmentation/Hinglish case, requested close1000, and one omitted-auth HTTP401 rejection. These are scoped observations, not accuracy or reliability guarantees. See [the capability matrix and execution protocol](../evidence/provider/prisma-realtime-verification.md) for evidence, voice limits and remaining UNVERIFIED capabilities. The shared contract remains the Phase2A local mock design. `MockPrismaRealtimeTransport` and the production recognizer are unchanged; no live runtime adapter is activated.

## Audio and pacing

The mock accepts raw mono signed 16-bit little-endian PCM (`PCM_S16LE`), four candidate rates (8,000/16,000/44,100/48,000 Hz), and exactly 1,024 bytes per frame. Only the16 kHz/1,024-byte path is verified working; these local validation constraints do not prove provider requirements or support for other rates. A 512-sample frame spans32 ms at16 kHz and64 ms at8 kHz. The reported chunk size512 and sent1,024 bytes are consistent with512 PCM16 samples; provider units and a required frame size are not established solely by that arithmetic.

## Isolated verification utility

`scripts/verify-prisma.ts` invokes isolated API provider modules. `npm run verify:prisma` requires explicit live opt-in, endpoint, upgrade header names, server credential selection, provider language code, local synthetic fixture and configured budget. It has no endpoint default or public route, and is absent from normal checks, CI, `/health`, sessions and the browser.

Fixture validation and the existing credit guard precede one connection, with no reconnect/retry. The candidate lifecycle waits for socket open and `connected`, streams binary audio at source cadence without catch-up bursts, sends two seconds of zero PCM, drains three seconds, requests code1000 and requires close within one second. The total deadline is twenty seconds. These are probe choices, not verified start/EOS/flush semantics. The WebSocket library handles transport pong responses. Unknown events fail closed after sanitized diagnostics.

The explicit closure CLI reuses this same transport for reviewed SHORT/SEGMENTATION/HINGLISH fixtures, or one COMBINED fixture that establishes several scoped observations, followed by a single omitted-auth ERROR probe. Total preflight and per-attempt credit checks carry reservations forward locally. The separate negative path keeps normal config validation strict, removes only the outgoing auth header, sends no audio and accepts only an observed rejection category as its test result. All live commands remain opt-in and outside normal validation. Root `.env` settings are preserved.

The separate candidate parser accepts the observed `speech_start` as provider VAD metadata, retaining an optional ISO timestamp only as a reference beside the local monotonic receipt. It never sets learner speech-start timing. Missing timestamp, segment identity/index, duration and latency remain absent; it does not relax the shared mock schema or manufacture a production TranscriptEvent. Malformed JSON, invalid supplied metadata, unknown events, timeouts, failed upgrades, unexpected close and missing transcripts become existing typed `TRANSCRIPTION_FAILED` errors. A live SpeechRecognizer adapter and mapping tests are deferred until actual evidence supports them.

## Normalized events and timing

Processing timestamps have no proven speech-end semantics here. Candidate transcript metadata includes timestamp, duration, segment identity/index and latency, if supplied. Each receipt uses `createSessionMonotonicClock`; provider ISO values remain reference data. Learner latency, hesitation and interruption remain based on future local audio instrumentation. No provider wall-clock subtraction is introduced.

No design depends on word-level timestamps or per-word confidence. Compliance timing is therefore segment-level and approximate. Local VAD supplies speech start/end and segment boundaries; raw server ISO timestamps are not mixed into local latency calculations.

Diagnostics exclude credentials, audio bytes, transcript bodies, arbitrary provider fields and raw error strings. They retain local receipt time, validated reference timestamp, numeric metadata, character/script counts, known field types and a segment fingerprint. The harness reads synthetic audio transiently and writes no audio/transcript files. An optional offline Windows helper creates synthetic test fixtures in OS temp. Production audio retention stays disabled by default.

## Unverified options and integration gates

The audio config can record a provider-specific minimum-segment-duration capability with `verificationStatus`. Until the participant API confirms it, that setting is unverified metadata only; do not send or depend on an `x-min-segment-ms` header. Do not rely on `x-partials` or `/stt/v4/stream` unless later verified against actual documentation and behavior.

Phase4B may now begin local microphone/VAD instrumentation without depending on provider VAD events, partials, word timing or mandatory optional metadata. It is not implemented here. Production live activation still requires consent and no audio retention by default; headset/strong browser echo cancellation and speaker-bleed QA precede reliable barge-in claims. The credit guard must approve before any billable STT call. For caller output, approved response-reference resolution and credit preflight precede cache/TTS resolution; a provider call cannot precede its credit check. A cache hit avoids synthesis. No provider credentials or learner transcript are sent to the browser.
