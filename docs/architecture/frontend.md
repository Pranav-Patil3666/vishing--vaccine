# Frontend integration — Phase 3

## Phase 4C.1 addition

Development pre-call controls now explicitly distinguish `MOCK` and `REAL_STT`. The real mode is limited to the first S-01 hi-IN turn and remains blocked for the checked-in draft. The existing capture hook/controller is reused with runtime forwarding, mock cue timing and local VAD completion; the development discard check remains separate. The real-turn panel displays a transient redacted transcript, existing classifier/policy result, approved next response text, local timing and provider reference metadata. It updates the existing session/event/pressure view without navigating to a fabricated full-session outcome. End simulation stops capture immediately. No provider credentials, new storage or TTS are added. See [runtime architecture](real-voice-turn.md) and [acceptance status](../evidence/phase4c1-real-turn.md).

The React/Vite client is a simulation-only workspace for the existing contracts and local API. It uses a small hash router so the repository does not need another routing dependency. Its routes cover the command center, scenario library and scenario inspection, mock authoring, pre-call disclosure, the typed mock call console, session inspection, and debrief.

## User flow

1. Inspect fictional, schema-validated scenario source files. The current packages are drafts and are not runtime eligible.
2. Review the pre-call safety briefing and explicitly accept the typed mock-session disclosure.
3. Create a demo session through the local session API. The learner can type a response or use a visible development-only timing fixture. Phase 4B adds an optional development microphone check requiring a separate confirmation and an explicit Prepare microphone action; page load never requests access.
4. Inspect session-local pressure and timing events, end the simulation, and review the API's fact-based debrief.
5. Optionally submit a shared `ScenarioBrief` to `POST /api/authoring/mock`. Generated package content remains in browser state and retains its draft status. Local review/approval transitions are previews and do not persist or enable runtime use.

## Data boundary

The browser stores only the current session identifier in tab-scoped `sessionStorage` so it can reload the safe projection from the in-memory API. It retains no audio. The API turn response includes transient transcript data for the current request; the frontend discards the transcript immediately and retains only branch/response metadata and the safe event projection. The API does not keep transcripts in session event history. Session history is limited to the current in-memory session and is lost when the API process restarts.

Every page keeps simulation-only, fictional-content, and voice-provider disclosure visible. The existing CSS signal core now also follows actual local microphone/VAD state during the optional development check. It does not represent provider voice playback. Canonical timing values are shown only when the backend returns them. Unknown or unavailable measurements remain labeled as unavailable.

## Visual system and accessibility

The UI uses a dark charcoal surface, restrained orange and gold accents, monospaced telemetry labels, glass-like borders, and an animated orbital voice-security visualization. Layouts adapt for mobile, keyboard focus is visible, the navigation has a skip link, and motion reduces under the user's reduced-motion preference. The design uses Lucide icons and the existing React/Vite stack.

## Integration limits

There is no live Prisma, Timbre, Evon, production streaming, persistent scenario authoring, or durable session-history integration. The Phase 4B AudioWorklet/controller/VAD and local PCM sink are development instrumentation, separately bounded from typed mock turns. Diagnostics show technical settings and timing metadata only; no raw samples, device identifiers or transcript history. Microphone resources stop on navigation/unmount, end and turn submission. The development authoring/audio routes are unavailable in production. Draft scenarios still resolve to the system-safe fallback; this frontend does not approve or release scenario content. See [browser audio architecture](browser-audio.md) and [manual QA](../evidence/browser-audio-phase4b.md).
