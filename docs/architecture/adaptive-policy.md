# Adaptive deterministic policy

## Runtime path

The intended live path is local timing/VAD → normalized STT `TranscriptEvent` → deterministic behavior classification → adaptive policy → approved tactic and caller response reference → cache/TTS → playback → event log. There is no unconstrained live LLM in this path. Evon is offline authoring only.

The current development adapter still accepts typed mock text and produces non-playable metadata. Its orchestrator now uses the same behavior/policy boundary; checked-in scenarios are drafts with no adaptive tactic pool, so they receive only `system.safe-fallback`.

## Policy inputs and limits

An approved `adaptive_policy` defines a tactic pool, pressure level (0–5), maximum pressure, maximum turns, escalation behavior labels, safe-word phrase, terminal states, and response IDs. Schema validation checks tactic ID uniqueness, pressure bounds, response references, and a safe exit for safe-word and learner-ended states. Runtime selection is deterministic, bounded, and filters out previously used tactics and response IDs.

Recognized behavior labels are `REFUSED`, `STALLED`, `VERIFIED_INDEPENDENTLY`, `COMPLIED`, `DISCLOSED_DUMMY_SECRET`, and `UNKNOWN`. Rules describe visible text evidence or a confirmed synthetic secret match. They do not infer emotion. Safe-word, learner-ended, independently verified, disclosed dummy-secret, max-turn, and no-eligible-tactic cases take terminal or safe-fallback paths.

## Content boundary

The policy returns a response selected from reviewed scenario content. `SpeechSynthesisRequest` contains only scenario/version/response identity and approval metadata; it has no arbitrary `text` field. A future server-side `ApprovedResponseResolver` must resolve that identity to reviewed content before synthesis. The request carries no raw provider credential or learner transcript.

TTS credit preflight precedes cache resolution. A cached result can be used without a billable synthesis; a miss reaches TTS only after authorization. The STT guard likewise runs before a recognizer call.
