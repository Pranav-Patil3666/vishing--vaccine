# Adaptive deterministic policy

## Runtime path

The intended live path is local timing/VAD → normalized STT `TranscriptEvent` → deterministic behavior classification → adaptive policy → approved tactic and caller response reference → cache/TTS → playback → event log. There is no unconstrained live LLM in this path. Evon is offline authoring only.

The development adapter accepts mock text and optional validated timing fixtures, then uses the same behavior/policy/event boundary as the planned voice path. Checked-in scenarios are drafts with no adaptive tactic pool, so they receive only `system.safe-fallback`. Normal adaptive selection is gated on `RUNTIME_ELIGIBLE` scenario status and a non-demo session.

## Policy inputs and limits

An approved `adaptive_policy` defines a tactic pool across urgency, authority, isolation, fear/consequence, and reward/fake-help categories, pressure level (0–5), maximum pressure, maximum turns, escalation behavior labels, safe-word phrase, terminal states, and response IDs. Schema validation checks tactic ID uniqueness, pressure bounds, response references, and safe exits. Runtime selection is deterministic, bounded, and filters out previously used tactics and response IDs. Exhausted options end safely instead of looping.

Recognized behavior labels are `REFUSED`, `STALLED`, `VERIFIED_INDEPENDENTLY`, `COMPLIED`, `DISCLOSED_DUMMY_SECRET`, and `UNKNOWN`. Rules describe visible text evidence or a confirmed synthetic secret match. They do not infer emotion. Safe-word, learner-ended, independently verified, disclosed dummy-secret, max-turn, and no-eligible-tactic cases take terminal or safe-fallback paths.

## Content boundary

The policy returns a response selected from reviewed scenario content or a system-safe fallback. `ApprovedResponseResolver` verifies the selected response identity, tactic/category/pressure, language, and approval state. `SpeechSynthesisRequest` contains only scenario/version/response identity and approval metadata; it has no arbitrary `text` field. The request carries no raw provider credential or learner transcript.

TTS credit preflight precedes cache resolution. A cached result can be used without a billable synthesis; a miss reaches TTS only after authorization. The STT guard likewise runs before a recognizer call.
