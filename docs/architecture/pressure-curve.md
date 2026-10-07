# Voice pressure curve

## Product signal

The training session records how observable learner behavior changes as the caller pressure level changes. Pressure is a scenario-authored integer from 0 through 5; an adaptive scenario sets its own maximum. The policy chooses a tactic and response ID from that scenario's reviewed pool. It does not generate caller speech.

For each turn, the event model can carry pressure, response latency, pre-speech silence, filler-word counts, speech duration and approximate rate, a session-local rate baseline and delta, interruption status, behavior label, and the first synthetic dummy-secret disclosure moment. Unknown measurements stay absent or explicitly unknown.

## Timing and baseline

All local audio events are placed on one session-local monotonic timeline. Latency is caller playback end to learner speech start. Hesitation reports that measured silence and filler-word evidence; it is not an emotion measure. Speech rate uses recognized transcript word count divided by measured learner speech duration. The count is an approximation, not a linguistic truth.

The first valid turn with at least five normalized words and positive measured duration establishes a fixed session-local baseline. Later valid turns compare against that baseline; short turns and missing/zero durations do not change it. Without a valid baseline, the status is `insufficient_data` and percentage change is null. The text-only mock has no local speech-duration measurement unless a development timing fixture supplies one.

## Interpretation boundary

Debrief statements must trace to event fields and may describe pressure, latency, interruptions, filler counts, behavior labels, and timing limits. They must not label a learner as scared, nervous, anxious, intimidated, panicked, or otherwise infer emotion from silence, rate, or behavior. A dummy-secret disclosure is synthetic training data only and is reported at segment precision with approximate wording.

See [event log](event-log.md), [timing model](timing-model.md), [adaptive policy](adaptive-policy.md), and [deterministic debrief](event-log.md#debrief-and-timeline).
