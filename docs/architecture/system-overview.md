# System overview — Phase 1

## Current boundary

```mermaid
flowchart LR
  Web[React development shell] -->|GET /health via Vite proxy| API[Node.js TypeScript API]
  API --> Contracts[Shared runtime contracts]
  API -. future injection boundary .-> Recognizer[SpeechRecognizer mock]
  API -. future injection boundary .-> Synthesizer[SpeechSynthesizer mock]
  API -. offline-only draft boundary .-> Reasoner[Reasoner mock]
  Router[Deterministic scenario router] --> Schema[Scenario schema and validation]
  Content[Draft scenario placeholders] --> Schema
```

Phase 1 implements only the web-to-API health check, contracts, schema, router foundations, session state, cache-key helper, credit guard, and deterministic provider mocks. The learner voice loop, scenario playback, storage, and real integrations are not implemented.

## Intended later runtime

The roadmap's intended direction is microphone/input → backend → speech-recognition adapter → normalized `TranscriptEvent` → deterministic router → approved response ID → TTS cache or synthesis adapter → caller audio → turn-based debrief. Audio inputs are transient byte buffers and are not represented in session state. Persisting learner audio is outside this design.

Scenario authoring remains an offline content pipeline: brief → draft → safety validation → human review → approved tree → optional audio pre-render. Draft content cannot be selected as an approved runtime branch. Live Evon remains disabled by default and absent from runtime decisions.

## Local services

- API: Node HTTP server on loopback (`127.0.0.1:3001` by default); `GET /health` returns status, environment, optional application version, and timestamp.
- Web: Vite + React; `/health` is proxied to the API during development, avoiding browser-side provider credentials and a separate CORS configuration.
- Build: workspace packages compile before API/web packages so their declared package exports resolve from generated `dist` output.

The web bundler transpiles TypeScript but does not replace `tsc` type checking; the repository runs both. See Vite's [TypeScript feature guide](https://vite.dev/guide/features.html#typescript).
