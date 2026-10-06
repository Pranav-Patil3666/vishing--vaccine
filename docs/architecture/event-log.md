# Learner event log

`LearnerTurnEvent` is the structured, privacy-conscious source for pressure-curve debriefs. It identifies the session, turn, scenario version, language, selected tactic/response IDs, and caller pressure. Optional timing facts preserve their source and precision. Filler words are counts from a fixed vocabulary; behavior evidence stores rule IDs, not transcript excerpts.

## Timing fields

Playback and learner speech anchors use session-local monotonic milliseconds with a `TimingSource`. Derived fields such as response latency and speech duration identify their derivation and input sources. A missing local measurement stays absent. Provider ISO timestamps remain cross-check references and are never subtracted from a local monotonic time.

The event can represent caller playback start/end, learner speech start/end, response latency, pre-speech silence, filler evidence, speech duration, recognized word-count approximation, speech rate, baseline rate and change, interruption status, behavior, and a compliance moment. Compliance precision is `segment`; the record includes segment index and local segment bounds, and `approximate` is always explicit. No word index or within-segment position is invented.

## Privacy and ordering

The strict event schema has no transcript or audio field. The session log stores no learner audio. Synthetic dummy-secret matchers return only the first matched segment's timing; matched values are not copied into event facts. `appendLearnerTurnEvent` verifies session identity, unique turn IDs, the configured pressure maximum, and one disclosure moment per session.

The text mock can record recognized word counts and filler evidence, but has no local speech clock. Its latency, speech duration, rate, and interruption timing remain unavailable. Future local VAD/audio instrumentation supplies those observations.

## Debrief and timeline

`buildDeterministicDebrief` emits short statements tied to one event's recorded field and a frontend-neutral `PressureTimelinePoint` per turn. The point carries pressure, latency when measured, behavior, interruption status, compliance timing, approximation, time reference, and observed evidence IDs. It uses no Evon runtime, live LLM, emotion inference, fabricated timestamp, confidence, or efficacy claim.
