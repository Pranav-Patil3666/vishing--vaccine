# Phase 6B · Automated safety and schema validation

Date **2026-11-07**. **Phase 6B COMPLETE.** Scope covers the existing local authoring candidates and their review-eligibility decision. The validator runs offline. Real provider calls **0**.

## Repository audit before editing

| Existing surface | Reused capability and boundary |
| --- | --- |
| `DraftScenarioPackageSchema` in `authoring.ts` | Owns package identity, offline source/target, scenario brief/document, tactic pool, response candidates, behavior examples, debrief templates, utterances, importable artifacts, pending review, DRAFT status and false runtime eligibility. |
| `phase6Draft.ts` | Strict candidate envelope, ID and version conventions, 160 KiB UTF-8/JSON bounds, depth/value/array limits, duplicate-key protection, canonical content serialization, cross-field checks and saved-record schema. |
| `safety.ts` and `content/safety/` | Configured-list real-organization, credential, operational-instruction and forbidden-phrase checks. These checks provide limited pattern coverage. |
| `draftStore.ts` | Ignored `.cache/authoring/` JSON records, source/hash candidate IDs, provenance, optional predecessor ID, atomic exclusive saves, safe loads and integrity checks. |
| `authoring-draft.ts` | Generate/import/list/show/export and an existing fail-fast candidate-only validation command. |
| `AuthoringPage.tsx` | User-selected saved-file preview, existing candidate parser, hash verification, source and DRAFT display. |
| `authoringDraft.ts`, S-01 packages and `validate-scenarios.mjs` | Existing S-01 review/preflight and source/package agreement. Release requires the established reviewed metadata. |
| Scenario and Phase 5 contracts | Canonical behavior/tactic enums, global pressure 0–5, per-scenario policy ceiling, response references, terminal precedence, bounded session state and event-derived debrief. Runtime reads the canonical scenario directory. |

Phase 6A already supplied extensive structural checking. Missing capabilities were consolidated safe findings, deterministic severity, contextual content checks, exhaustive draft graph statistics, report staleness detection and a central fresh review gate. The implementation adds those capabilities around the existing schema and intake helpers.

## Architecture and result

```text
JSON bytes or in-memory candidate/record
  → input hardening
  → existing candidate and saved-record schemas
  → identity, provenance, lifecycle and hash checks
  → local content-safety and reference checks
  → bounded behavior-graph traversal
  → language, learner-example, debrief and scoring checks
  → sorted consolidated findings and review eligibility
```

`validateAuthoringDraft` returns candidate/scenario/schema identity, validator version, checkedAt, exact candidate sourceHash, configured policyHash, structural result, PASS/WARN/FAIL, reviewEligible, severity counts, findings and graph statistics. `AuthoringValidationResultSchema` validates this output contract. The published rule version is **1.0.0**.

Each finding contains a stable rule ID, severity, category, safe JSON pointer, static explanation and remediation. Saved candidate pointers start at `/candidate`. Dynamic response-map keys outside the canonical safe ID set become `*`. Findings are deduplicated and sorted by path/rule. Output stops at 80 findings plus a blocking limit finding. Raw matched values and candidate text are excluded from diagnostic messages.

There are **59 rules across 14 categories**.

| Category | Count |
| --- | ---: |
| Input | 4 |
| Schema | 3 |
| Identity | 1 |
| Provenance | 6 |
| Safety | 11 |
| Response | 5 |
| Tactic | 4 |
| Pressure | 3 |
| Graph | 8 |
| Behavior | 4 |
| Language | 2 |
| Red flag | 1 |
| Guidance | 2 |
| Debrief | 5 |

The [rule reference](../architecture/authoring-validation-rules.md) records each condition, severity and correction.

- ERROR produces FAIL and blocks review.
- WARNING produces WARN when no errors exist and stays visible to the reviewer.
- INFO records human-review guidance. PASS can contain INFO.
- Eligibility additionally requires a valid saved record. Raw candidates receive RECORD_REQUIRED and remain ineligible until saved through authoring.

`canSubmitForSafetyReview` validates again, checks the current report contract, and compares substantive results while excluding checkedAt. Content edits, changed validator version, changed safety configuration, forged results, invalid provenance and blocking findings return typed rejection reasons. Fresh validation is required for the exact current candidate. The gate performs no lifecycle transition. Phase 6C must use it before exposing the future review action.

Gate reason codes are STALE_CONTENT, STALE_VALIDATOR, STALE_POLICY, REPORT_MISMATCH and VALIDATION_BLOCKED.

## Checks and scope

**Metadata and identity.** Current contracts require scenario identity, numeric version, title, fictional organization, domain, audience, difficulty, objectives, premise, language/register/script, turns, pressure and source. Package, brief, scenario and artifact identities must agree. Responses have local IDs with a maximum length of 80. Opening, tactic and terminal roles cannot ambiguously share IDs. Review, approval, voice and runtime claims are rejected for these drafts.

**Input and storage.** Bytes retain the 160 KiB bound, UTF-8 checks, depth20, array128 and total-value12000 limits. In-memory data is checked before serialization, including accessors, executable values, hidden toJSON, cycles, symbols and dangerous keys. Existing controlled file reads are reused. Parent traversal segments are now explicitly rejected. Validation reads saved records and optional ancestors, checking content hashes, candidate identity, scenario ownership, distinct revision versions and bounded lineage. It never repairs or rewrites candidate content.

**Fictional framing and sensitive content.** Openings require a bounded English/Hindi/Hinglish simulation cue. Fictional/training markers are required. Configured real identities are errors, and unfamiliar entities or staff-name patterns require human attention. All candidate string surfaces and informational import metadata are scanned. Typed hashes are checked as hashes rather than scanned as phone numbers. Literal values use exact standalone uppercase `DUMMY-[0-9]{4}` semantics. Probable credentials, contacts, URLs, payment identifiers and long identifiers are blocking. Ambiguous five-digit identifiers are warnings. Ordinary years, supported date strings, educational credential words and directly negated instructions have regression coverage.

**Tactics, pressure and content.** The current Phase 6A candidate contract is a full-template profile with exactly five tactics and three authored variants each. This requirement is scoped to that contract. Caller lines have the established 280-character bound. Categories, intensity, pressure, pool, response, red flags and script metadata must agree. Topic mismatch, superficial repetition, markup or unfinished speech can require review. Authored levels 1/2/3 are checked against the draft's own ceiling. A legacy exact-ceiling-3 comparison was replaced with the variant-within-own-ceiling check. No candidate ceiling was raised. No approved scenario content was edited.

**Graph.** Every declared behavior route, node and response is checked. Traversal stops immediately at a terminal, detects cycles and missing targets, enforces final-turn termination and outcome precedence, and reports reachable prefixes, leaves, maximum depth, response IDs, heard draft pressures and unreached authored variants. The traversal has a 4096-prefix defensive bound. An unused authored variant is allowed. Terminal responses must stop the scenario and must not request further details, pressure, credentials or continued conversation.

**Learning, language and debrief.** Examples require unique IDs and full-template coverage, metadata and consistent intended decisions. Clear semantic concerns become human-review warnings without adding runtime classifier rules. Legitimate mixed Hindi/English examples retain their own scripts. Safe actions require independent verification and an option to stop. Flags must resolve to tactics and debriefs. The six established debrief topics remain covered, with a warning when COMPLIED lacks explicit handling. Debrief/scoring checks reject unobserved emotion, traits, fabricated real verification/disclosure and unconditional action-specific credit.

## Existing candidate results

These are read-only results for the saved records created in Phase 6A. Their IDs and content hashes were preserved. Exact reports, paths, rule findings and gate decisions are recorded in [the validation artifact](phase6b-candidate-validation.json).

| Check | S-90 v0.1.0 · deterministic mock | S-91 v0.1.0 · manual import |
| --- | --- | --- |
| Schema and metadata | PASS | PASS |
| Tactics | 15 variants across five categories | 15 variants across five categories |
| Behavior examples | 18 across all six labels | 18 across all six labels |
| Authored ceiling and levels | Ceiling3 permits levels1/2/3 | Ceiling3 permits levels1/2/3 |
| Maximum learner decisions | 3 | 2 |
| Reachable prefixes / terminal leaves | 79 / 66 | 25 / 21 |
| Reachable draft pressures | 0 and2 | 0 and2 |
| Reachable response IDs | 7 | 6 |
| Unreached authored variants | 13 | 14 |
| Mandatory natural outcomes | All4 reachable | All4 reachable |
| Blocking safety/language/debrief findings | 0 | 0 |
| Warnings | DUMMY_CONTEXT and COMPLIANCE_REVIEW | DUMMY_CONTEXT and COMPLIANCE_REVIEW |
| INFO | Human content review required | Human content review required |
| Overall / review eligible | WARN / true | WARN / true |
| Lifecycle / runtime eligible | DRAFT / false | DRAFT / false |

The example interpretation mentions volunteering a synthetic token, but the preceding caller content does not establish an explicit synthetic-token exercise or clearly document unsolicited disclosure. This remains a conservative context warning. The existing six debrief variants meet canonical outcome coverage. COMPLIED is not a mandatory separately named variant in that contract, so its limited treatment is a warning.

S-91 terminates correctly on its second learner decision. Its Latin examples are intentional within the mixed-language curriculum. The approved S-01 remains a separate runtime with ceiling2 and reachable pressures0/1.

## CLI and authoring UI

The existing mutation/listing commands retain their entry points. Validation now prints the consolidated JSON report, with severity counts, safe paths, corrections and eligibility. Blocking validation exits1. PASS/WARN exits0. File-access problems retain typed CLI failures and a nonzero exit.

```powershell
npm run authoring:draft -- validate .cache/authoring/mock-80843162b78c5540dc3701cc770c1b2e7bc5544b2fafa1c93979c7bfc8d46235.json
npm run authoring:draft -- validate .cache/authoring/import-fd46d669704caa567f76cba4d9c6db0dc9728c6a6c88b96d7b121455bae7d3b2.json
npm run authoring:draft -- validate content/authoring/examples/benefits-import.json
```

The third command inspects a raw candidate and reports RECORD_REQUIRED. Use the saved record to check provenance-bound review eligibility.

Run `npm run dev:web`, open the Authoring page and choose either saved file. The page runs fresh validation and displays status, eligibility, error/warning/info counts, categories, paths, remediation and bounded graph facts. Failed validation still displays findings, while the existing preview/parser governs rendering of candidate content. Browser-only revision validation without its predecessor files fails closed with LINEAGE_INVALID. CLI validation can load predecessors from the controlled local store.

The page validates and previews one captured file snapshot. The legacy preview failure caption uses a typed code and points to the consolidated findings, avoiding raw field text in the caption.

UI finding display is exercised through the same React component in automated rendering tests. No new physical provider/browser session was used for Phase 6B.

## Tests, regression and limits

The explicit **57-case negative matrix** is table-driven or uses small purpose-built inputs. It covers schema, identity, tactics, pressure, behavior, graphs, safety, language, debrief/scoring, provenance, stale hashes, tampering and input security. Additional tests cover safe educational wording, date/number false positives, protected diagnostics, missing configuration, hidden executable properties, policy changes, fresh PASS/WARN and revisions. Neither example content nor S-01 was rewritten to satisfy a test.

- Focused Phase 6A/6B suites **107/107 PASS**, including **74 new Phase 6B tests**.
- Final `npm run check` **PASS, exit0, 1093/1093 tests**. Typecheck, lint, scenario validation, API/web builds and secret scan passed. S-01 still reports approved review and runtime eligibility true.
- The 103894-byte valid fixture was exercised with stable findings and bounded traversal. Its timing in test output is a single local observation.
- Runtime isolation tests prohibit network/credit work, compare an active session and budget snapshots, and verify canonical files. S-02/S-03 requests for REAL_CONVERSATION are rejected under the existing API gates. Existing metadata demo behavior was inspected and retained.
- All eight protected Phase 6A template/content/saved-record fingerprints matched, along with all 16 Phase 5 runtime/content fingerprints. Exact CLI validations of the saved S-90/S-91 records each returned WARN, errors0/warnings2/info1 and reviewEligible true.
- `git diff --check` passed and final documentation passed the secret scan. The web build emits a nonblocking chunk-size warning for its 504.08 kB main script.

Local patterns have bounded entity, semantic, language, negation and sensitive-data coverage. The original configured-list intake also remains conservative, with contextual matches exposed for human attention. Content hashes detect changed content and bind a validation decision. They do not authenticate an author's identity. Classifier accuracy, formal runtime isolation certification and training effectiveness require their later evaluation phases.

Phase 6C human review, approval controls and publication are not started. Automated review eligibility retains DRAFT status.

## File scope

Added during Phase 6B are `authoringRules.ts`, `authoringContentSafety.ts` and `authoringValidation.ts` under the shared schema package, `apps/web/src/phase6Validation.test.tsx`, this evidence report, the candidate-validation JSON artifact and the architecture rule reference.

Updated are the shared schema exports, the Phase 6A schema export/own-ceiling check, the local store's read-only validation and path guard, the CLI validate command, Authoring preview findings, test registration, authoring architecture documentation, evidence ledger and roadmap status. Original runtime files and candidate contents are covered by the preserved fingerprints. No commit was created by this task.

PHASE 6B STATUS:
COMPLETE
