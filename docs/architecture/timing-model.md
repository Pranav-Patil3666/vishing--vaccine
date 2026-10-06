# Timing model

## Master reference

`TimingInstant.monotonicMs` is always a value normalized onto the session-local monotonic timeline. `TimingSource` says where an observation originated: `LOCAL_MONOTONIC_CLOCK`, `LOCAL_VAD`, `CLIENT_AUDIO_CLOCK`, `PROVIDER_TIMESTAMP`, `PROVIDER_SEGMENT`, `DERIVED`, or `UNKNOWN`. Independent wall-clock values are not subtracted. Client clock values must be mapped onto the local reference before use.

Caller playback start/end, learner speech start/end, interruption, and local VAD events use this reference. Prisma ISO timestamps are retained only as provider cross-check data. Provider segment indexes identify boundaries; no required behavior depends on word-level timestamps or per-word confidence.

## Derivations

- **Response latency:** caller playback end → learner local speech start. Equal instants are 0 ms. A missing start/end produces no value. A negative interval is treated as invalid/overlapping evidence and omitted rather than clamped into a misleading latency.
- **Hesitation:** measured pre-speech silence plus fixed-vocabulary filler counts. These are observable signals, not emotion labels.
- **Speech rate:** approximate recognized-word count from transcript text divided by measured learner speech duration in minutes. No timing means no rate.
- **Session baseline:** the mean of the first three valid rates; it stays fixed. Fewer than three samples yields `insufficient_data`. Delta is `(current - baseline) / baseline * 100` only when both values are valid.
- **Interruption:** learner speech start falls within confirmed caller playback. Uncertain playback timing yields `unknown`; speaker bleed must be tested before reliability is claimed.
- **Compliance moment:** first synthetic dummy-secret disclosure is segment-level: segment index, local start/end, source, and `precision: segment`. No finer position is available. Any display or debrief says “approx.” or equivalent.

`timing.ts` provides deterministic derivation helpers. The current text mock has no local VAD or playback clock and must not imply those measurements exist.
