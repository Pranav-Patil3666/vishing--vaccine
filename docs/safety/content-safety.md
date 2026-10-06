# Content safety

## Release rule

Scenario JSON is draft content until it passes the roadmap's review gate. The checked-in S-01, S-02, and S-03 files are metadata-only placeholders with `language` and `voice_id` unset, no caller script, and a system safe-template fallback. They must not be presented as reviewed or used to launch a training session.

Every scenario identifies itself as a simulation and names a fictional organization with `training_only: true`. Scenario metadata must include at least one learning objective, roadmap red-flag mapping, per-node expected learner behavior, safety constraints, a valid response reference, and a safe fallback. Approved scenarios additionally require a verified language, voice ID, reviewer, review date, approved nodes, and non-draft responses.

## Runtime routing

The router is deterministic and local. It supports exact phrase, normalized text, keyword, and explicitly configured conservative regular-expression matching. Unknown, empty, unmatched, unapproved, and invalid-state input resolves to a configured safe fallback or the generic system safe-fallback response ID. Routing never writes arbitrary response text.

## Safety scanner boundaries

`validateScenarioSafety` checks schema completeness, configured real-organization names, configured forbidden phrases, common credential/financial-identifier patterns, and a small set of operational-instruction patterns. It fails when required detection lists are absent and labels coverage `incomplete` or `configured-list-only`; it is not a comprehensive entity detector or human review replacement. A detected unsafe condition is a failure.

The scanner must be maintained against the roadmap and manually reviewed before any release. Do not add real organizations or live credential values to make a test pass. Use synthetic, clearly labeled placeholders only. Do not add scripts that teach bypassing security controls, real impersonation, credential collection, or autonomous outreach.

## Learner privacy and UI

The temporary shell persistently shows `SIMULATION`, `AI-generated voice`, and `FICTIONAL ORGANIZATION — TRAINING ONLY`. Microphone recording is not implemented in Phase 1. Future recording requires explicit prior consent, transient processing by default, visible captions, typed fallback, and an immediate exit. Session state contains no audio property; no database or audio file store is configured.

Provider credentials are server-only. The web client accepts only `VITE_PUBLIC_APP_NAME` and `VITE_API_BASE_URL`. `FEATURE_LIVE_EVON` and `ENABLE_LIVE_EVON` both default to false; both must be explicitly true before an optional path can be enabled in a later phase.
