# Prisma realtime STT contract

This document records the design facts supplied for Phase 2A; it is a contract for a later backend adapter, not evidence of a live integration. The documented realtime endpoint is `wss://api.vachana.ai/stt/v3/stream`. Authentication and configuration use WebSocket upgrade headers. Any provider credentials stay server-side. The product path uses a raw backend-proxied WebSocket, not the Python SDK. No request is made by this repository today.

## Audio and pacing

Streaming payloads are raw mono signed 16-bit little-endian PCM (`PCM_S16LE`), without WAV/MP3 containers. Supported sample-rate configuration is 8,000, 16,000, 44,100, or 48,000 Hz. Every binary frame is exactly 1,024 bytes (512 samples), sent at real-time cadence. A 16 kHz frame spans 32 ms; an 8 kHz frame spans 64 ms. `PcmFrameSchema` rejects shorter or longer chunks. The backend contract configures sample rate and language, paces frames from a local monotonic clock, and models connect/connected, processing, transcript, error, unknown-event handling, and graceful close.

## Normalized events and timing

The documented processing event's timestamp marks speech-end detection. A transcript event can carry timestamp, text, `audio_duration_ms`, `segment_id`, `segment_index`, and `latency`. The adapter normalizes those values but keeps provider timestamps as references; local VAD and the session-local monotonic clock remain the latency and interruption timeline.

No design depends on word-level timestamps or per-word confidence. Compliance timing is therefore segment-level and approximate. Local VAD supplies speech start/end and segment boundaries; raw server ISO timestamps are not mixed into local latency calculations.

## Unverified options and integration gates

The audio config can record a provider-specific minimum-segment-duration capability with `verificationStatus`. Until the participant API confirms it, that setting is unverified metadata only; do not send or depend on an `x-min-segment-ms` header. Do not rely on `x-partials` or `/stt/v4/stream` unless later verified against actual documentation and behavior.

The live path also requires consent, no audio retention by default, headset/strong browser echo cancellation, and speaker-bleed QA before claiming reliable barge-in detection. The credit guard must approve before any billable STT call. For caller output, approved response-reference resolution and credit preflight precede cache/TTS resolution; a provider call cannot precede its credit check. A cache hit avoids synthesis. No provider credentials or learner transcript are sent to the browser.
