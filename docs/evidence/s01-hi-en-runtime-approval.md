# S-01 Hindi/Hinglish runtime content — approved

## Current approval and promotion — 2026-10-14

The repository user reviewed the exact content displayed in this conversation and explicitly stated: "I explicitly approve this exact scenario content for runtime use." This approval authorizes the approval/promotion step only; no live provider acceptance was requested or performed.

| Field | Current value |
|---|---|
| Scenario / version | S-01 — Urgent Account Verification / 0.2.0 |
| Organization / language | Fictional Northstar Cooperative Bank / Hindi-Hinglish; runtime `hi-IN` |
| Canonical runtime slot | `content/scenarios/S-01-urgent-account-verification.json` |
| Lifecycle / review decision | `RUNTIME_ELIGIBLE` / `approved` |
| Runtime eligibility | **true** |
| Reviewer reference | `user:explicit-chat-approval` — the human repository user in this conversation; no inferred personal identity |
| Review timestamp | `2026-10-14T05:53:12Z` — UTC time when the explicit approval was recorded, not a fabricated earlier review time |
| Approval source | Explicit user message following the exact-content review handoff |
| Voice | `mock-only`; no Timbre verification or caller TTS added |
| Live Phase 4C.1 acceptance | **Not started** |

Applied the existing `approveDraftScenarioPackage` transition (`SAFETY_REVIEW` → `APPROVED`, runtime=false), followed by `makeScenarioRuntimeEligible` (`APPROVED` → `RUNTIME_ELIGIBLE`, runtime=true). All eight human checklist items are true based on the explicit review of the content and required safety configuration:

- fictionalOrganization
- syntheticDataOnly
- noSecurityBypassInstructions
- safeEndingAvailable
- simulationLabelVisible
- aiVoiceDisclosureRequired
- consentBeforeRecording
- noAudioRetentionByDefault

Opening and five tactic responses became `reviewed_safe`; nodes, tactic pool, response records and debrief records gained their existing approved annotations. Fallback/ending remain `system_safe_template`. Exact caller text, all fifteen intensity lines, fifteen examples, five debrief texts, policy configuration, red flags, language and safeguards are unchanged. Assertions compared promotion with the original candidate and the expected existing transitions before writing the canonical slot.

The canonical slot, candidate mirror, review package/importable scenario and line-record scenario now match. History was preserved outside runtime/catalog loading:

- `content/scenario-candidates/history/S-01-0.1.0-draft.json` — byte-for-byte copy of the old canonical draft; still DRAFT and runtime-ineligible.
- `content/authoring/history/S-01-hi-IN.pending-review.package.json` — byte-for-byte pending-review package; still SAFETY_REVIEW/in_review, null reviewer/time, unchecked human checklist and runtime=false.

The offline `realVoiceFixture.ts` was not promoted. No approval/safety predicate, validator, runtime loader, provider code, environment, frontend logic or architecture changed in this promotion step. Existing tests now use the historical S-01 or remaining S-02 for draft coverage; the catalog test distinguishes approved S-01 from unchanged drafts. Two additional tests verify exact artifact/lifecycle consistency and approved content gates without provider operations.

Validation for this promotion:

- `npm run validate:scenarios`: **PASS**, review=approved; runtime=true; archived draft remains draft.
- Focused promotion and affected regression tests: **111/111 PASS**.
- `npm run check`: **PASS**, exit 0; typecheck, lint, **336/336 offline tests**, scenario validation, API/web builds and secret scan. Previous prerequisite count 334; two promotion tests added, none removed. Five existing test names were updated to describe archived fixtures or the approved catalog state; their gate coverage remains.
- `git diff --check`: **PASS**.
- Provider calls: **0**. No Prisma, Timbre, Evon, microphone capture, live acceptance or commit. One-off approval helper removed after use.

### Exact files changed by the promotion step

Created (history only):

- `content/scenario-candidates/history/S-01-0.1.0-draft.json`
- `content/authoring/history/S-01-hi-IN.pending-review.package.json`

Modified:

- `content/scenarios/S-01-urgent-account-verification.json`
- `content/scenario-candidates/S-01-hi-IN.json`
- `content/authoring/S-01-hi-IN.package.json`
- `content/authoring/S-01-hi-IN.lines.json`
- `apps/api/src/health.test.ts`
- `apps/api/src/sessionApi.test.ts`
- `apps/api/src/turnOrchestrator.test.ts`
- `apps/api/src/learnerTurnEventBuilder.test.ts`
- `apps/web/src/scenarioCatalog.test.ts`
- `apps/web/src/components/render.test.tsx`
- `apps/web/src/sessionApi.test.ts`
- `apps/web/src/audio/ingress.test.ts`
- `apps/web/src/audio/realVoice.test.ts`
- `apps/web/src/s01ReviewCandidate.test.ts`
- `docs/evidence/s01-hi-en-runtime-approval.md`
- `docs/evidence/evidence-ledger.md`

These are incremental changes from the approved review handoff, separated from earlier uncommitted Phase 4C.1/prerequisite work. No other files changed in this step, and temporary helper/log files are not retained.

## Historical recovery and pending-review state

The sections below retain the prerequisite's pre-approval review content and results. Their pending status applies to that earlier handoff; the current approved state is recorded above.

Recovered the interrupted prerequisite on 2026-10-14. Candidate JSON, authoring/review package, intensity-line record, reference lists and tests survived. No content regeneration was needed. The earlier full-check result was unavailable and is not treated as evidence. The one-off `.create-s01-review.mjs` and `.refresh-s01-review.mjs` helpers had already been removed.

The original `content/scenarios/S-01-urgent-account-verification.json` remains unchanged at `0.1.0-draft`, with null language/reviewer/time and no runtime eligibility. Earlier uncommitted Phase 4C.1 integration is preserved. `apps/api/src/testing/realVoiceFixture.ts` remains an offline test fixture; it is not scenario content or human approval.

| Field | Candidate value |
|---|---|
| Scenario | S-01 — Urgent Account Verification |
| Version | 0.2.0 |
| Fictional organization | Northstar Cooperative Bank; training-only |
| Content language | Hindi/Hinglish; authoring brief `hi-en`, examples `hi-en` / `hi` |
| Runtime/provider language | `hi-IN` |
| Voice | `mock-only`; no Timbre voice selection or verification |
| Content lifecycle / review status | `SAFETY_REVIEW` / `in_review` |
| Review decision | `pending` |
| Reviewer / approval timestamp | `null` / `null` in scenario and package |
| Human checklist | All eight items remain false/pending |
| Runtime eligibility | **false — blocked until explicit user approval and subsequent lifecycle promotion** |

## Existing artifacts and models

- `content/scenario-candidates/S-01-hi-IN.json` — `ScenarioDocumentSchema`; outside runtime/catalog directories.
- `content/authoring/S-01-hi-IN.package.json` — existing `SafetyReviewScenarioPackageSchema`; five DRAFT tactic/response records, fifteen examples, five DRAFT debrief variants and one matching importable scenario.
- `content/authoring/S-01-hi-IN.lines.json` — existing Phase 3A `LocalScenarioDraft`; five tactics × three intensity lines, matching runtime scenario/brief, examples/debrief text and saved local preflight.
- `content/safety/review-reference-lists.json` — configured real-organization and operational-phrase references; no fictional-name exemption or allowlist bypass. Detection coverage is configured-list-only, not exhaustive.

Opening and five tactic responses remain `draft`. Fallback/ending use the schema-required `system_safe_template` annotation. That bounded response annotation is separate from human review and does not make the candidate runtime eligible.

## Exact content for human review

### Opening — `system.opening`

Namaste, Northstar Cooperative Bank ke verification desk se bol raha hoon. Aapke demo account ka verification pending hai.

### Fifteen authored tactic lines

| Tactic | Intensity / pressure | Exact text |
|---|---|---|
| urgency | low / 0 | Demo verification pending hai; jab aap ready hon, is practice step par baat kar lete hain. |
| urgency | medium / 1 | Is demo verification ko jaldi close kar lete hain; sirf practice token DUMMY-4821 bolna hai. |
| urgency | high / 2 | Training session expire hone wala hai; sirf DUMMY-4821 token se demo step abhi finish kar lein. |
| authority | low / 0 | Northstar Cooperative Bank ke demo verification desk se ek status update dena tha. |
| authority | medium / 1 | Northstar Cooperative Bank ki demo verification team se hoon; is practice step ka status confirm kar dijiye. |
| authority | high / 2 | Northstar Cooperative Bank ke demo review lead ki taraf se follow-up hai; isi practice call par status mark karna hai. |
| isolation | low / 0 | Is demo review ko filhaal one-to-one handle kar lete hain; independent check ka option khula hai. |
| isolation | medium / 1 | Is practice step mein abhi kisi aur ko include na karein; aap chahein toh independently verify kar sakte hain. |
| isolation | high / 2 | Pehle isi demo call par step close kar lein, phir discuss kar lena; independent verification ko hum nahi rokenge. |
| fear | low / 0 | Demo verification pending rahi toh practice access mein thoda delay ho sakta hai. |
| fear | medium / 1 | Is simulated verification ke pending rehne par demo access thodi der hold ho sakta hai. |
| fear | high / 2 | Training step abhi complete na hua toh is demo session ka access temporarily ruk sakta hai; real account par koi asar nahi. |
| reward | low / 0 | Demo verification complete hone par practice service ka status jaldi mil jayega. |
| reward | medium / 1 | Is practice step ko abhi close karein toh demo service review mein priority mil sakti hai. |
| reward | high / 2 | Is demo call par step finish ho jaye toh simulated benefit review jaldi ho sakta hai; koi real payout nahi. |

### Shared safe terminal — `system.safe-ending`

Independently verify karna safe kadam hai. Is practice call ko yahin khatam karte hain; ab apne response ka debrief dekhein.

The existing policy uses one configured safe ending for independent verification and dummy disclosure. This text states a general safe practice and ends the simulation; it does not claim the learner verified independently after disclosure, praise disclosure or request another token.

### Safe fallback — `system.safe-fallback`

Baat clear nahi hui; pressure badhaye bina practice call yahin rokte hain. Aap known official app ya number se independently verify karein.

### Pressure model and policy mappings

The actual Phase 3A `selectPressureLevels(2)` returns **low=0, medium=1, high=2**. This candidate explicitly uses maximum 2, maximum 3 turns and safe word `stop simulation`. The original canonical draft had no adaptive-policy pressure mapping. The broader schema permits 0–5; its global scale is unchanged.

The fifteen intensity lines are authoring content. The existing runtime representation has **five fixed responses**, one per canonical tactic, each using its medium line and pressure **1**. Low/high variants are not runtime-selected. No intensity-selection feature or policy-engine change was introduced.

| Behavior | Result after a hypothetical approval, tested only in ephemeral fixtures |
|---|---|
| refused / `REFUSED` | Bounded nonterminal tactic at pressure 1; from the initial state, `authority` |
| stalled / `STALLED` | Bounded nonterminal tactic at pressure 1; from the initial state, `authority` |
| complied / `COMPLIED` | Bounded nonterminal tactic at pressure 1; from the initial state, `authority`; no higher-pressure runtime line exists |
| verified_independently / `VERIFIED_INDEPENDENTLY` | `SAFE_VERIFIED`; null tactic; shared ending; no further secret request |
| disclosed_dummy_secret / `DISCLOSED_DUMMY_SECRET` | `DUMMY_SECRET_DISCLOSED`; null tactic; shared ending; disclosure/compliance evidence uses the existing engine |
| unknown / uncertain | `SAFE_FALLBACK`; null tactic; safe fallback; no escalation or invented intent |

Terminal results preserve the current recorded pressure while stopping tactic selection; they do not rewrite history to zero. Initial-state terminal tests return 0, tests starting at pressure 1 remain 1. Safe word, learner end, maximum turns and exhausted tactic history retain existing deterministic guards. Resolver tests cover every fixed tactic response and reject absent, draft and arbitrary references. Current unapproved candidate and canonical DRAFT remain on the draft-safe fallback path and cannot start REAL_STT.

### Red flags

- RF-01 — urgency: short simulated completion window.
- RF-02 — authority impersonation: fictional verification team/desk.
- RF-03 — secrecy: mild one-to-one/current-call pressure, with independent verification explicitly available.
- RF-05 — OTP/PIN-request training analogy: only the explicit `DUMMY-4821` practice token is solicited; no actual OTP/PIN.
- RF-07 — lock/penalty-threat training analogy: temporary simulated demo-access hold/delay.

RF-04 (remote access), RF-06 (UPI/payment credential) and RF-08 (payment/refund bait) are omitted. Recovery removed RF-08 from all matching candidate records because simulated service convenience does not depict payment/refund bait. The reward tactic retains its canonical identity without inventing a red-flag ID.

### Fifteen behavior training examples

Each group has three synthetic, redaction-reviewed examples with train / validation / held-out-test splits respectively. Contract labels are uppercase; authoring outcome identifiers remain the five existing lowercase labels. These authored examples are fixture coverage, not a measured classifier accuracy dataset.

| Behavior | Exact examples |
|---|---|
| refused | Main share nahi karunga.<br>Details nahi dunga; yeh meri practice response hai.<br>Main nahi bataunga; is demo request ko mana karta hoon. |
| stalled | Mujhe sochne do; thoda time chahiye.<br>Abhi sure nahi, ek minute rukna.<br>थोड़ा समय चाहिए, मैं पहले सोचूंगा। |
| verified_independently | Main official channel se verify karunga.<br>Main pehle independently verify karunga.<br>मैं खुद सत्यापन करूंगा। |
| complied | Main agree karta hoon; demo step continue karte hain.<br>Is practice mein main instructions follow karunga.<br>मैं सहमत हूं; यह सिर्फ अभ्यास है। |
| disclosed_dummy_secret | Practice token DUMMY-4821 hai.<br>Sirf demo ke liye DUMMY-0000 bataya.<br>अभ्यास में DUMMY-1234 बताया। |

### Five debrief variants

- **refused:** Observed behavior {behavior} tha; response latency {latency}. Around {timestamp}, request refuse karne ka zikr hua. Known official channel se verify karna safe next step hai.
- **stalled:** Observed behavior {behavior} tha; response latency {latency}. Around {timestamp}, sochne ke liye waqt maanga gaya. Pause ke baad known official channel se verify karein.
- **verified_independently:** Observed behavior {behavior} tha; response latency {latency}. Around {timestamp}, independent verification ka zikr hua aur pressure rok diya gaya. Yeh safe training outcome hai.
- **complied:** Observed behavior {behavior} tha; response latency {latency}. Around {timestamp}, caller ke suggested practice step se sahmati dikhayi. Real requests par pehle independent verification karein.
- **disclosed_dummy_secret:** Observed behavior {behavior} tha; response latency {latency}. Around {timestamp}, dummy token disclosure segment mein mila; word-level time available nahi hai. Practice call rok di gayi. Asli secrets na batayein; independently verify karein.

All three existing placeholders are present. Timestamp wording is approximate. No emotional or personality inference is made. These authoring variants do not replace the existing deterministic runtime debrief engine.

## Validation and guard audit

- Existing structural models parse the scenario and pending package; copies, canonical IDs, medium runtime text, examples and debrief text match.
- Existing Phase 3A local preflight: **PASS**, all nine intentional checks pass; saved result matches recomputation. Missing mandatory safeguards/lines fail, missing brand-reference coverage remains WARNING. Machine PASS is separate from pending human review.
- Existing schema safety scanner: **PASS**, configured-list-only. Generic credential checks were strengthened for contextual PIN text, bare long numeric strings and invalid/legacy DUMMY forms. Only whole uppercase `DUMMY-\d{4}` tokens are runtime disclosure inputs; bare four digits and legacy fixture tokens are not accepted on the real path. No candidate-specific exemption was added.
- API loader applies the existing configured safety scan to released content. It rejects unsafe approved text; existing DRAFT loading remains available for its safe demo behavior. The runtime-eligibility predicate and provider logic are unchanged by this prerequisite.
- CLI replaces the obsolete Phase 1 unconditional approved-content prohibition with existing release/package validation, exact scenario/importable matching, matching tactic/response text, safety scanning and complete S-01 review-record/preflight consistency. Pending artifacts can be validated as candidates while retaining runtime=false. Matching ephemeral released fixtures pass; altered content, pending approval records, missing reviewer, unchecked review, altered responses/examples/debrief, stale preflight and unsafe content fail.
- Focused schema/authoring/policy/candidate tests: **71/71 PASS** on 2026-10-14. First recovery run failed because a new test omitted `learnerText` and child CLI processes inherited a relative tsx config path; harness arguments were corrected without changing runtime behavior. The interrupted stale snapshot now reflects intentional safeguards/completeness checks and passes.
- `npm run validate:scenarios`: **PASS**; three canonical drafts plus one in-review candidate; review=pending, runtime=false.
- Canonical `npm run check`: **PASS**, exit 0 on 2026-10-14; typecheck, lint, **334/334 offline tests**, scenario validation, API/web builds and secret scan all pass. No provider verification command is part of this suite.
- `git diff --check`: **PASS**; no whitespace errors. Final cleanup confirms no generator helpers or validation logs remain.
- Previous Phase 4C.1 baseline: **288 tests**. Prerequisite adds **46** tests in `apps/web/src/s01ReviewCandidate.test.ts`; final count **334**, all passed. No existing tests removed or renamed.

## Files from this prerequisite

Created: the candidate, package, intensity-line record, safety reference list, candidate test file and this evidence report (six files).

Modified: `apps/web/src/authoringDraft.ts`, `packages/scenario-schema/src/safety.ts`, `apps/api/src/health.ts` (release-safety addition only), `scripts/validate-scenarios.mjs`, `package.json` (test inclusion/tsx validator) and `docs/evidence/evidence-ledger.md` (pending review row). Earlier Phase 4C.1 changes in shared files remain preserved and are documented separately.

## Historical prerequisite boundary

**Provider calls made: 0.** No Prisma, Timbre or Evon credits consumed. No physical microphone capture or live acceptance attempted. Phase 4C.1 acceptance remains incomplete; Phase 4C.2 has not started. No commit created.

User must review the exact content above. After explicit approval in a later step, record honest reviewer/time/checklist metadata, promote through existing approval/runtime lifecycle, update matching artifacts and the canonical S-01 slot, and revalidate before any intentional live acceptance. This continuation performs none of those transitions.

SCENARIO STATUS:
READY FOR USER REVIEW

RUNTIME ELIGIBILITY:
BLOCKED UNTIL EXPLICIT USER APPROVAL

## Current handoff

SCENARIO STATUS:
RUNTIME_ELIGIBLE

RUNTIME ELIGIBILITY:
TRUE — EXPLICIT HUMAN APPROVAL RECORDED

LIVE PHASE 4C.1 ACCEPTANCE:
NOT STARTED — SEPARATE USER AUTHORIZATION REQUIRED
