# Phase 6D runtime isolation evidence

2026-11-09. Phase 6D verifies the path from exact human approval through explicit publication and backend execution. The positive release uses a disposable fixture. The existing S-92 approval and its single historical block remain authoritative. See the [runtime boundary design](../architecture/runtime-content-boundary.md).

## Before the change

| Audit area | Repository finding |
| --- | --- |
| Backend loading | `health.ts` scanned every JSON file in the configured directory into a map keyed by ID. It parsed a `ScenarioDocument` and safety-checked eligible entries. A directory collision could overwrite a previous entry. |
| Existing resolver | `ApprovedResponseResolver` checked exact scenario, version, text, tactic, language and pressure. `ApprovedCallerCatalog` added the S-01/hi-IN boundary at final caller synthesis. |
| Publication representation | `LocalReviewStore` used hash-chained atomic commits with separate immutable approval and blocked publication records. It had no successful executable package representation. |
| Session authorization | Strict client request schemas rejected arbitrary fields. A session checked version and lifecycle and had a separate S-01-only real voice check. Eligibility initially came from scanned JSON flags. |
| S-01 trust | The canonical v0.2.0 scenario and reviewed package already held its real approval and safety configuration. The Phase 5 evidence supplied their independent byte fingerprints. |
| Contracts | The Phase 6A/6B candidate is a draft envelope with a separate label-based decision graph. The live engine consumes a `ScenarioDocument` with adaptive tactic and shared-ending rules. |
| Provider guard | Prisma and Timbre are configured locally and use consent, bounded sessions and per-operation credit guards. Provider access occurs during audio requests, after session creation. |
| Catalog | Browser cards came from bundled scenario documents. They could show lifecycle independently of the backend. |

The implementation narrows discovery to a fixed, validated legacy release and the existing journal's successful publications. New authored material is admitted only through an explicit typed-practice profile proven against the existing policy. This makes a real positive publication test possible without rewriting protected policy, terminal, classifier or provider sources.

## S-92 compatibility matrix

| Historical reason | Root cause and implementation | Tests and remaining evidence | Live publication |
| --- | --- | --- | --- |
| RUNTIME_SCENARIO_UNREGISTERED | `runtimeCatalog.ts` uses verified journal releases. S-92 has no successful publication. | Copied files and blocked/unpublished registry records cannot register a scenario. S-92 needs an independently authorized successful compatible publication. | Blocked |
| REVIEWED_RUNTIME_PACKAGE_MISSING | `compileRelease.ts` and `runtimeRelease.ts` produce and bind packages for approved, compatible typed practice. S-92 has no compatible package. | A separate synthetic approval/publication produces a deterministically verified package. S-92 has not opted into that reviewed profile. | Blocked |
| AUTHORING_GRAPH_NOT_RUNTIME_POLICY | The compiler walks all reachable prefixes through the actual policy. Existing S-92 graph is not established as equivalent to the live policy. | Positive fixture proves 79 prefixes and 66 leaves at depth 3. A deliberately changed tactic target fails compilation. A direct S-92 live mapping would require further verified integration. | Blocked |
| TERMINAL_MAPPING_NOT_INTEGRATED | S-92 requires separate approved endings. The existing engine has one shared safe ending and a distinct fallback. | The opt-in profile requires explicit shared-ending references before approval. Distinct endings are not aliased. A separately reviewed compatible revision or verified live terminal extension is needed. | Blocked |
| LANGUAGE_UNSUPPORTED | Authored `hi-en` and provider `hi-IN` are distinct. Typed practice preserves the authored language. | Runtime package linkage detects substituted language. S-92 needs authorized real STT/TTS language and code-switching evidence. | Blocked |
| VOICE_NOT_VERIFIED | S-92 has no independently verified provider voice. `mock-only` is a delivery marker for typed practice. | Voice substitution is rejected by package rederivation. S-92 needs a verified voice/language profile and approved caller rendering. | Blocked |
| PRESSURE_PROFILE_UNSUPPORTED | The authored ceiling is 3. Established live profile ceiling is 2. The typed fixture preserves its own exact ceiling and tactics. | Compiler checks next pressure on each route. Tampered limits are rejected. No live limit increase or pressure clamping was performed. | Blocked |

The actual Phase 6C attempt `381164a8-076f-46ab-b397-efe57285d63a` remains `PUBLICATION_BLOCKED`. S-92 v0.1.1 is `APPROVED` under `e2f279e3-820e-49b3-b66f-bd227bc48699`, with exact source hash `7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`. Its unchanged snapshot also lacks the explicit offline profile. The real approval and publication record are inspected read-only.

## Offline verification scope

The runtime tests use isolated temporary stores, explicit synthetic reviewer decisions and actual `LocalReviewStore` publication transactions. Their normal HTTP session path uses the existing deterministic classifier, policy, resolver, event builder and mock provider interfaces. Positive sessions preserve the package pin across turns, produce two continuations and the max-turn terminal, and deny further input. Separate cases exercise verification, dummy disclosure, unknown fallback, safe word and manual End. Typed disclosure uses the existing named mock synthetic token fixture. The live STT path keeps its existing four-digit dummy-token contract. Exhaustive graph equivalence covers all six labels and every reachable path, including repeated refusal, compliance and stalling. Thirteen of the 15 authored variants in this fixture are unreachable. The existing Phase 5 tests exercise legacy policies, timing, pressure, terminal playback, consent, provider credit guards and other invariants.

The negative cases cover copied and renamed drafts, generated and imported candidates, submitted and rejected records, approval without publication, blocked publications, stale versions, forged client fields, invalid or tampered releases, recomputed package/commit hashes, linked directories, missing and partial journals, concurrent catalog reads, duplicate publication, interrupted atomic writes, safety hold, restart and stale resume. The new runtime tests complement the existing Phase 6A–6C schema, checklist, warning, approval and publication matrices. Real human approval is represented only by the preserved S-92 record.

At the final Timbre boundary the test intercepts the actual adapter HTTP body. The one permitted body contains the exact canonical approved opening after existing Unicode normalization. Forged caller text, response IDs, scenario/version fields, missing consent and replacement of the canonical file produce no extra request. Published typed practice exercises the same policy/resolver and mock synthesis boundary, with no live STT/TTS capability. Runtime isolation is scoped to this application and its documented OS trust boundary.

## Manual checks

From the repository root, run `npm run dev:api` and `npm run dev:web` in separate terminals. Use the addresses they print. With the default configuration, open the [local scenario library](http://127.0.0.1:5173/#/scenarios). Check that S-01 is available and S-02/S-03 are labeled fallback-only. S-92 is absent from the runtime choices. Opening `/#/training/precall/S-92` shows an unavailable scenario. For a provider-free S-01 smoke test, select **Mock typing**, read the consent briefing, start, type a practice response and end the session. The real voice options are covered by the offline regression suite.

The server catalog and a safe denial can be inspected without entering a provider path. Set `$api` to the API address printed by your process if it differs.

```powershell
$api = 'http://127.0.0.1:3001'
(Invoke-RestMethod "$api/api/runtime/scenarios").scenarios | Select-Object scenario_id, version, lifecycle_status
$body = @{ scenarioId='S-92'; scenarioVersion='0.1.1'; language='hi-en'; demoMode=$false; runtimeMode='REAL_CONVERSATION' } | ConvertTo-Json -Compress
Invoke-WebRequest "$api/api/sessions" -Method Post -ContentType 'application/json' -Body $body -SkipHttpErrorCheck | Select-Object StatusCode, Content
$id = 'import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337'
npm run --silent authoring:review -- inspect $id
npm run --silent authoring:review -- status
npm run --silent authoring:review -- export $id | Set-Content -Encoding utf8 .cache/authoring/phase6d-inspection.json
```

Expect HTTP 404 with `SCENARIO_NOT_FOUND` for the S-92 request. In the Authoring page, load the exported workflow JSON and expand **Approval and publication record**. It shows the approval and historical compatibility block. Stop and restart the API process, then repeat the catalog, denial and read-only `inspect` commands. The registry reloads from the local commit files and prior learner session IDs are unavailable. This guide requires no manual editing of approval or release records.

```powershell
npm run test:runtime-isolation
npm run check
git diff --check
```

The [machine-readable record](phase6d-runtime-isolation.json) carries the actual registry facts, protected fingerprints and verification results. Phase 6E acceptance and authorized live S-92 compatibility verification remain separate work.

## Results and files

`npm run check` finished with exit 0. **1,185 tests passed, zero failed and zero skipped**, including ten new grouped runtime isolation tests and all previous Phase 5 and Phase 6A–6C regressions. Typecheck, lint, scenario validation, API/web builds and secret scan passed. `git diff --check` passed. Vite reported the existing nonblocking chunk-size warning. The first validation attempts exposed test-only typing and fixture issues. The API test now consumes the shared catalog schema without importing browser implementation files. The terminal test uses the existing named mock disclosure token, which differs from the live STT token format. Both corrections passed in the final run.

The 14 original and 16 Phase 5 protected fingerprint entries all match. The separate S-01 lines hash also matches. The real server catalog contains only S-01 v0.2.0, S-02/S-03 remain protected metadata-only fallbacks, and S-90/S-91 remain unchanged authoring drafts. The real S-92 registry remains at sequence 10, with its exact approval and audit records preserved. The real and offline compatibility evaluations were read-only. No new publication operation ran for S-92. Real Prisma, Timbre and Evon calls each total zero.

Added implementation files are `apps/api/src/runtimeCatalog.ts`, `apps/api/src/authoring/compileRelease.ts`, `packages/scenario-schema/src/runtimeRelease.ts` and `apps/api/src/phase6Runtime.test.ts`. Updated implementation files are `apps/api/src/health.ts`, `apps/api/src/server.ts`, `apps/api/src/authoring/reviewStore.ts`, `apps/web/src/App.tsx`, `apps/web/src/sessionApi.ts`, `apps/web/src/components/ScenarioCard.tsx`, `apps/web/src/components/AuthoringReviewPanel.tsx`, `packages/contracts/src/domain.ts`, `packages/scenario-schema/src/index.ts`, `packages/scenario-schema/src/phase6Draft.ts`, `packages/scenario-schema/src/authoringValidation.ts`, `packages/scenario-schema/src/authoringReview.ts` and `package.json`.

Added evidence is this report, `phase6d-runtime-isolation.json` and `docs/architecture/runtime-content-boundary.md`. Updated project records are `docs/architecture/evon-authoring.md`, `docs/evidence/evidence-ledger.md` and `ROADMAP.md`.

**Phase 6D implementation complete. Runtime isolation verified offline. S-01 runtime preserved. S-92 runtime eligibility remains false. Phase 6E has not started.**
