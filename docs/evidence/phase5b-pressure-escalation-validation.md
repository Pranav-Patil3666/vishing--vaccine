# Phase 5B — pressure / escalation validation

Date: **2026-10-23**. Canonical content: **S-01 v0.2.0 / hi-IN**, existing approved runtime release. Provider calls: **0**. Phase 5C has not started.

## Pre-edit architecture audit

Inspected the approved scenario/review package and authoring variants; `AdaptivePolicyEngine` / `selectAdaptiveAction`; input/output/resolver guards; session initialization, orchestration and event append; event builder, debrief projection and SVG; Phase 5A policy tests/evidence and Phase 4C.3 conversation tests/evidence; scenario contracts and pressure/timing architecture.

| Required audit fact | Actual implementation before Phase 5B edits |
| --- | --- |
| Project scale | Integer 0–5 |
| S-01 ceiling | `adaptive_policy.max_pressure_level = 2`; max learner turns 3 |
| Reachable runtime values | Opening 0, selected tactics 1; maximum observed/reachable 1 |
| Pressure target | `min(max_pressure_level, max(0, currentPressureLevel + (escalating ? 1 : 0)))`; only COMPLIED is in S-01's escalation list |
| Selection | Exclude prior tactic/response IDs; sort eligible tactics by pressure, category, ID; first pressure >= target, otherwise first eligible pressure <= current; select unused approved response |
| Continued sequence | system.opening at 0 → authority at 1 → fear at 1 → MAX_TURNS/system.safe-ending |
| Decrease? | None on a reachable S-01 path; generic selector's lower-pressure fallback does not promise monotonicity for other authored scenarios |
| Jump >1? | None in S-01: 0→1 or 1→1; no approved level-2 runtime line |
| Drivers | Explicit behavior/current state/approved metadata/history only; learner text is used solely for the existing configured safe-word stop |
| Inconsistency | Actual contextual runtime was correct. A stateless preview could accept unauthored current pressure 2 and preserve it on a terminal result because 2 was below the ceiling. This did not make level 2 reachable from a real initialized S-01 session. |

The audit was reported before editing. No approved content/policy disagreement required a content edit.

## Pressure architecture and boundaries

Pressure is authored scenario intensity metadata. It is not a measurement of psychological stress. This phase establishes deterministic software behavior, not training efficacy, fraud reduction or realistic human emotional response.

- Global pressure schema: **0–5**. S-01's approved ceiling: **2**. Actual released S-01 content-supported levels: **0 and 1**.
- All five canonical tactics (`urgency`, `authority`, `isolation`, `fear`, `reward`) have pressure **1**, target REFUSED/STALLED/COMPLIED, and reference their same-named reviewed-safe responses. System opening has no attributed tactic and starts at 0.
- Pool sort order at equal pressure is **authority → fear → isolation → reward → urgency**. Only authority and fear can actually be selected from the initialized three-turn S-01 runtime. Isolation/reward/urgency are authored in the runtime pool but currently unreachable from that initial state before max-turn termination. Artificial pool-exclusion tests are not counted as reachable conversations.
- The separate authoring package contains low/medium/high variants at 0/1/2. Only the approved medium lines are referenced as canonical tactic responses. Other authoring variants are **authored but currently unreachable**; neither the ceiling nor those variants license emitting 2 in the runtime release. Levels 3–5 have no S-01 runtime content support.
- STALLED and REFUSED target the current pressure but still select pressure 1 from the opening because no pressure-0 tactic exists. COMPLIED targets current+1, capped at 2; after authority there is no pressure-2 candidate, so the existing eligible pressure-1 fallback selects fear. COMPLIED remains distinct from dummy-secret disclosure.
- Tactic and response history exclude reuse. The orchestrator stores `policyAction.nextPressureLevel`; it does not add a pressure increment. Session creation initializes 0 (the API can attribute a root response to its actual approved tactic for other scenarios). No pressure variable is shared across sessions.
- Browser UI/controller consumes policy/event facts; it does not choose pressure. Layout converts the explicit integer to a vertical coordinate only.

## Repeated behavior paths

Each table follows actual canonical metadata and existing selection. The final pressure is retained as the last caller intensity heard, not a new terminal tactic. Reason is the existing `AdaptivePolicyAction.reason` value.

### STALLED × N

| Turn | Input behavior | Current pressure | Selected tactic | Response ID | Next pressure | Terminal | Reason |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| 1 | STALLED | 0 | authority | authority | 1 | No | selected |
| 2 | STALLED | 1 | fear | fear | 1 | No | selected |
| 3 | STALLED | 1 | null | system.safe-ending | 1 | MAX_TURNS | max_turns |

### REFUSED × N

| Turn | Input behavior | Current pressure | Selected tactic | Response ID | Next pressure | Terminal | Reason |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| 1 | REFUSED | 0 | authority | authority | 1 | No | selected |
| 2 | REFUSED | 1 | fear | fear | 1 | No | selected |
| 3 | REFUSED | 1 | null | system.safe-ending | 1 | MAX_TURNS | max_turns |

### COMPLIED × N

| Turn | Input behavior | Current pressure | Selected tactic | Response ID | Next pressure | Terminal | Reason |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| 1 | COMPLIED | 0 | authority | authority | 1 | No | selected |
| 2 | COMPLIED | 1 | fear | fear | 1 | No | selected |
| 3 | COMPLIED | 1 | null | system.safe-ending | 1 | MAX_TURNS | max_turns |

All one-, two- and three-turn prefixes are explicit tests. Pressure is non-decreasing on all reachable S-01 paths. Maximum increase is one level (0→1); tactic change at pressure 1 is not another intensity increase. There is no punitive/unbounded behavior-based escalation and no fourth learner turn.

## Mixed paths

| Behaviors | Caller pressures heard | Next pressures | Selected tactics / response IDs | Terminal after turn 2 |
| --- | --- | --- | --- | --- |
| STALLED → REFUSED | 0→1 | 1→1 | authority → fear | No |
| REFUSED → STALLED | 0→1 | 1→1 | authority → fear | No |
| COMPLIED → STALLED | 0→1 | 1→1 | authority → fear | No |
| STALLED → COMPLIED | 0→1 | 1→1 | authority → fear | No |
| REFUSED → COMPLIED | 0→1 | 1→1 | authority → fear | No |
| COMPLIED → REFUSED | 0→1 | 1→1 | authority → fear | No |

Every continuing behavior followed by independent verification or disclosure instead terminates at turn 2, retains pressure 1, emits no next tactic and uses system.safe-ending. These six paths are explicit tests in addition to exhaustive enumeration.

## Terminal handling and precedence

| Input behavior | Learner turn | Current→next pressure | Next tactic | Response ID | Terminal / reason |
| --- | --- | --- | --- | --- | --- |
| VERIFIED_INDEPENDENTLY | 1 | 0→0 | null | system.safe-ending | SAFE_VERIFIED / verified_independently |
| VERIFIED_INDEPENDENTLY | 2 or 3 | 1→1 | null | system.safe-ending | SAFE_VERIFIED / verified_independently |
| DISCLOSED_DUMMY_SECRET | 1 | 0→0 | null | system.safe-ending | DUMMY_SECRET_DISCLOSED / dummy_secret_disclosed |
| DISCLOSED_DUMMY_SECRET | 2 or 3 | 1→1 | null | system.safe-ending | DUMMY_SECRET_DISCLOSED / dummy_secret_disclosed |
| UNKNOWN | 1 | 0→0 | null | system.safe-fallback | SAFE_FALLBACK / no_approved_tactic |
| UNKNOWN | 2 | 1→1 | null | system.safe-fallback | SAFE_FALLBACK / no_approved_tactic |
| UNKNOWN | 3 | 1→1 | null | system.safe-ending | MAX_TURNS / max_turns |
| REFUSED / STALLED / COMPLIED | 3 | 1→1 | null | system.safe-ending | MAX_TURNS / max_turns |

Existing safe-word/explicit learner-end priority is unchanged. Verification and disclosure outrank MAX_TURNS; MAX_TURNS outranks pool selection and UNKNOWN fallback on the final index. Terminal calls never escalate and never retain an active tactic. All reachable terminal results are followed by typed stale-call rejection in tests, without event append or another returned caller response. Existing HTTP/browser regressions additionally reject learner re-entry after completion and ignore stale callbacks; the approved terminal caller line may complete under the established playback gate.

## Current versus next pressure: event and curve proof

`LearnerTurnEventBuilder` copies `session.currentPressureLevel` from the preceding-caller snapshot into `callerPressureLevel`, independently of `policy.nextPressureLevel`. `appendLearnerTurnEvent` validates/appends a new event. `buildPressureTimelinePoint` copies both fields separately. `PressureLatencyCurve` and `PressureTimeline` display **callerPressureLevel**.

Explicit real-constructor/append/projection/SVG tests establish:

| Learner turn | Preceding caller | Event callerPressureLevel | Event nextPressureLevel | Curve pressure |
| --- | --- | ---: | ---: | ---: |
| 1 / STALLED | system.opening | 0 | 1 | 0 |
| 2 / VERIFIED_INDEPENDENTLY | authority | 1 | 1 | 1 |

The SVG polyline is `55,185 545,155`: **0→1**, not 1→1 or 0→0. Repeated continuing behavior through MAX_TURNS renders three points at **0→1→1**; the final event retains the heard fear pressure 1, not a terminal-template zero. Tactic-name substitution and differing next-pressure metadata do not change a plotted current-pressure value. Frozen committed events remain unchanged by every later decision; a newly created session resets pressure, event arrays and tactic history independently.

## Guards and minimal fix

Phase 5A already provided integer/finite/nonnegative/scenario-ceiling checks, full released scenario validation, active tactic/response/pressure agreement, known histories, stale/terminal state rejection and tactic/response output checks.

Phase 5B closes the **stateless unsupported-pressure gap only**:

1. `hasApprovedPressure` derives support from zero (the initial unattributed caller state) and reviewed-safe tactic responses at each authored level. No S-01-specific hardcoded allowed list is introduced.
2. Released adaptive input with unsupported current pressure fails with typed **INVALID_STATE**, including stateless terminal previews. It is not silently clamped or reset.
3. Policy output validation rejects unsupported next pressure with typed **APPROVED_RESPONSE_UNAVAILABLE**, in addition to the existing independent global/ceiling/tactic/response checks.
4. The shared asset resolver keeps existing semantics for opening/ending asset lookups. No selection, terminal-priority, classifier, caller text, approved scenario, audio, provider, credit or orchestration strategy changes were made.
5. Two old review-candidate test fixtures used unauthored pressure 2 for exhaustion/max-turn testing. They now exercise those same outcomes at the actual supported pressure 1. Dedicated new tests assert pressure 2 rejection. An isolated synthetic scenario fixture with approved-schema level-2 tactic content verifies that support is derived from metadata rather than a universal 1 ceiling; it is never written or promoted into canonical content.

Invalid/null/undefined/NaN/infinite/fractional/negative/string pressure, S-01 pressure 2, over-ceiling/global values, corrupt active pressure, unknown tactic/response history, released tactic pressure above ceiling and forged tactic/response/output pressure are tested. The broader schema still supports 0–5 for other appropriately authored scenarios.

This supersedes only Phase 5A's documented legacy-preview allowance for terminal pressure 2. That earlier report remains a historical record of what was validated then.

## No emotion, latency or provider influence

**Emotion inference found: NO. Latency-driven escalation: NO. Transcript-driven escalation: NO.**

The policy input contract has no latency, speech-rate, interruption, emotion or provider timing field. Inspection found no emotion/sentiment/random/time branch in selection. Tests vary ordinary English/Hindi/Hinglish/emotional/dummy-token/long wording with the same supplied behavior and state: decisions are identical. Extra JavaScript latency/rate/interruption/emotion fields are ignored. Built events with very different measured silence, latency, duration, speech rate and interruption still have identical policy actions.

The existing configured `stop simulation` phrase remains an explicit terminal safety override. It can stop a conversation but does not select a stronger pressure/tactic or infer transcript sentiment. It is documented/tested as the exception to ordinary transcript invariance, not removed to satisfy a blanket assertion.

Exhaustive policy tests replace fetch, randomness and Date.now with fail-fast functions. Policy imports no provider, credit, cache, classifier, filesystem or event-log dependency. Event construction/projection is local and does not write cache or reserve credits. Existing compatibility tests use injected offline provider doubles/local loopback only; no actual Prisma, Timbre or Evon request was made.

## Exhaustive reachability results

All six behavior labels are traversed from each reachable nonterminal prefix, depth at most three; paths stop at the first terminal. Each decision/event/projection is repeated three additional times with frozen prior state and compared exactly.

| Count / observation | Result |
| --- | ---: |
| Decision transitions | **78** = 6 + 18 + 54 |
| Behavior-history prefix states including initial and terminal leaves | **79** = 1 + 78 |
| Expandable nonterminal history prefixes, including initial | **13** = 1 + 3 + 9 |
| Distinct pre-decision pressure/tactic/response states, merging behavior histories | **3**: opening/0, authority/1, fear/1 |
| Terminal leaves | **66** = 3 + 9 + 54 |
| Nonterminal outputs | **12** = 3 + 9 |
| Maximum reachable pressure | **1**, within ceiling **2** and schema **5** |
| Reachable pressure set | **{0, 1}** |
| Selected tactics actually reachable | **{authority, fear}** |

Counts are synthetic software cases, not live/physical trials. Artificial invalid input, isolated alternate metadata and stateless pool-history tests are excluded from reachability counts.

## Validation results

New suite: `apps/web/src/pressureEscalation.test.tsx`, **54 new tests**. It uses real canonical content, pure engine/resolver, canonical event builder/append/projection and server-rendered curve. Existing HTTP/browser conversation tests provide orchestration compatibility coverage. The normal root test script registers the new suite.

Focused command:

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/web/src/pressureEscalation.test.tsx apps/api/src/adaptivePolicy.test.ts apps/api/src/policyTransitions.test.ts apps/web/src/s01ReviewCandidate.test.ts apps/api/src/callerAudio/callerAudio.test.ts apps/web/src/audio/conversation.test.tsx
```

**Focused: 303/303 PASS**, exit 0. This includes the new 54-test pressure suite and the unchanged Phase 5A / existing scenario-review, caller-audio and HTTP/browser conversation groups.

**Full `npm run check`: PASS**, exit 0; **833/833 tests**, 54 added over the 779 baseline. Typecheck, lint, scenario validation, API build, web build and secret scan all PASS. Scenario validation explicitly reports approved S-01 runtime=true. **`git diff --check`: PASS**, including a separate whitespace check of both new untracked source/report files. **Provider calls: 0**.

Initial focused execution correctly exposed that the new synthetic disclosure event fixture had omitted its configured dummy token. The fixture now supplies it to the unchanged event builder; no disclosure/event safety gate was weakened. Initial full typecheck found nullable response IDs in the new helper; it now builds the same non-null response history as orchestration. Sandbox loopback restrictions required an approved outside-sandbox offline test run. These were test/environment corrections, not changes to production behavior.

## Files changed in Phase 5B

- `apps/api/src/adaptivePolicy.ts` — metadata-derived supported-pressure guard at policy input/output only.
- `apps/web/src/pressureEscalation.test.tsx` — new pressure, event and curve regression suite.
- `apps/web/src/s01ReviewCandidate.test.ts` — two invalid pressure-2 fixture inputs/expectation changed to supported 1; original exhaustion/max-turn assertions retained.
- `package.json` — register the new suite only.
- `docs/architecture/adaptive-policy.md` — document pressure support guard and its scope.
- `docs/architecture/pressure-curve.md` — distinguish heard/next pressure and current S-01 reachability.
- This report.
- `docs/evidence/evidence-ledger.md` — Phase 5B evidence entry.

The checkout already contained earlier-phase edits. Start-of-phase SHA-256 comparison isolates these eight files: six existing files changed plus the new suite/report. Dependency/lockfile, tracked environment templates, approved/review/history content, provider, classifier, VAD/timing, credit/cache, event schema and production orchestration/UI code remain byte-identical to their starting state. Local `.env` was neither read nor changed. Temporary validation files were removed after inspection.

## Known limitations

- Monotonicity/max step of one and actual 0/1 reachability are proven for this approved S-01 release, not every hypothetical scenario. The generic selector can choose lower approved content in its existing fallback strategy for other metadata. No strategy redesign was made.
- Stateless previews still cannot prove an omitted session's lifecycle or complete history. Actual session orchestration supplies those facts; unsupported pressure now fails in previews as well.
- Terminal pressure metadata preserves the last heard caller intensity; it is not the intensity of safe-ending speech or a psychological measurement.
- No new physical attempt, provider capability, billing fact, timing accuracy, emotion estimate or efficacy result is claimed. Existing user-reported Phase 4C.3 physical evidence is unchanged.
- Phase 5C has not started.

PHASE 5B STATUS:
COMPLETE
