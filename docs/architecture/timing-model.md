# Timing model

## Master reference

`TimingInstant.monotonicMs` is always a value normalized onto the session-local monotonic timeline. `TimingSource` says where an observation originated: `LOCAL_MONOTONIC_CLOCK`, `LOCAL_VAD`, `CLIENT_AUDIO_CLOCK`, `PROVIDER_TIMESTAMP`, `PROVIDER_SEGMENT`, `DERIVED`, or `UNKNOWN`. Independent wall-clock values are not subtracted. Client clock values must be mapped onto the local reference before use.

Caller playback start/end, learner speech start/end, interruption, and local VAD events use this reference. Prisma ISO timestamps are retained only as provider cross-check data. Provider segment indexes identify boundaries; no required behavior depends on word-level timestamps or per-word confidence.

## Derivations

- **Response latency:** caller playback end → learner local speech start. Equal instants are 0 ms. A missing start/end produces no value. A negative interval is treated as invalid/overlapping evidence and omitted rather than clamped into a misleading latency.
- **Hesitation:** measured pre-speech silence plus fixed-vocabulary filler counts. The initial English/Hindi/Hinglish dictionary is configurable and incomplete. These are observable signals, not emotion labels.
- **Speech rate:** approximate recognized-word count from transcript text divided by measured learner speech duration in minutes. No timing means no rate.
- **Session baseline:** the first valid turn with at least five normalized transcript words and a positive measured duration establishes the session-local baseline. It stays fixed. A later valid rate is compared with it; an invalid or short turn leaves the baseline unchanged. Without a baseline, status is `insufficient_data` and delta is null.
- **Interruption:** learner speech starts after caller playback begins and before its measured end, with playback confirmed active at speech start. The offset is learner speech start minus caller playback start. Uncertain timing yields `unknown`; speaker bleed must be tested before reliability is claimed.
- **Compliance moment:** first synthetic dummy-secret disclosure is segment-level: segment index, local start/end, source, and `precision: segment`. No finer position is available. Any display or debrief says “approx.” or equivalent.

`AudioTimingClock` is the backend boundary for local timing; `DeterministicAudioTimingClock` accepts validated development/test fixtures and labels them `LOCAL_VAD`. Without a fixture, the text mock has no local VAD or playback clock and keeps latency, speech duration, rate, and interruption timing unavailable. API stage durations use `performance.now()` and ISO timestamps separately; neither is used as learner response latency.
