# Phase 6C · Human review, approval, versioning and controlled publication

2026-11-08. The engineering/handoff record below is historical; the final acceptance section records the subsequent genuine owner approval and one controlled publication attempt. Phase 6D and 6E have not started. Isolated test decisions remain distinct from authoritative local records.

## Final acceptance · genuine approval and controlled publication

The owner personally confirmed all 20 mandatory checklist items, including safeguards 18–20, and translation equivalence NOT_APPLICABLE because no formal equivalence claim exists. Fresh validation was unchanged except its timestamp: PASS, zero errors/warnings, one CONTENT_REVIEW information finding. No warning acceptances were recorded. See the [persisted human approval receipt](phase6c-S92-v0.1.1-human-approval.json).

- S-92 v0.1.1 candidate `import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`.
- Exact approved content hash `7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`.
- Review `551876bd-7b60-49f9-9cee-63350afff3f1`.
- Approval `e2f279e3-820e-49b3-b66f-bd227bc48699`, preserved byte-for-byte across publication.
- The owner then explicitly authorized one publication attempt. The existing CLI applied exactly one publish operation under local-publisher, separately from local-reviewer/local-author. No retry or second attempt was made.
- Publication `381164a8-076f-46ab-b397-efe57285d63a`, recorded at 2026-11-08 12:40:38 IST, target current-real-conversation, compatibility s01-real-conversation-v1, result **PUBLICATION_BLOCKED**.
- Final lifecycle remains **APPROVED**, runtime eligibility **false**, publication attempts **1**. No SCENARIO_PUBLISHED event, runtime installation or eligibility override occurred.

Exact gate reasons:

| Recorded reason | Current incompatibility |
| --- | --- |
| RUNTIME_SCENARIO_UNREGISTERED | S-92 is absent from the current S-01 runtime catalog. |
| REVIEWED_RUNTIME_PACKAGE_MISSING | No reviewed runtime release package exists for this authoring artifact. |
| AUTHORING_GRAPH_NOT_RUNTIME_POLICY | Its authoring decision graph has not been integrated with the runtime policy contract. |
| TERMINAL_MAPPING_NOT_INTEGRATED | Its terminal mappings have not been integrated with runtime execution. |
| LANGUAGE_UNSUPPORTED | S-92 declares hi-en; the current real conversation contract requires hi-IN. |
| VOICE_NOT_VERIFIED | The candidate has no verified voice ID. |
| PRESSURE_PROFILE_UNSUPPORTED | Its authored ceiling is 3; the current supported runtime ceiling is 2. |

The three-turn bound is compatible; TURN_POLICY_UNSUPPORTED was not recorded. These reasons were returned by the actual gate, not substituted for it.

The publication commit is registry sequence 10. Audit sequence 11 REVIEW_APPROVED remains intact; sequences 12 PUBLICATION_REQUESTED and 13 PUBLICATION_BLOCKED reference the same exact approval, candidate hash and publication ID. The journal reader and export verifier checked hash chains and immutable artifact integrity.

Persistence was verified by **two independent CLI export processes after apply**, each constructing a new LocalReviewStore and reading journal files from disk. Both returned identical item, approval, publication and audit data, with exactly one publication attempt. This verifies process-reload persistence; it is not a power-loss durability certification. Full raw facts, checklist, current validation, publication reasons, audit hashes and fingerprint comparisons are in [final acceptance evidence](phase6c-final-acceptance.json).

All 14 captured original fingerprints and all 16 selected Phase 5 runtime/content fingerprints match. This includes original S-92 content, packet and earlier commits. S-01 remains unchanged/RUNTIME_ELIGIBLE. S-02/S-03 parse as DRAFT through the existing schema defaults and remain ineligible. Original S-90/S-91 saved records are unchanged DRAFT/runtime false. No provider or runtime source was modified. Real Prisma/Timbre/Evon calls during acceptance: **0 each**.

Final acceptance `npm run check` **PASS, exit 0, 1175/1175 tests**. TypeScript, ESLint, scenario validation, all offline regression suites, API/web builds and secret scan passed. `git diff --check` **PASS**. The existing nonblocking 533.45 kB web chunk warning remains. Fingerprints were recomputed after the check and all 14 original and 16 Phase 5 entries still match. S-01 lines JSON has no Git diff. No runtime or provider source was changed by this acceptance task.

**PHASE 6C STATUS: COMPLETE.** Genuine human approval, one explicitly authorized controlled publication block, durable approval/publication audit records and regression checks are now demonstrated. COMPLETE describes review/versioning/controlled publication acceptance; S-92 remains APPROVED, not runtime eligible or published. Earlier pending-review instructions in this document describe the preserved pre-approval handoff, not current state. Runtime integration remains Phase 6D, **NOT STARTED**.

## Pre-edit audit

The follow-up reused the existing implementation rather than replacing its stores or state machine. The previous full offline run was 1168/1168; that historical count does not describe the final suite below.

| Requirement | Classification before this follow-up | Existing evidence or gap |
| --- | --- | --- |
| A Review submission | IMPLEMENTED AND TESTED | Fresh Phase 6B gate at submit; actual original S-92 submission. |
| B Immutable snapshots | IMPLEMENTED AND TESTED | Saved record hash, review snapshot hash, immutable journal history. |
| C Reviewer identity | IMPLEMENTED AND TESTED | Explicit local actors, assigned reviewer, honest LOCAL_OS_DEMO boundary. |
| D Authorization | IMPLEMENTED AND TESTED | CLI resolves roles from fixed policy; self-review and forged-role tests. |
| E Checklist recording | IMPLEMENTED AND TESTED | Per-item decisions persisted in review envelope; added explicit hash/review ID stamps in this follow-up. |
| F Individual warning dispositions | IMPLEMENTED AND TESTED | Stable ruleId@path, rationale, actor, timestamp, hash; added explicit review ID stamp. |
| G Rejection | IMPLEMENTED AND TESTED | Isolated rejection fixtures; no real unrelated candidate rejection. |
| H Request changes | PARTIALLY IMPLEMENTED | Reasons persisted, but affected-item/finding references remained in the prepared request. New decisions now persist those references; actual existing request preserved as linked evidence. |
| I Draft revision | IMPLEMENTED AND TESTED | Existing LocalDraftStore revision path; actual S-92 revision demonstrated here. |
| J Version lineage | IMPLEMENTED AND TESTED | Parent identity, monotonic numeric versions, collision rejection, changed paths. |
| K Fresh revalidation | IMPLEMENTED AND TESTED | Revised record validated independently with parent chain. |
| L Human approval | IMPLEMENTED BUT NOT DEMONSTRATED | Approval service tested with isolated actors; no actual owner approval. |
| M Approval immutability | IMPLEMENTED AND TESTED | Exact record/hash artifact; in-place edit rejection and new-revision tests. |
| N Explicit publication request | IMPLEMENTED AND TESTED | Separate publisher operation; only isolated approval/publication fixtures. |
| O Compatibility gate | IMPLEMENTED AND TESTED | Current target mirrors S-01-only runtime restrictions. |
| P Publication block | IMPLEMENTED AND TESTED | Unsupported candidate remains APPROVED/runtime false in isolated tests. |
| Q Audit history | IMPLEMENTED AND TESTED | Actor/policy/sequence/hash chain and same-commit state plus events. |
| R Restart persistence | PARTIALLY IMPLEMENTED | Persistent journal already existed; explicit re-instantiated-store regression added here. |
| S Conflict detection | IMPLEMENTED AND TESTED | Exclusive next-sequence hard link, stale sequence/hash/state, concurrent revisions; approval race coverage expanded here. |
| T Idempotency | IMPLEMENTED AND TESTED | Operation ID/request/actor binding; expanded repeated submit/checklist/warning/publish coverage here. |
| U Failure recovery | PARTIALLY IMPLEMENTED | Existing injection stages; added actual revision-storage and post-save journal failure/retry test. |
| V Authoring UI | IMPLEMENTED AND TESTED | Read-only export validation, complete preview, proposal forms and rendered-state tests; no new physical browser test claimed. |
| W CLI | PARTIALLY IMPLEMENTED | Commands existed; original submit/start demonstrated. This follow-up exercised request-changes/revise/export/validate and documents exact formats. |
| X Runtime isolation | IMPLEMENTED AND TESTED | No review write API; candidate cannot enter sessions; fetch/credit prohibition fixtures. |
| Y Protected S-01 | IMPLEMENTED AND TESTED | Canonical content and selected Phase 5 source fingerprints preserved. |

No lifecycle store, audit service, validator pipeline, runtime provider adapter or runtime scenario loader was duplicated.

## Actual owner decision and preserved original

The owner explicitly requested changes before approval: correct COMPLIED education and unsolicited synthetic-disclosure context. This authorized a revision, not checklist decisions or approval.

Original S-92 v0.1.0:

- Candidate `mock-c5ab4e92ac5f0062efae8f774c2c4bba02ad86236b5dbaa3586c91efaddca3b5`.
- Content hash `c5ab4e92ac5f0062efae8f774c2c4bba02ad86236b5dbaa3586c91efaddca3b5`.
- Review `e254f44b-160b-485f-b8ba-86524ddfb468`.
- Original submitted snapshot, content, validation, first three commits and [original packet](phase6c-review-packet-S92.md) remain unchanged.
- A new journal commit records CHANGES_REQUESTED under the configured local-reviewer with the owner's reasons. The [exact prepared operation](phase6c-change-request.operation.json) preserves the two affected finding paths and is verified against that commit's requestHash using its actor. No stronger authenticated identity is claimed. The stored timestamp is the actual operation time, not a fabricated human review time.
- Existing lifecycle representation returns the original item to DRAFT with review.decision `rejected`. This is the contract's changes-requested representation, not a claim that every checklist item failed. Its checklist and warning dispositions remain empty; approval absent; publication attempts zero.

The original packet's pending state remains a historical snapshot. Current state is read from the registry, never inferred from that packet. The final audit found that rejection reasons were stored but affected references were only in the request. All new reject/request-changes operations now persist action, failedItems and findingPaths as decisionDetails. This optional schema extension reads existing immutable history without inserting fields or changing hashes. The already-committed real request is linked as exact evidence rather than rewriting its journal commit.

## New draft and inspectable diff

New S-92 **v0.1.1**:

- Candidate `import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`.
- Content hash `7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`.
- Author `local-author` / AUTHOR. Actual creation time is recorded in the saved record and [diff artifact](phase6c-S92-revision-diff.json).
- Parent candidate is the original S-92. The parent registry item preserves its review reference and mock provenance. The child is honestly MANUAL_IMPORT/revision.json with a canonical source fingerprint; it does not claim a new model generation.
- Lifecycle DRAFT, no review submission, no inherited checklist or warning decisions, no approval, no publication, runtimeEligible false.

Exactly eight candidate paths changed:

1. `/details/premise`
2. `/details/debriefs/3/limitations`
3. `/details/debriefs/6` — new referenced COMPLIED guidance
4. `/draft/debriefTemplateVariants/6` — corresponding template
5. `/draft/packageId`
6. `/draft/scenario/version`
7. `/draft/importableArtifacts/0/artifactId`
8. `/draft/importableArtifacts/0/scenario/version`

The [before/after artifact](phase6c-S92-revision-diff.json) contains exact values. All 15 tactic variants, all 18 learner utterances and interpretations, five tactics, original six template texts, caller opening, four terminal responses, graph routes/references, flags/actions, three-turn bound, ceiling and pressure semantics are unchanged. S-01 and the original S-90/S-91 remain protected.

### COMPLIED education

The dedicated `complied` template is referenced by `details.debriefs` with behavior COMPLIED and outcome null. The existing schema, validation and preview consume this reference; it is not an unused cosmetic label.

> COMPLIED mein learner ne suggested confirmation ya action ke liye haan kahi, bina dummy token bataye. Yeh agreement hai; token disclosure ka saboot nahi. Unverified caller ki request par aage badhne se pehle apne known channel se jaanch karein.

The scoring guidance records agreement only when committed behavior supports it. Independent verification, disclosure and actual enrollment/transaction completion remain unscored without their own evidence. Limitations explicitly distinguish disclosure without other agreement. The next action asks the learner to stop and independently open a familiar directory or bookmarked portal. No runtime scoring or classifier code changed.

### Synthetic disclosure context

The visible premise explains that an unsolicited fictional training-only DUMMY-1234 token can be volunteered without being requested, that no real OTP/password/account value is requested, and that the resulting observation is synthetic disclosure followed by a safe ending. The existing dummy debrief's limitations reinforce this. Both appear in the complete preview and packet, not hidden validator-only metadata.

## Fresh Phase 6B validation

See [the saved-record report](phase6c-S92-v0.1.1-validation.json).

| Fact | Revised saved record |
| --- | --- |
| Structural validation | PASS |
| Consolidated result | PASS |
| Errors / warnings / info | 0 / 0 / 1 |
| reviewEligible | true |
| Validator | 1.0.0 |
| Policy hash | c50d6c4dca8124fc7f20850955f85505f5c5e6003bfb1d9f504df7a5fe828aa0 |
| Graph | 79 prefixes, 66 terminal leaves, depth 3 |
| Reachable authored pressures | 0, 2 |
| Remaining info | CONTENT_REVIEW: human safety and linguistic review required |

DUMMY_CONTEXT is genuinely absent under the existing rule because the visible premise establishes unsolicited synthetic disclosure. COMPLIANCE_REVIEW is absent because a dedicated COMPLIED debrief is linked by templateId. No Phase 6B source, rule or policy was altered during this follow-up. Pattern checks do not certify semantic quality; the owner must still inspect the language, interpretations and educational claims.

An initial unsaved working copy failed GUIDANCE_UNSAFE because the conservative matcher did not understand trailing Hinglish negation in a caller-contact warning. The authoring recommendation was rewritten to directly open the familiar directory/bookmark, and the rules were preserved. Unsaved raw JSON also reports RECORD_REQUIRED; authoritative eligibility above comes from the persisted record with its parent chain.

## Lifecycle, approval and publication contract

| Action | Result |
| --- | --- |
| Adopt verified saved record | Managed DRAFT with AUTHOR attribution |
| Submit DRAFT | SAFETY_REVIEW, immutable snapshot, fresh content/version/policy gate |
| Start review | Assign distinct authorized reviewer |
| Checklist / warning | Persist individual decisions; remain SAFETY_REVIEW |
| Approve complete current review | APPROVED authoring artifact; runtimeEligible false; no publication |
| Reject / request changes | DRAFT with rejected review, reason and preserved history; fresh revision required |
| Revise existing version | New version/identity/hash/parent; DRAFT, fresh validation, no inherited decisions |
| Explicit publisher request | Current unsupported target produces PUBLICATION_BLOCKED; approval preserved |
| Direct DRAFT approval, unreviewed publication, runtime eligibility injection | Rejected |
| Hash mismatch, stale validation/policy, missing decisions, unauthorized/self-review | Rejected |

All 20 mandatory checklist items and the optional translation item persist per-item actor, timestamp, reason, exact content hash and review ID. Critical NOT_APPLICABLE decisions are rejected. Optional translation NOT_APPLICABLE requires a reason. A full checklist never automatically approves.

Warnings use stable `ruleId@path` identities within the exact submitted validation. Each disposition has rationale, actor, timestamp, hash and review ID. Every current warning must separately be ACCEPTED_WITH_JUSTIFICATION before approval. REQUIRES_CHANGES and RESOLVED_IN_NEW_REVISION cannot bypass a current warning; errors cannot be overridden. The revised real record has no warning decisions because it has no warnings and is not submitted.

Approval loads the authoritative saved record, compares it with the immutable snapshot and reruns the current validation gate before accepting explicit confirmation. The artifact reuses the repository ScenarioReview checklist contract inside a separate authoring approval envelope. It retains the unmodified original DRAFT source record and never fabricates voice approval. Editing an approved artifact in place is rejected; a new revision starts without approval.

Current publication compatibility is `s01-real-conversation-v1`. New candidate publication is intentionally unsupported: S-92 is not registered, lacks a reviewed runtime package and verified voice, has hi-en rather than hi-IN, requires authoring-graph/policy and terminal integration, and has authored ceiling 3 versus current runtime ceiling 2. Its max turns 3 is compatible. Isolated tests exercise the actual blocked manifest with exact reasons. No real publication request was made. Successful candidate publication and runtime loading belong to Phase 6D; no fake SCENARIO_PUBLISHED event is emitted.

## Authorization, audit, persistence and recovery

Configured actors live in ignored `content/authoring/review-registry/actors.json`. AUTHOR, REVIEWER and PUBLISHER are resolved by CLI service code, never trusted from request JSON or a browser role selector. The author cannot review their own item; the assigned reviewer cannot be replaced by a second configured reviewer; publisher must differ from both author and reviewer. There is no unauthenticated review-write HTTP route.

This is **local OS trust**, not enterprise RBAC. An OS user who can change actor policy/journal files can impersonate demo actors or rewrite hashes. Hash chains detect accidental corruption and inconsistent local edits; they do not provide external signatures, durable anti-truncation guarantees or non-repudiation. A browser export is inspection data, not authority.

Each operation atomically publishes one immutable journal file containing the new item and its audit events. It uses a synced temporary file and exclusive hard link at the expected next sequence. State and audit therefore commit together; there is no claim of an atomic transaction spanning unrelated files. Events use existing DRAFT_CREATED, DRAFT_REVISED, VALIDATION_COMPLETED, REVIEW_SUBMITTED, REVIEW_STARTED, CHECKLIST_UPDATED, WARNING_ACKNOWLEDGED, CHANGES_REQUESTED, REVIEW_REJECTED, REVIEW_APPROVED, PUBLICATION_REQUESTED, PUBLICATION_BLOCKED and PUBLICATION_HELD names. Static reason codes and references identify rationale stored in the committed review item. Raw scenario text, review notes and secrets are not copied into audit event messages.

Same operation ID/request/actor retries are idempotent. Reusing an ID for different content rejects. Different simultaneous operations compete for the next sequence; stale sequence/state/hash rejects instead of overwriting a winner. Approval and original snapshots remain immutable in subsequent commits.

The draft store writes a new revision before the journal commit. A failed journal write can leave an unregistered DRAFT. Retry with the same request reuses that exact parent/content/version draft, then commits it; it cannot produce phantom approval or publication. Corruption fails closed. Temporary files are not authority; do not manually edit/delete journal entries to recover. Re-export state and retry the identical request after resolving storage failures. Back up both draft records and registry together; neither folder has remote replication.

Current bounds are 256 journal commits, 64 MiB aggregate, 2 MiB per commit/export and bounded lineage/publication arrays. The filesystem must support hard links. This prototype does not offer journal compaction, external signing or crash/power-loss certification. Publication hold preserves historical approval and blocks subsequent requests; it is not a demonstrated runtime withdrawal facility.

## Offline verification

The Phase 6C focused suite is **82/82 PASS**: the original 75 tests plus seven added tests. New coverage explicitly verifies hash/review-bound checklist stamps without automatic approval, simultaneous approvals, second-reviewer assignment, repeated submission/checklist/warning/publication operations, re-instantiated-store persistence, revision-store/post-save journal failure recovery, and the complete revised content contract.

Existing tests cover the negative transition matrix; stale content, policy and validation; role forgery and self-review; snapshot/approval tampering; collision and concurrent revisions; incomplete/failed checklist; individual warning rationale and coverage; errors that cannot be accepted; separate publication; hold; no public write API; input bounds; and twelve failure injection stages. Approval/rejection/publishing tests use temporary directories and explicit test-only actors. They never approve the real S-92 or mutate the real registry.

The first focused invocation inside the sandbox could not create temporary-store hard links; the same suite passed outside it. The first full check caught a nullable-graph assertion in a new test; it was corrected before the final run. No production failure was concealed by those corrections.

Final `npm run check` **PASS, exit 0, 1175/1175 tests** (the previous 1168 plus seven regressions). TypeScript, ESLint, all Phase 5 policy/pressure/terminal/path/invariant suites, Phase 6A/6B/6C, scenario validation, API/web builds and secret scan passed. S-01 remains approved/runtime eligible; S-02/S-03 stay DRAFT. The existing nonblocking web chunk-size warning remains (533.45 kB main script); no unrelated bundling refactor was made.

`git diff --check` **PASS**. The 14 captured original content/saved-record/packet/journal fingerprints and all 16 selected Phase 5 source/content fingerprints match; S-01 lines JSON also has no Git diff. See [protected fingerprints](phase6c-protected-fingerprints.json). The [actual local state and seven audit events](phase6c-local-state.json) record only creation/submission/start/change-request/revision events; there is no real approval or publication event. Original S-90/S-91 stay authoring DRAFT, untouched and absent from the managed registry. New S-92 v0.1.1 is unsubmitted DRAFT. Real Prisma/Timbre/Evon calls **0**, browser microphone calls **0**. Documentation was also checked with the secret scanner after completion.

## Manual review and CLI guide

From repository root, use the existing scripts. `npm run --silent` keeps prepare/export output machine-readable. The local actor policy is already initialized; `init-local-demo` is a one-time setup operation, not an identity login.

```powershell
$id = 'import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337'
npm run --silent authoring:draft -- list
npm run --silent authoring:draft -- show $id
npm run --silent authoring:draft -- validate .cache/authoring/import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337.json
npm run --silent authoring:review -- status
npm run --silent authoring:review -- inspect $id
npm run --silent authoring:review -- export $id | Set-Content -Encoding utf8 .cache/authoring/phase6c-S92-v0.1.1.review.json
```

Inspect [the complete revised packet](phase6c-review-packet-S92-v0.1.1.md), [exact candidate JSON](../../content/authoring/examples/S-92-v0.1.1.candidate.json), findings and before/after values. At `http://127.0.0.1:5173/#/authoring`, choose the review export under Review and publication. Expand the immutable candidate, findings, checklist, version/audit history and approval/publication sections. The browser can download proposals only. Authoritative mutations require CLI apply; refresh the export afterward. No new physical browser smoke test is claimed in this follow-up.

**The following mutation steps are documentation only. Do not execute them until the owner separately authorizes submission/review decisions. They were not executed for the new real candidate.**

```powershell
# Separately authorized submission, then reviewer assignment:
npm run --silent authoring:review -- prepare $id submit | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-author
npm run --silent authoring:review -- prepare $id start | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-reviewer

# After each actual human decision, prepare its evidence file and apply:
npm run --silent authoring:review -- prepare $id checklist .cache/authoring/checklist-evidence.json | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-reviewer

# Only if a current warning exists and a human decides its disposition:
npm run --silent authoring:review -- prepare $id warning .cache/authoring/warning-evidence.json | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-reviewer

# Explicit approval AFTER exact-hash human confirmation and all persisted decisions:
npm run --silent authoring:review -- prepare $id approve .cache/authoring/approval-evidence.json | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-reviewer

# Alternative rejection or request changes, with the actual reasons:
npm run --silent authoring:review -- prepare $id reject .cache/authoring/rejection-evidence.json | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-reviewer
# Use request-changes instead of reject for a revision request.

# New revision: edit a copy, advance version/package/artifact mirrors, then:
npm run --silent authoring:review -- edit $id | Set-Content -Encoding utf8 .cache/authoring/edit.json
npm run --silent authoring:review -- prepare $id revise .cache/authoring/revision-evidence.json | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-author

# Publication is separate and requires its own explicit authorization after approval:
npm run --silent authoring:review -- prepare $id publish | Set-Content -Encoding utf8 .cache/authoring/op.json
npm run --silent authoring:review -- apply .cache/authoring/op.json local-publisher
npm run --silent authoring:review -- inspect $id
```

Prepare adds the current review ID when omitted from checklist/warning/approval/rejection evidence. Every operation includes expected sequence/state/hash. Prepare each operation freshly after the preceding commit; keep the identical operation JSON for idempotent retries. Inspect/export show checklist, warnings, full history and publication results; there are no invented separate history/list-warnings flags.

Evidence formats (examples of structure, not actual recorded decisions):

```json
{"items":{"languageQuality":{"decision":"NEEDS_REVISION","reason":"Replace this with the human reviewer's actual language concern."}}}
```

All required item IDs and human-readable statements are in the packet. PASS requires genuine human confirmation; FAIL/NEEDS_REVISION/NOT_APPLICABLE need reasons. The translation proposal is NOT_APPLICABLE because the examples are separately authored, not verified translations. This does not bypass languageQuality.

```json
{"warning":{"ruleId":"DUMMY_CONTEXT","path":"/candidate/details/examples","decision":"REQUIRES_CHANGES","rationale":"Replace this with the actual individual human rationale if this finding exists."}}
```

There are no current warnings on v0.1.1; the example above would be rejected for that revision. No warning command is needed now.

```json
{"confirmed":true,"notes":"Replace with genuine notes on the exact reviewed hash.","decisionReason":"Replace with the explicit human approval reason."}
```

This approval format does not bypass missing checklist decisions, review assignment or validation. No approval evidence file has been filled out or applied for the revised real candidate.

```json
{"confirmed":true,"reason":"Replace with the owner's actual change or rejection reason.","failedItems":[],"findingPaths":["/"]}
```

The root path refers to the actual CONTENT_REVIEW finding. Alternatively use affected existing warning paths, or actual failed/needs-revision checklist item IDs after those decisions are recorded. Do not fabricate failed items to reject. Revision evidence is `{"candidate": <complete edited candidate object>, "revisionReason": <actual reason>}`. It must advance version and preserve coherent canonical copies; it cannot edit the old artifact.

## File scope and deferred work

Existing Phase 6C files reused: shared `authoringReview.ts`, API `reviewStore.ts`, `draftStore.ts` revision support, review CLI, `AuthoringReviewPanel.tsx`, Authoring-page integration, test registration and actor/brief fixtures. Earlier Phase 6B changes and `.vscode/settings.json` were already present and were preserved.

This follow-up changes `authoringReview.ts` and `reviewStore.ts` for explicit decision stamps and rejection references, expands `phase6Review.test.tsx`, and removes extra trailing blank lines in `AuthoringReviewPanel.tsx` and `authoring-review.ts`. It adds the S-92-v0.1.1 candidate fixture, revised packet, exact diff, validation and local-state/protected-fingerprint/change-request evidence, this report, and updates authoring architecture, roadmap and ledger. Ignored local draft/journal/proposal/export files are the real demo persistence, not runtime library content. The original packet is not edited. No commit is created.

Exact follow-up files, relative to the repository root:

- `packages/scenario-schema/src/authoringReview.ts`
- `apps/api/src/authoring/reviewStore.ts`
- `apps/web/src/phase6Review.test.tsx`
- `apps/web/src/components/AuthoringReviewPanel.tsx` (trailing blank line only)
- `scripts/authoring-review.ts` (trailing blank line only)
- `content/authoring/examples/S-92-v0.1.1.candidate.json`
- `docs/architecture/evon-authoring.md`
- `ROADMAP.md`
- `docs/evidence/evidence-ledger.md`
- `docs/evidence/phase6c-human-review-approval.md`
- `docs/evidence/phase6c-review-packet-S92-v0.1.1.md`
- `docs/evidence/phase6c-S92-revision-diff.json`
- `docs/evidence/phase6c-S92-v0.1.1-validation.json`
- `docs/evidence/phase6c-local-state.json`
- `docs/evidence/phase6c-protected-fingerprints.json`
- `docs/evidence/phase6c-change-request.operation.json`

Phase 6D must later integrate a reviewed authoring artifact with the runtime catalog, language/voice eligibility, actual policy/response/terminal mappings and compatibility certification. It has not started. The present stop condition is genuine owner review of the exact revised hash; submission, checklist recording, approval and publication remain unauthorized until separately instructed.
