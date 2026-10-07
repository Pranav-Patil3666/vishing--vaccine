# Learner event log

`LearnerTurnEventBuilder` is the single normalized event constructor used by the orchestrator. `LearnerTurnEvent` identifies the session, turn, scenario version, language, active caller tactic/response/category and pressure, selected next tactic/response/pressure, deterministic policy decision, terminal state, cache/TTS outcome, and behavior evidence. It never stores transcript text or audio.

## Timing fields

Playback and learner speech anchors use session-local monotonic milliseconds with a `TimingSource`. Derived fields such as response latency and speech duration identify their derivation and input sources. A missing local measurement stays absent. Provider ISO timestamps remain cross-check references and are never subtracted from a local monotonic time.

The event carries ordered `timingEvents` for caller playback start/end and learner speech start/end, along with individual anchors, response latency source/precision, pre-speech silence, filler evidence, speech duration, recognized-word approximation, speech rate, session baseline and change, interruption status/offset, behavior, and a compliance moment. Compliance precision is `segment`; the record includes turn ID, segment index/ID when available, local segment bounds when measured, timing source, and `approximate: true`. No word index or within-segment position is invented.

## Privacy and ordering

The strict event schema has no transcript or audio field. The session log stores no learner audio. Synthetic dummy-secret matchers return only the first matched segment's timing; matched values are not copied into event facts. `appendLearnerTurnEvent` verifies session identity, unique turn IDs, the configured pressure maximum, and one disclosure moment per session.

The text mock can record recognized word counts and filler evidence, but has no local speech clock unless a development timing fixture supplies one. `appendLearnerTurnEvent` verifies session identity, unique turn IDs, the configured pressure maximum, and one disclosure moment per session. The orchestrator derives one `PressureTimelinePoint` from each event and appends it to the session alongside the source event.

## Debrief and timeline

`buildDeterministicDebrief` emits short statements tied to one event's recorded field and a frontend-neutral `PressureTimelinePoint` per turn. The point carries pressure, latency when measured, behavior, interruption status, compliance timing, approximation, time reference, and observed evidence IDs. It uses no Evon runtime, live LLM, emotion inference, fabricated timestamp, confidence, or efficacy claim.
