# Content safety

## Release rule

Phase 2's explicitly marked metadata-only development mock may create a session solely to exercise consent/state/transcription plumbing. Draft content has no approved adaptive tactic pool, so the policy returns only the generic system-safe fallback and makes no approved-content claim. This does not make draft scenarios eligible for a reviewed training session.

Scenario JSON is draft content until it passes the roadmap's review gate. All checked-in files have `language` and `voice_id` unset, no caller script, and a system safe-template fallback. S-01 additionally has draft-only learner-behavior branch structure that resolves to the system-safe template; those branches are not approved runtime content. The files must not be presented as reviewed or used to launch a reviewed training session.

Every scenario identifies itself as a simulation and names a fictional organization with `training_only: true`. Scenario metadata must include at least one learning objective, roadmap red-flag mapping, per-node expected learner behavior, safety constraints, a valid response reference, and a safe fallback. Approved scenarios additionally require a verified language, voice ID, reviewer, review date, approved nodes, and non-draft responses.

## Runtime policy

The scenario-router package remains a deterministic tree-routing utility, but the session orchestrator uses behavior classification and the adaptive policy contract. An approved scenario policy selects only reviewed tactic/response IDs within its pressure and turn limits, prevents repeated tactics, and provides safe-word, learner-end, and fallback exits. Draft scenarios use only the generic system-safe fallback. TTS receives a scenario/version/response reference without a `text` field; the server resolves approved content before any future provider call.

The policy labels direct observed behavior only. Silence, hesitation, rate changes, interruptions, or behavior labels never imply fear, anxiety, intimidation, panic, or other emotional state. Unknown or unavailable timing is reported as unknown, not filled in.

## Safety scanner boundaries

`validateScenarioSafety` checks schema completeness, configured real-organization names, configured forbidden phrases, common credential/financial-identifier patterns, and a small set of operational-instruction patterns. It fails when required detection lists are absent and labels coverage `incomplete` or `configured-list-only`; it is not a comprehensive entity detector or human review replacement. A detected unsafe condition is a failure.

The scanner must be maintained against the roadmap and manually reviewed before any release. Do not add real organizations or live credential values to make a test pass. Use synthetic, clearly labeled placeholders only. Do not add scripts that teach bypassing security controls, real impersonation, credential collection, or autonomous outreach.

## Learner privacy and UI

The temporary shell persistently shows `SIMULATION`, `AI-generated voice`, and `FICTIONAL ORGANIZATION — TRAINING ONLY`. Microphone recording is not implemented in Phase 2A. Future recording requires explicit prior consent, transient processing by default, visible captions, typed fallback, and an immediate exit. Session state contains no audio property. The `LearnerTurnEvent` timeline does not store transcript text or matched dummy-secret values; no database or audio file store is configured. A disclosure moment is segment-level and explicitly approximate.

Provider credentials are server-only. The web client accepts only `VITE_PUBLIC_APP_NAME` and `VITE_API_BASE_URL`. `FEATURE_LIVE_EVON` and `ENABLE_LIVE_EVON` both default to false; both must be explicitly true before an optional path can be enabled in a later phase.
