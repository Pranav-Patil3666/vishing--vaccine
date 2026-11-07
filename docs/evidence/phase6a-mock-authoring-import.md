# Phase 6A evidence · Mock authoring and manual draft import

2026-11-06. **Phase 6A COMPLETE.** Deterministic mock-assisted scenario authoring and manual JSON draft import are available locally. The generation and import demonstrations used fictional examples. Real Prisma, Timbre and inference provider calls were **0**.

## Pre-edit audit

| Surface | Existing behavior before 6A | Gap addressed |
| --- | --- | --- |
| `packages/contracts/src/domain.ts` and `providers.ts` | `ScenarioBrief` carries scenario ID, learning objective, red flags and language. `Reasoner` returns a small `DraftTree`. | A versioned structured brief and a generator interface returning the existing full package. |
| `packages/scenario-schema/src/scenario.ts` | Strict `ScenarioDocument` requires S-NN identity, version, fictional training organization, simulation, opening, objectives, red flags, responses, one root, safe fallback and review metadata. Adaptive policy adds pressure and turn bounds, tactics, terminal states and safety metadata. | Cross-check Phase 6A-specific coverage, sequential decisions, templates and response references. |
| `packages/scenario-schema/src/authoring.ts` | `DraftScenarioPackage` uses `packageId`, `source: offline_authoring`, `target`, `scenarioBrief`, `scenario`, `tacticPool`, `candidateApprovedResponses`, `behaviorTrainingExamples`, `debriefTemplateVariants`, `candidateUtterances`, `importableArtifacts`, `review`, `status` and `runtimeEligible`. | Add only the missing educational details and verified ingestion metadata. |
| `apps/api/src/health.ts` and `providers/evon/mockEvon.ts` | The development/test mock endpoint returns an offline draft fixture. No real Evon generator is wired. Runtime content comes from `content/scenarios/`. | Comprehensive generation through an explicit local command. |
| `apps/web/src/authoringDraft.ts`, `AuthoringPage.tsx`, `LocalDraftReview.tsx` | The browser decorated the API mock with local caller lines and five behavior categories, then held the record in memory. S-01 uses the existing review/preflight functions and saved review package. | Persistent drafts, manual import, six behavior categories, and preview of the actual saved package. |
| `content/scenario-candidates/`, `content/authoring/`, `scripts/validate-scenarios.mjs` | The scenario validator reads candidate directories as scenario documents. The S-01 package and lines are compared with the scenario and configured safety references. The lifecycle supports DRAFT, SAFETY_REVIEW, APPROVED and RUNTIME_ELIGIBLE. | Keep local candidate envelopes in ignored `.cache/authoring/` so the existing scanner and release rules remain intact. |
| `content/safety/`, `.env.example`, `.gitignore`, root `package.json` | Configured safety reference lists, gated provider configuration and ignored local cache/env. The Node/tsx test stack covers schema, session, providers and UI. | Reuse lists for intake, register focused tests in the existing suite and ignore only the new draft store. |

## Candidate contract and coverage

The generator supports **fictional-benefits-verification v1.0.0**. It uses finite choices for the learning objective, difficulty, audience, script and turn count. The author supplies an S-NN candidate ID outside S-01/S-02/S-03, a working title and numeric draft version. The template derives the fictional organization, department, industry, premise, safety constraints and relevant flags. The title is descriptive metadata. Arbitrary premises or unsupported template options fail with a typed error. See the [sample brief](../../content/authoring/examples/benefits-brief.json).

The candidate JSON envelope contains `schemaVersion: 1`, the existing `draft` package, `details` and an optional `declaredOrigin`. The package holds the canonical scenario and existing educational records. Details add references for the opening, intensity, language script, red flags, decisions, endings and debrief guidance. The canonical tactic record has one pressure value, so each of the 15 variants is its own response-backed tactic entry under one of the five existing categories. Text remains in the scenario response table, with matching records in the package.

| Coverage | S-90 v0.1.0 generated result |
| --- | --- |
| Metadata | **Fictional employee benefits verification call** at Fictional Meghdoot Works. The Employee Benefits Practice Desk calls about a pending wellness enrollment. The objective is to verify through a channel the learner already knows. |
| Opening | One complete simulation-disclosed opening, `system.opening`. Voice lines have a 280-character limit. |
| Tactics | **15** unique lines. Urgency, authority, isolation, fear and reward each have low/medium/high variants at authored levels **1/2/3** on the 0–5 scale. These levels belong to the draft curriculum. |
| Learner examples | **18** synthetic examples, three for each of REFUSED, STALLED, VERIFIED_INDEPENDENTLY, COMPLIED, DISCLOSED_DUMMY_SECRET and UNKNOWN. Each group has Hindi Devanagari, Romanized Hindi/Hinglish and English. Only the three disclosure examples contain synthetic DUMMY-format values. Labels express author intent. |
| Red flags and safe behavior | Five configured IDs RF-01/02/03/07/08 map to variants. Four safe actions cover pausing, withholding information, choosing a familiar verification channel and stopping. |
| Decision map | Three decision points, **18 behavior rows**. Opening can continue to authority and then fear. Every continuation targets the next authored node. The last point terminates for every label. Earlier UNKNOWN routes to SAFE_FALLBACK. Final UNKNOWN follows MAX_TURNS precedence. Verification and synthetic disclosure retain their outcomes. |
| Terminal and fallback | SAFE_VERIFIED, DUMMY_SECRET_DISCLOSED, SAFE_FALLBACK and MAX_TURNS have distinct response references. A generic safe-ending template satisfies the scenario contract. Manual end and safe-word behavior are described separately. |
| Debrief and scoring | **6** variants for verification, refusal, stalling, synthetic disclosure, fallback and the turn cap. Each has an observation, relevant flags, conditional scoring, next action, evidence limit and takeaway. |

The opening and all caller variants have Latin/Hinglish and Devanagari options. Normalized identical briefs produce deep-equal content and stable ordering. The semantic content carries no generation timestamp. The saved envelope records creation time, candidate identity, content hash and previous revision reference. The mock source also records template/generator versions and normalized brief fingerprint.

## Import, persistence and approval boundary

Import accepts a local UTF-8 `.json` file containing the Phase 6A candidate envelope. The [manual fixture](../../content/authoring/examples/benefits-import.json) is a repository demonstration adapted from the deterministic template. It uses S-91 v0.1.0, Devanagari caller lines and two decisions. Original filename and raw-byte fingerprint are informational. Any declared origin is preserved as **UNVERIFIED** under **MANUAL_IMPORT**. Unsupported top-level provenance fields, trusted model claims, approval states and completed review checklist claims are rejected.

The parser bounds file bytes, depth, array length and total JSON values, rejects duplicate keys and prototype-related keys, and parses recognized properties through strict contracts. The validator checks coverage, content lengths, identities, references, pressure and language/script agreement. It reuses configured-list scans for known real organizations, credential-like patterns and operational instructions. This is intake validation plus a limited pattern scan. Semantic coherence, impersonation coverage, linguistic quality, classifier accuracy and approval still require their separate review work.

The CLI uses fixed local paths for writes, refuses invalid saved IDs, direct UNC/device paths, non-JSON inputs and symbolic-link files. Imported names never become destinations. New records use `mock-<contentHash>` or `import-<contentHash>` and a synced staging file plus an exclusive hard link. Exact candidate content can exist once per source. Concurrent duplicate saves return CANDIDATE_ALREADY_EXISTS, preserving the winner. `show`, `list` and the browser preview revalidate persisted content. Use a filesystem that supports hard links. A saved hash detects corruption and does not authenticate the author of a file.

Generated and imported records have DRAFT status, false runtime eligibility, no reviewer or voice ID and pending review with an unchecked checklist. No write route is exposed by this feature. Local records are not added to the training library. The integration test starts S-01 in CALLER_PREPARING with loopback transport doubles, creates both draft types and confirms that the session/credit snapshots, canonical files and runtime-eligible set are unchanged. Both attempted candidate session creations return SCENARIO_NOT_FOUND and the test records zero recognizer, synthesizer or outbound fetch calls.

## Local walkthrough and observed result

From the repository root, run the following in a terminal. Edit a copy of the brief to try another supported ID, script, version or turn count.

```powershell
npm run authoring:draft -- generate content/authoring/examples/benefits-brief.json
npm run authoring:draft -- validate content/authoring/examples/benefits-import.json
npm run authoring:draft -- import content/authoring/examples/benefits-import.json
npm run authoring:draft -- list
npm run authoring:draft -- show <candidate-id>
```

The demo records already exist in this workspace. Use `list` to retrieve their paths or change the input ID/version for a new record. To revise a candidate, pass its saved ID as the last argument to `generate` or `import` and supply a different version for the same scenario ID. `npm run --silent authoring:draft -- export <candidate-id>` prints the input candidate JSON for editing/import.

Run `npm run dev:web` and open [Scenario authoring](http://127.0.0.1:5173/#/authoring). Under **Open a saved draft**, select the record path printed by the CLI. Repeat for the other record.

| Actual CLI record | Observed browser result |
| --- | --- |
| S-90 v0.1.0, `mock-80843162b78c5540dc3701cc770c1b2e7bc5544b2fafa1c93979c7bfc8d46235` | **MOCK GENERATED — DRAFT**, structural PASS, approval absent, tactics, UNKNOWN examples, MAX_TURNS and debrief present. |
| S-91 v0.1.0, `import-fd46d669704caa567f76cba4d9c6db0dc9728c6a6c88b96d7b121455bae7d3b2` | **MANUALLY IMPORTED — DRAFT**, structural PASS, approval absent, corresponding preview sections present. |

Both records were created and reloaded using the CLI. Both were then selected through the actual browser file chooser in an automated in-app browser smoke test on loopback. The first loopback preview timed out. Running the local Vite preview outside the sandbox resolved it. There was no human browser test.

## Verification and deferred work

- **33/33 focused tests passed.** Positive fixtures cover complete generated and imported content, Unicode save/reload, both provenance previews, deterministic ordering, cross-references and revision linkage. Negative cases cover malformed/empty/invalid UTF-8, oversized, over-deep and over-wide JSON, duplicate/prototype keys, wrong version, unsafe paths, storage failure, corruption, duplicate identity races, missing metadata/opening/terminal/tactic/safe action/debrief, invalid tactics/behaviors/pressure/turn limits, inconsistent pressure, dangling/cyclic routes, synthetic marker violations, configured real organization, trusted provenance claims and approval/runtime claims. The first pass caught Unicode filename handling and an incorrect streaming test double. Both were corrected before the final run.
- **`npm run check` passed, 1,019/1,019 tests.** Typecheck, lint, scenario validation, API/web builds and secret scan passed. S-01 remains `review=approved; runtime=true`. Candidate-only `validate` passed and reported DRAFT/runtime false. The Phase 5 policy, pressure, terminal, path matrix, invariants, debrief and provider adapter tests ran offline.
- **`git diff --check` passed.** The original scenario validation script, S-01 scenario and approval files, runtime policy and provider integrations retain their existing scope. Real provider calls **0**.
- Phase 6B semantic safety review, 6C approval/publishing, 6D formal runtime isolation certification and 6E final acceptance are deferred. The available family is deliberately limited to the fictional benefits scenario. The compatibility mock API and original S-01 review package remain separate historical surfaces.
