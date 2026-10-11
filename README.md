# Vishing Vaccine

Vishing Vaccine is a simulation-only training workspace for recognizing voice-based social engineering. The repository contains a local session engine and a React frontend for the command center, scenario library and inspection, offline mock authoring, consent, typed mock calls, and evidence-based debriefs.

All sample scenario documents are drafts. Their organizations are marked fictional and training-only; they contain no caller script. The API can exercise only the system-safe fallback in metadata-only mock mode until human scenario review and language/voice verification are complete. No provider API is called, no real provider behavior is implied, and no learner audio is persisted.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run locally

Install dependencies once from the repository root:

```sh
npm install
```

In one terminal, start the API:

```sh
npm run dev:api
```

In another terminal, start the React development shell:

```sh
npm run dev:web
```

Open the local URL printed by Vite. The frontend uses the Vite development proxy for `/health` and `/api`. Inspect the source scenarios, generate an offline mock draft, or start a typed mock session after reviewing and accepting its disclosure. The UI shows session pressure/timing events and the safe debrief returned by the local API. The mock audio is empty and non-playable; the browser does not request microphone access. The API binds to loopback by default. To change the API port or proxy target, set the server-side `API_PORT` or `API_PROXY_TARGET` value. Copy `.env.example` to `.env` only if local overrides are needed; Node loads that file server-side, Vite exposes only `VITE_*` values to the client, and `.env` is ignored by Git.

## Validation commands

```sh
npm run typecheck
npm run lint
npm test
npm run validate:scenarios
npm run secret-scan
npm run build
```

`npm run check` runs all of these in sequence. The scenario validator checks structure and references; content remains unreleasable until a human safety review and the roadmap gates are complete.

## Architecture and safety

- [System overview](docs/architecture/system-overview.md)
- [Provider abstraction](docs/architecture/provider-abstraction.md)
- [Session API](docs/architecture/session-api.md)
- [Frontend integration](docs/architecture/frontend.md)
- [Content safety](docs/safety/content-safety.md)
- [Evidence ledger](docs/evidence/evidence-ledger.md)
- [Dependency record](DEPENDENCIES.md)
- [Project roadmap](ROADMAP.md)

Prisma, Timbre, and Evon integrations are intentionally represented by deterministic mocks only. See the [pressure curve](docs/architecture/pressure-curve.md), [timing model](docs/architecture/timing-model.md), [adaptive policy](docs/architecture/adaptive-policy.md), [Prisma realtime contract](docs/architecture/prisma-realtime-contract.md), and roadmap before starting a later phase. Draft scenario content is not approved for release.
