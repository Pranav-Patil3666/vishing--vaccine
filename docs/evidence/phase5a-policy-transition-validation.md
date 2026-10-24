# Phase 5A — policy transition validation

Date: 2026-10-23, Asia/Calcutta.

**PHASE 5A STATUS: COMPLETE**

Scope: deterministic policy validation for the already-approved canonical **S-01 v0.2.0 / hi-IN**. Phase 4C.3 remains complete by the user's physical acceptance confirmation; its history is preserved. This phase used no physical/provider trials and does not start 5B pressure-strategy testing or 5C terminal-system acceptance.

## Pre-edit audit and actual contracts

The audit was reported before production edits. Entry: `AdaptivePolicyEngine.decide(AdaptivePolicyInput)` delegates to `selectAdaptiveAction`. Initial direct calls against the existing compiled engine confirmed the six initial-state mappings below. Existing unit policy coverage chiefly used a synthetic S-97 fixture; S-01 review/runtime and 4C.3 tests covered selected paths rather than a complete direct policy matrix.

`AdaptivePolicyInput` remains a TypeScript interface containing scenario, one existing behavior label, learner-turn index, current pressure, prior tactic/response IDs, learner text, and optional safe-word/end/runtime flags. Runtime guards now validate those facts. Actual session calls also pass `sessionState`, a minimal projection of existing `SessionState` fields: scenarioId/version, currentNodeId, completed turnNumber, lifecycle state, terminalState, currentTacticId and currentResponseId. Its runtime schema is a strict pick from the existing SessionStateSchema. No audio, frames, provider metadata, model/emotion output, credit balance or event log is passed into policy.

The retained learnerText is used only by the existing configured safe-word safety override. Policy does not classify ordinary phrases or inspect dummy-token/emotion wording to choose behavior. The classifier supplies the behavior label. Explicit safeWordDetected and learnerEnded flags remain supported; no classifier/normalization changes were made.

`AdaptivePolicyAction` remains the existing output interface: tacticId/category, pressureLevel, nextPressureLevel, responseId, approved response, decisionCode, reason and nullable terminalState. Terminal boolean is derived as `terminalState !== null`. Output validation uses existing ApprovedCallerResponseSchema, the resolver and the pure `validatePolicyTransition` boundary; no duplicate result/state schema was introduced.

S-01 is a one-node adaptive-pool scenario. The retained current node is **start**; `next_node_id=null` on that root does not mean the session is already terminal. The action supplies the approved next response/tactic or terminal outcome. Existing orchestration maps it to caller preparation or terminal-caller preparation and controls actual playback completion. Policy does not invent a next node or start another learner window.

## Canonical content and metadata

| Fact | Validated value |
| --- | --- |
| Canonical source | `content/scenarios/S-01-urgent-account-verification.json` |
| Version / language | S-01 v0.2.0 / hi-IN |
| Lifecycle / review | RUNTIME_ELIGIBLE / approved |
| Review record | Existing explicit-user approval metadata; full canonical scenario equals `content/authoring/S-01-hi-IN.package.json`'s released scenario |
| Initial response / pressure | system.opening / 0 |
| Tactic IDs | urgency, authority, isolation, fear, reward |
| Categories in that order | URGENCY, AUTHORITY, ISOLATION, FEAR_CONSEQUENCE, REWARD_FAKE_HELP |
| Tactic response IDs | Each tactic references its same-named reviewed-safe response |
| Tactic pressures | All five are 1 |
| Pressure ceiling / turn maximum | 2 / 3 |
| Escalation behavior list | COMPLIED only |
| Terminal caller response | system.safe-ending, system_safe_template |
| Fallback response | system.safe-fallback, system_safe_template |
| Safe word | stop simulation |

Exactly six behavior labels remain: **REFUSED, STALLED, VERIFIED_INDEPENDENTLY, COMPLIED, DISCLOSED_DUMMY_SECRET, UNKNOWN**. No labels, tactics, lines, approvals or response IDs were added or changed.

## Full reachable transition matrix

Each row is a direct engine test against canonical approved content, followed by successful approved-response resolution. Nonterminal responses are `reviewed_safe` with the matching `S-01@0.2.0:<responseId>` reference. Terminal responses are the canonical `system_safe_template` entries. All output response objects preserve scenario/version/language/text identity. “Current” is input caller pressure; both action pressureLevel and nextPressureLevel equal the displayed next value.

| Learner turn / preceding caller | Behavior | Terminal? | Next tactic | Response ID | Current | Next | Decision / outcome |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| 1 / opening | REFUSED | No | authority | authority | 0 | 1 | SELECTED_TACTIC |
| 1 / opening | STALLED | No | authority | authority | 0 | 1 | SELECTED_TACTIC |
| 1 / opening | VERIFIED_INDEPENDENTLY | Yes | null | system.safe-ending | 0 | 0 | SAFE_VERIFIED |
| 1 / opening | COMPLIED | No | authority | authority | 0 | 1 | SELECTED_TACTIC |
| 1 / opening | DISCLOSED_DUMMY_SECRET | Yes | null | system.safe-ending | 0 | 0 | DUMMY_SECRET_DISCLOSED |
| 1 / opening | UNKNOWN | Yes | null | system.safe-fallback | 0 | 0 | NO_APPROVED_TACTIC / SAFE_FALLBACK |
| 2 / authority | REFUSED | No | fear | fear | 1 | 1 | SELECTED_TACTIC |
| 2 / authority | STALLED | No | fear | fear | 1 | 1 | SELECTED_TACTIC |
| 2 / authority | VERIFIED_INDEPENDENTLY | Yes | null | system.safe-ending | 1 | 1 | SAFE_VERIFIED |
| 2 / authority | COMPLIED | No | fear | fear | 1 | 1 | SELECTED_TACTIC |
| 2 / authority | DISCLOSED_DUMMY_SECRET | Yes | null | system.safe-ending | 1 | 1 | DUMMY_SECRET_DISCLOSED |
| 2 / authority | UNKNOWN | Yes | null | system.safe-fallback | 1 | 1 | NO_APPROVED_TACTIC / SAFE_FALLBACK |
| 3 / fear | REFUSED | Yes | null | system.safe-ending | 1 | 1 | MAX_TURNS |
| 3 / fear | STALLED | Yes | null | system.safe-ending | 1 | 1 | MAX_TURNS |
| 3 / fear | VERIFIED_INDEPENDENTLY | Yes | null | system.safe-ending | 1 | 1 | SAFE_VERIFIED |
| 3 / fear | COMPLIED | Yes | null | system.safe-ending | 1 | 1 | MAX_TURNS |
| 3 / fear | DISCLOSED_DUMMY_SECRET | Yes | null | system.safe-ending | 1 | 1 | DUMMY_SECRET_DISCLOSED |
| 3 / fear | UNKNOWN | Yes | null | system.safe-ending | 1 | 1 | MAX_TURNS |

All ordinary nonterminal first-turn behaviors select authority because the unchanged selector sorts eligible tactics by pressure, category, then tactic ID. At equal pressure the current pool order is authority → fear → isolation → reward → urgency. Prior tactic/response history excludes reused options. UNKNOWN has no eligible target in canonical S-01; it is not silently treated as REFUSED.

Only COMPLIED has the authored escalation flag, but REFUSED and STALLED also move 0→1 because all available tactics are level 1. After authority at pressure 1, COMPLIED's target is capped at 2; no pressure-2 tactic exists, so the existing bounded fallback selection chooses an eligible level-1 tactic. No pressure strategy or sort order was changed.

Current reachable runtime levels are **0 and 1**, despite the configured ceiling 2 and broader 0–5 event schema. Contextual input must match the current root/tactic pressure; pressure 2 cannot be invented for that state. Legacy stateless preview helpers retain the pre-existing ability to preserve an explicitly supplied in-cap pressure 2 in a terminal result. That is not an assertion that canonical S-01 has a level-2 spoken tactic or reaches 2 in the bounded runtime.

### Priority, terminal behavior and preserved distinctions

Existing priority remains: valid input/state → safe-word override → explicit learner end → unavailable/disabled adaptive-pool developer fallback → verified independently → disclosed dummy secret → maximum turns → eligible tactic selection / safe fallback. Therefore **UNKNOWN on the last allowed turn is MAX_TURNS/system.safe-ending**, not the earlier-turn fallback. This pre-edit behavior was flagged during the audit and explicitly preserved. Verification and disclosure outrank MAX_TURNS; explicit safety stops outrank ordinary behavior handling.

COMPLIED is nonterminal on turns 1–2 and is never promoted to disclosure by policy. DISCLOSED_DUMMY_SECRET is terminal even at the final index. Policy returns its disclosure outcome without synthesizing compliance timing; the existing downstream event builder remains responsible for its approximate segment-level marker. UNKNOWN and REFUSED produce distinct early-turn outcomes.

All terminal actions have null tactic/category and retain rather than increase current pressure. Their appropriate approved terminal/fallback response may play once under existing orchestration. Re-entry with terminal session facts cannot return another response. Nonterminal actions contain the selected tactic/category, approved response and valid next pressure; the existing current node stays start.

## Gaps found and minimal fixes

1. **Type-only policy inputs:** invalid JavaScript behavior, turn, pressure or history could enter selection. Runtime guards now reject unsupported labels/types and non-integer/non-finite/negative/out-of-cap pressure, prohibited turn indexes and unknown history references. Errors are existing typed INVALID_REQUEST, INVALID_STATE or INVALID_SCENARIO results, not new labels or arbitrary casts.
2. **Missing policy-level session context:** existing outer guards could stop runtime sessions, but a direct policy call had no node/version/terminal facts to inspect. The orchestrator now passes only the existing session projection. Policy rejects stale turn identity, unknown node, mismatched scenario/version, terminal/error/completed lifecycle, inconsistent active tactic/response/pressure, or completed-history disagreement before choosing a response. Any non-null SessionTerminalState, including outcomes not emitted by this S-01 pool, blocks re-entry.
3. **Incomplete output checks:** the shared resolver previously checked current action pressure and tactic attachment but not all next-pressure, language or response-payload identity facts. Both pressure values must now be valid, equal and within the configured maximum. Approved scenario/version/response/text metadata cannot be silently substituted. Released malformed/draft/missing/blank response content fails loudly. Policy-specific validation enforces terminal/tactic exclusivity, decision/outcome consistency, correct terminal response and declared terminal outcomes. Existing generic emergency-safe-fallback behavior is retained; S-01 explicitly declares that outcome.
4. **Shared resolver compatibility:** full regression testing showed the approved-audio catalog also uses the resolver for opening/terminal asset references with lookup metadata, rather than new policy decisions. Terminal/continuation semantics were consequently placed in `validatePolicyTransition`, called by the policy entry point. The resolver retains approved-content/identity/pressure checks for all consumers. No catalog, provider, TTS/cache or browser behavior was changed to accommodate the tests.

There was **no canonical policy/content disagreement requiring a content edit**. The initial three continuing behaviors share the same first tactic; the last-turn UNKNOWN exception and ceiling-versus-authored-level distinction are real current semantics, not discrepancies patched into a new strategy. Approved scenario/review/history files remain byte-identical to their starting state.

### Approval and draft behavior

The canonical-release test locks S-01 version, language, exact six labels/five IDs/categories/targets/response links, pressure and turn settings, terminal responses/outcomes, and equality with the existing approved review package. Emitted IDs are resolved using the actual ApprovedResponseResolver; no provider is involved. Artificially excluded-history pool tests cover all five tactics, without claiming all five can be reached in a three-turn conversation.

Draft/rejected/in-review/not-yet-runtime-eligible scenarios cannot enter adaptive selection. Their longstanding explicit **DRAFT_SAFE_FALLBACK** developer/preview path may return only the system-safe template; it does not confer runtime approval or release a reviewed tactic. The actual normal runtime also rejects ineligible scenario/session content before policy. Archived S-01 v0.1.0 remains non-runtime-eligible. Malformed content claiming to be released is rejected rather than repaired or approved automatically.

## Tests and reproducible results

New test file: `apps/api/src/policyTransitions.test.ts`. **96 new tests** over the prior 683-test baseline. Coverage includes:

- 18 golden transition rows: all six behaviors at first, middle and final learner index.
- Exhaustive reachable-prefix traversal: **78 pure decisions and 66 terminal leaves**; no continuation exceeds turn 3, every result resolves approved content, and attempted post-terminal calls are rejected. These are synthetic policy cases, not physical trials.
- All five authored tactic/response links and exact canonical/review-package drift checks.
- Twenty repeated calls per initial behavior with frozen input/scenario; deep-equal output and no mutation. Fetch, randomness and Date.now are set to fail in the purity test; the module imports no provider/cache/credit/classifier/event-log dependency.
- Known 4C.3 STALLED → authority → VERIFIED_INDEPENDENTLY → SAFE_VERIFIED path.
- Distinct COMPLIED/disclosure and UNKNOWN/refused behavior, with ordinary/raw dummy/emotion wording unable to reclassify a supplied label; the existing safe-word override is tested separately.
- Invalid labels/turns/pressures, every existing terminal-state value, invalid node/version/lifecycle/active-state/history, unapproved/archived content, missing/draft/blank approved responses, undeclared disclosure/max outcomes, forged tactic/category/response/version/text and contradictory terminal metadata.

Pure focused command (no browser/network/provider):

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/api/src/adaptivePolicy.test.ts apps/api/src/policyTransitions.test.ts
```

**103/103 PASS.** The expanded compatibility group additionally ran `apps/api/src/callerAudio/callerAudio.test.ts` and `apps/web/src/audio/conversation.test.tsx`: **201/201 PASS**, using existing offline transports and loopback fixtures only.

Full **`npm run check`: PASS, exit 0; 779/779 tests**. Typecheck, lint, scenario validation (approved S-01 runtime=true), API/web builds and secret scan PASS. **`git diff --check`: PASS. Provider calls during Phase 5A: 0.** No dependency installation or lockfile change.

During implementation, full typecheck caught explicit-undefined optional test fields; previews now omit those fields correctly. Initial broad placement of terminal checks caused existing asset-lookup regressions; the checks were moved to the policy boundary, then the expanded and full suites passed. No existing test or runtime approval gate was weakened.

## Exact files changed

- `apps/api/src/adaptivePolicy.ts` — existing-input guards, session projection validation, output transition checks and approved-resolution hardening; tactic/pressure selection strategy unchanged.
- `apps/api/src/turnOrchestrator.ts` — pass eight existing session facts into the policy call only; no turn-flow changes.
- `apps/api/src/policyTransitions.test.ts` — new direct canonical S-01 suite.
- `package.json` — register that suite in the existing normal test script only.
- `docs/architecture/adaptive-policy.md` — correct stale draft-only/runtime description and document actual boundaries.
- This report.
- `docs/evidence/evidence-ledger.md` — Phase 5A evidence entry.

The broader dirty checkout includes work from earlier phases. Start-of-phase SHA-256 comparison isolates these seven files. Classifier, behavior/event schemas, scenario content/review/history, providers, audio/VAD/DSP/timing, pressure/event/debrief builders, cache/credit/config/environment and package lock were not changed in 5A.

## Known limitations and phase boundary

- Validation concerns the existing approved S-01 deterministic strategy; it is not classifier accuracy, optimal pressure strategy, emotion inference, live provider performance or new physical terminal-system acceptance. No new provider capability or training-effectiveness claim is made.
- The core is stateless. A legacy preview omitting sessionState cannot prove an omitted session's terminal/node/history facts; all actual orchestrated session calls now supply that context. Existing outer consent/audio/session guards remain required.
- Approval relies on the existing lifecycle and review records. The drift test checks canonical content against the released package; no new signing or approval mechanism was introduced.
- The legacy safe-word text check remains an explicit safety exception; no other transcript semantics determine policy behavior. Exhausted or unavailable approved options end safely rather than generating text or retrying indefinitely.
- The configured cap 2 is distinct from authored/reachable tactic levels 0→1. Pressure-strategy changes, additional content/languages/scenarios and deeper escalation/system acceptance remain for their separately authorized phases.

**PHASE 5A STATUS: COMPLETE**
