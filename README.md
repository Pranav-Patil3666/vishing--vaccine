# Vishing Vaccine

Vishing Vaccine is a training simulator for recognizing voice-based social engineering. This repository contains **Phase 1 only**: a TypeScript monorepo foundation, provider-neutral contracts, scenario validation, deterministic routing, safety scaffolding, and a temporary API/web development shell.

All sample scenario documents are drafts. Their organizations are marked fictional and training-only; they contain no caller script. No provider API is called, no real provider behavior is implied, and no learner audio is persisted.

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

Open the local URL printed by Vite. The shell calls `GET /health` through the Vite development proxy. The API binds to loopback by default. To change the API port or proxy target, set the server-side `API_PORT` or `API_PROXY_TARGET` value. Copy `.env.example` to `.env` only if local overrides are needed; Node loads that file server-side, Vite exposes only `VITE_*` values to the client, and `.env` is ignored by Git.

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
- [Content safety](docs/safety/content-safety.md)
- [Evidence ledger](docs/evidence/evidence-ledger.md)
- [Dependency record](DEPENDENCIES.md)
- [Project roadmap](ROADMAP.md)

Prisma, Timbre, and Evon integrations are intentionally represented by deterministic mocks only. See the roadmap before starting a later phase; Phase 1 does not authorize provider integration or polished user flows.
