# Session API — Phase 2 development mock

All endpoints are local development interfaces. The API binds to loopback and returns `Cache-Control: no-store`. Existing mock routes keep their mock Prisma/Timbre adapters. Phase 4C.1 adds explicitly gated first-turn runtime routes using the backend recognizer; no provider credential or auth configuration is returned to the browser.

## Phase 4C.1 runtime extension

Session creation accepts optional `runtimeMode` (default `MOCK`). `REAL_STT` requires `demoMode=false`, runtime-eligible reviewed S-01 with adaptive policy, hi-IN and development/test use. Current DRAFT content is rejected. The separate `GET .../real-audio/status` opens no connection. `POST .../real-audio/start` requires microphone consent, existing simulation consent and browser clock/turn identity; `frame`, `finish` and `cancel` require its ephemeral header token. Credit is reserved before one recognizer stream is opened. Valid Finish returns a real-source turn, approved text, optional provider segment reference metadata, service timings and backend audio counts; the existing event/pressure builders append exactly once. Typed turns cannot be submitted to a REAL_STT session. See [full runtime contract and limits](real-voice-turn.md). Live acceptance is blocked by the missing approved content, as [explicitly recorded](../evidence/phase4c1-real-turn.md).

## Runtime boundary

**Current internal architecture:** shared Zod contracts, explicit session state machine, in-memory session store, consent checks, provider interfaces, deterministic behavior classifier and adaptive-policy boundary, approved response references, cache-key generation, credit guard, typed errors, rate limits, and separate operational latency measurements.

**Mock development behavior:** learner input is text encoded into a transient byte buffer tagged `text/mock`; MockPrisma returns it as a normalized `TranscriptEvent`; MockTimbre returns empty non-playable audio metadata; rate limits and credit units are local configured abstractions. This does not describe or emulate Gnani request/response formats.

The checked-in scenario files remain drafts and have no verified language or voice metadata. The API permits only the explicit `pending-verification` sentinel with `demoMode: true` for these files. They have no approved adaptive tactic pool, so the policy can return only `system.safe-fallback`. This is not an approved scenario branch or language claim. A reviewed scenario remains unavailable until human content review and provider language/voice gates are completed.

## Endpoints

### `GET /health`

Returns `{ status, environment, version?, timestamp }`.

### `POST /api/authoring/mock`

Available only in `development` and `test`. Accepts the shared `ScenarioBrief` contract and calls the existing `MockEvonAuthoringAdapter`. The response is a contract-validated `DRAFT` package with synthetic examples and `runtimeEligible: false`; it is not persisted and cannot enter a call session. Other environments reject this route.

### `POST /api/sessions`

Strict JSON body:

```json
{
  "scenarioId": "S-01",
  "scenarioVersion": "0.1.0-draft",
  "language": "pending-verification",
  "demoMode": true
}
```

`voiceId` is accepted only when it exactly matches non-null scenario metadata. Draft scenarios have no voice ID and reject that field. The selected scenario JSON is schema-validated at API startup; creation checks its version, simulation marker, approval/language metadata, and demo constraints. Success is `201` with `{ session, simulationOnly: true, draftFallbackOnly }`. New sessions start at `CONSENT_REQUIRED`, with recording disabled and turn zero.

### `GET /api/sessions/:sessionId`

Returns a safe session projection plus debrief events. It omits audio, provider credentials, environment secrets, and internal provider configuration.

### `POST /api/sessions/:sessionId/consent`

Strict body: `{ "consentVersion": "training-consent-v1" }`. Only a session awaiting consent can accept it. On success, the server timestamps consent and moves to `READY`. Duplicate consent and unsupported consent versions return a typed error.

### `POST /api/sessions/:sessionId/turn`

Development-only strict body accepts mock text and, only in `development` or `test`, an optional `timingFixture` with caller/learner monotonic millisecond anchors or an explicit no-response marker. It requires granted consent and `READY`, `LISTENING`, or recoverable `FALLBACK` state. Processing is `timing capture → mock text recognizer → transcript normalization → safe-word/synthetic-secret checks → deterministic behavior classification → adaptive policy → approved response resolution → credit preflight → cache lookup → mock synthesis on authorized miss → learner-turn event → pressure timeline point → session update`. The result explicitly marks audio as non-playable. Draft/demo mode resolves only to the system-safe fallback.

### `POST /api/sessions/:sessionId/end`

Accepts an empty body. Ends the session, disables recording, withdraws consent for subsequent processing, and reports that transient buffers were cleared. The implementation retains no audio buffer in the session store.

## State transitions

`CREATED → CONSENT_REQUIRED → READY → CALLER_SPEAKING → LISTENING → TRANSCRIBING → ROUTING → GENERATING_RESPONSE → PLAYING_RESPONSE → LISTENING`.

An approved tree may finish at `COMPLETED`. Errors can move to recoverable `FALLBACK`/`ERROR` paths. Any active state may end at `ENDED_BY_LEARNER` where meaningful. Invalid transitions are rejected. A restored serialized session is forced back to `CONSENT_REQUIRED` with recording off; session snapshots do not restore active consent.

Consent is explicit and versioned. Page load and session creation are not consent. Phase 4B adds a separate explicit development microphone check; no audio recording is retained. The text mock input is processed only for the current request. Sensitive-looking values are redacted in returned transcript/debrief evidence; raw input is not kept in session state. No raw audio is written to disk, cache, or session storage.

### Development audio check

`POST /api/sessions/:sessionId/audio/start` accepts `{ audioClockId, turnNumber }` and issues a sixty-second in-memory token. `/frame` accepts exactly1024 raw PCM bytes with `x-audio-token`, `x-audio-sequence` and `x-audio-produced-at`. `/finish` accepts strict browser timing facts and returns counts plus canonical latency/silence/duration/overlap previews. `/cancel` releases the window. These routes are loopback-only, development/test-only, consent/state/turn gated, origin checked, bounded and non-billable. Received PCM is immediately cleared/discarded; facts do not append transcript-free synthetic turns to the event log. Interruption remains unavailable. See [the complete limits and contracts](browser-audio.md).

## Errors and limits

Errors use `{ "error": { "code", "message", "retryAfterSeconds?", "fallbackMode?" } }`; known codes map consistently to 400, 404, 409, 422, 429, 502, or 500. A rejected configured credit request includes `fallbackMode: "demo-safe"`. Stack traces and environment values are never returned. Development limits allow five session creates and twelve turns per minute per remote address; the in-memory limiter is replaceable. Request bodies are capped at 16 KiB.

The credit guard checks configured project units before recognizer and TTS provider operations. These are not Prisma credits. TTS preflight precedes cache resolution; cache hits avoid synthesis. API stage duration/timestamps are operational telemetry and do not drive pressure-curve latency. Learner response latency uses only a local monotonic timeline. The new event log stores no transcript text or audio; only the active mock turn response returns redacted transcript text.

## Storage and provider replacement

In-memory session storage is currently a development implementation. Production persistence choice remains intentionally deferred.

The session/orchestration layer depends on the existing `SpeechRecognizer` and `SpeechSynthesizer` contracts. A future provider adapter must be built only after its request schema, authentication, response fields, voice/language support, billing units, errors, retention, and rate limits are verified. No real Prisma, Timbre, or Evon integration exists in this phase.

## Phase 4C.3 credit diagnostics and typed technical failures

The earlier sections describe the foundation phase; the current bounded real-runtime route is documented in [the Phase 4C.3 report](../evidence/phase4c3-multiturn-s01.md). GET `/api/runtime/credit` is read-only and restricted by the same development/test, loopback peer/Host and same-origin checks as real audio. It exposes loaded numeric cap/reserve/costs, process/boot identity, separate runtime STT/TTS and simulation balances, runtime attempt counts and at most 64 sanitized reservation decisions. It performs no provider work. The automatic panel shows it under Technical audio facts.

Errors can additionally carry strict `technical` metadata: an allowlisted stage/cause, nullable provider-attempt flag, optional cache result and numeric guard decision. The client preserves these facts without retaining arbitrary provider/server messages. A local credit denial remains HTTP 429 / CREDIT_LIMIT_REACHED; RATE_LIMITED or a provider error is not identified as credit by HTTP status alone. Automatic failure records this metadata on the conversation while preserving committed learner events/pressure points for partial debrief. No raw audio, transcript, headers, key or stack is added to diagnostics.
