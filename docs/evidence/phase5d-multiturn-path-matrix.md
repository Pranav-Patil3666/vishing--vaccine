# Phase 5D — multi-turn path matrix validation

Date: **2026-10-24**. Canonical release: **S-01 v0.2.0 / hi-IN**, approved/runtime eligible. Provider calls: **0 Prisma / 0 Timbre / 0 Evon**. Phase 5E has not started.

## Pre-edit audit

Inspected the current policy, released scenario, session/acknowledgement state machines, recognized-turn orchestrator, event constructor/append, debrief/projection/UI timeline, existing Phase 4C.3/5A/5B/5C suites and architecture/evidence documents. Reported the audit before edits:

| Audit item | Current implementation |
| --- | --- |
| Maximum learner turns | 3 |
| Initial pressure | 0; system.opening, no attributed tactic |
| Reachable pressure | 0 and 1; approved ceiling 2, global scale 0–5 |
| Reachable tactics | authority then fear on continued nonterminal paths |
| Natural outcomes | SAFE_VERIFIED, DUMMY_SECRET_DISCLOSED, SAFE_FALLBACK, MAX_TURNS |
| Other boundaries | LEARNER_ENDED/STOPPED, SAFE_WORD/STOPPED, technical ERROR; preserve Phase 5C semantics |
| Event commit timing | After classification/policy/approved reference selection, before caller preparation/playback; preceding caller snapshot supplies heard pressure |
| Runtime path entry | TurnOrchestrator.processRecognizedTurn, then approved caller acknowledgements through applyConversationAction |
| Existing helpers | Private policy, pressure and terminal traversal helpers; selected HTTP/browser conversation flows |
| Coverage gap | No shared full-path signature/matrix comparing complete pure compositions against actual orchestration for every terminal path |
| Possible wording defect | Null opening tactic was described by the legacy turn summary as a safe fallback, irrespective of actual callerResponseId |

Canonical behaviors remain exactly **REFUSED, STALLED, VERIFIED_INDEPENDENTLY, COMPLIED, DISCLOSED_DUMMY_SECRET, UNKNOWN**. No label, tactic, approved content, pressure strategy, terminal meaning, provider or audio/VAD change was made.

## Test architecture and oracle

`apps/api/src/testing/behaviorPath.ts` is a **test-only** runner. It creates a fresh consented session, acknowledges the approved opening using simulated monotonic instants, applies supplied behaviors through the actual policy/resolver, constructs/appends canonical events, updates existing state/history fields, acknowledges the selected caller response, stops at terminal and creates the actual reviewed deterministic debrief. No application module imports it and it is not a new production runtime abstraction.

The golden representative matrix specifies processed turns, current/next pressures, tactics, response IDs, outcome, lifecycle, event and point counts for the approved three-state S-01 path. These golden vectors are assertions only; they do not choose runtime actions. The runner collects actual policy decisions, and the orchestration harness records actual engine invocations and returned branches.

The second execution path uses the **real TurnOrchestrator.processRecognizedTurn** and shared in-memory store, followed by the real conversation acknowledgement function. The classifier boundary receives supplied fixture labels; this phase does not evaluate or redefine classifier semantics. Recognized transcripts, segment identities and timing are explicit fixtures. Dummy disclosure uses only a synthetic DUMMY token; COMPLIED carries none.

Full path signatures compare processed labels, actual tactic/response sequences, heard/next pressures, decision codes/reasons/outcomes, complete canonical events and pressure points, caller scheduling order, tactic/behavior histories, final state/phase and the full deterministic debrief. Operational durations/random legacy summary IDs are excluded; canonical identities are retained. Representative pure paths repeat three additional times with identical fixture identities and deep-equal signatures. Shared-orchestrator traversal and interleaved sessions additionally test state isolation.

### Offline and side-effect guarantees

New path tests use no HTTP/server, network, browser microphone or audio asset. Global fetch/random selection, runtime credit reserve/simulated-charge methods, recognizer transcribe/openStream, synthesizer and cache get/set all fail immediately if invoked. The real orchestrator receives already-recognized fixtures, exercising its existing runtime branch that does not repeat STT/TTS charging or cache work. Each path asserts unchanged complete credit diagnostics and zero session cache counters. No cache is seeded. Existing production credit/consent/content gates are unchanged.

The normal full regression suite also includes earlier local-loopback fixtures; the new Phase 5D matrix itself performs no network work. None of these tests makes real provider requests.

## Representative matrix

Abbreviations: **R** REFUSED; **S** STALLED; **C** COMPLIED; **V** VERIFIED_INDEPENDENTLY; **D** DISCLOSED_DUMMY_SECRET; **U** UNKNOWN. Response **E** is exactly `system.safe-ending`; **F** is exactly `system.safe-fallback`.

Every path begins with approved **system.opening**. The Responses column lists the policy-selected IDs after each learner turn, excluding that opening. Tactics lists selected nonterminal tactics; the final natural action has null tactic. All values below passed direct matrix assertions and full pure-versus-orchestrator comparisons.

| Path | Events | Pressure heard | Tactics | Responses | Final outcome | Final state |
| --- | ---: | --- | --- | --- | --- | --- |
| V | 1 | 0 | — | E | SAFE_VERIFIED | COMPLETED |
| D | 1 | 0 | — | E | DUMMY_SECRET_DISCLOSED | COMPLETED |
| U | 1 | 0 | — | F | SAFE_FALLBACK | COMPLETED |
| R → V | 2 | 0→1 | authority | authority → E | SAFE_VERIFIED | COMPLETED |
| R → D | 2 | 0→1 | authority | authority → E | DUMMY_SECRET_DISCLOSED | COMPLETED |
| R → U | 2 | 0→1 | authority | authority → F | SAFE_FALLBACK | COMPLETED |
| S → V | 2 | 0→1 | authority | authority → E | SAFE_VERIFIED | COMPLETED |
| S → D | 2 | 0→1 | authority | authority → E | DUMMY_SECRET_DISCLOSED | COMPLETED |
| S → U | 2 | 0→1 | authority | authority → F | SAFE_FALLBACK | COMPLETED |
| C → V | 2 | 0→1 | authority | authority → E | SAFE_VERIFIED | COMPLETED |
| C → D | 2 | 0→1 | authority | authority → E | DUMMY_SECRET_DISCLOSED | COMPLETED |
| C → U | 2 | 0→1 | authority | authority → F | SAFE_FALLBACK | COMPLETED |
| R → S → V | 3 | 0→1→1 | authority → fear | authority → fear → E | SAFE_VERIFIED | COMPLETED |
| S → R → V | 3 | 0→1→1 | authority → fear | authority → fear → E | SAFE_VERIFIED | COMPLETED |
| C → S → V | 3 | 0→1→1 | authority → fear | authority → fear → E | SAFE_VERIFIED | COMPLETED |
| R → C → V | 3 | 0→1→1 | authority → fear | authority → fear → E | SAFE_VERIFIED | COMPLETED |
| C → R → D | 3 | 0→1→1 | authority → fear | authority → fear → E | DUMMY_SECRET_DISCLOSED | COMPLETED |
| S → S → S | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| R → R → R | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| C → C → C | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| S → R → S | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| R → S → C | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| C → R → S | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| S → S → U | 3 | 0→1→1 | authority → fear | authority → fear → E | MAX_TURNS | COMPLETED |
| S → manual End | 1 | 0 | authority selected | authority selected, not played | LEARNER_ENDED | ENDED_BY_LEARNER / STOPPED |
| S → caller preparation failure | 1 | 0 | authority selected | authority selected, not played | null; typed CALLER_AUDIO_FAILED | ERROR / ERROR |

The last two rows preserve one committed learner event/pressure point and a **partial** debrief; no second learner event or fake terminal behavior is created. Caller preparation failure is modeled through the existing typed failure boundary, without actual cache/TTS work; detailed real route/player failures were covered offline in Phase 5C.

### Current versus next pressure

- One-turn natural terminal paths: heard `[0]`, next `[0]`.
- Two-turn natural paths: heard `[0,1]`, next `[1,1]`.
- Three-turn natural paths: heard `[0,1,1]`, next `[1,1,1]`.
- Partial S → stop/error: heard `[0]`, next `[1]`; authority was selected but the path stopped before that caller played.

The orchestrator/event log stores the pressure heard before each learner response. Next pressure is a separate decision field. Terminal response metadata never replaces the final heard value. No level 2 line/state is invented merely because the scenario ceiling is 2.

## Exhaustive bounded traversal — recomputed

The traversal starts at the empty initial path, tries exactly the six behaviors from every nonterminal prefix, and stops at first terminal. Counts are recomputed and printed as sanitized test diagnostics. Expected tree bounds are derived from behavior count, observed continuing branch count and approved max depth; historical totals are not used as traversal inputs.

| Measure | Actual result |
| --- | ---: |
| Explored prefixes including initial empty state | **79** |
| Nonempty decision prefixes / shared-tree transitions | **78** |
| Expandable prefixes including initial | **13** |
| Reachable complete paths | **66** |
| Terminal leaves | **66** |
| Maximum path depth | **3** |
| Maximum pressure heard | **1** |
| Terminal paths of length 1 / 2 / 3 | **3 / 9 / 54** |
| Learner commits when all 66 complete paths execute independently through the real orchestrator | **183** = 3×1 + 9×2 + 54×3 |

Every complete path, not only the representatives, is compared against actual orchestration. These are **software fixture counts**, not physical trials or provider attempts. Shared-tree transitions and independent replay commits are different denominators.

| Outcome | Number of reachable terminal paths |
| --- | ---: |
| SAFE_VERIFIED | **13** |
| DUMMY_SECRET_DISCLOSED | **13** |
| SAFE_FALLBACK | **4** |
| MAX_TURNS | **36** |
| Total | **66** |

UNKNOWN on turns 1–2 produces SAFE_FALLBACK; UNKNOWN on turn 3 retains MAX_TURNS precedence. Verification and disclosure keep their own outcomes on the final turn. All nine valid two-turn continuing prefixes are exercised with every possible third behavior. No impossible post-terminal suffix is counted as reachable.

## Path invariants and agreement

For each natural complete path, assertions verify:

- Processed labels are the supplied prefix ending at the first terminal; turn indexes/identities are exactly 1..N, unique and session-scoped.
- Learner event count equals processed turns, pressure-point count and debrief summary count, bounded by max turns.
- Heard pressure equals the immediately preceding caller state; the following event inherits the prior policy's next pressure/tactic/response.
- Every selected response resolves through the existing ApprovedResponseResolver to approved S-01 content with matching tactic/pressure/identity/version. No candidate/draft content is selected.
- Caller schedules are exactly opening then one selected response per accepted turn, in order and after the corresponding event count. Terminal response appears once; caller acknowledgements do not add/mutate learner events.
- Tactic/response/behavior histories agree with actual decisions and canonical events; continuing paths select authority then fear without stale repetition or an unexpected fallback.
- Natural paths finish COMPLETED only after the simulated terminal playback acknowledgement; outcome is the canonical session field, not a UI inference.
- Debrief sourceTurnIds, ordered summaries, behavior labels, pressure timeline, verification count, synthetic compliance marker and terminal outcome agree with committed events. Full debrief objects match the pure runner exactly.
- COMPLIED alone has no disclosure marker. DISCLOSED_DUMMY_SECRET has exactly the first causal synthetic marker. No later verification can follow an already-terminal disclosure.
- Timing anchors increase chronologically across caller/learner windows. Fixture response latency is 400/500/600 ms by turn; these are synthetic inputs, **not measured user/provider latency**.

Server-rendered full and compact timeline tests use the actual orchestrated pressure points to verify ordered turn cards, behavior text, heard-pressure labels and NEXT/terminal headings. No UI code or event data was changed to satisfy them.

## Short circuit, duplicates and isolation

Explicit suffix tests supply S→V→C, C→D→V, U→V, R→U→C and S×3→V. Only the valid prefix is processed; ignored suffixes cause no policy, response or event progression. Actual completed-session policy re-entry rejects typed invalid state. Max turns prevents turn 4.

Two concurrent deliveries of the same recognized transcript/timing to the actual orchestrator produce exactly one successful turn, one policy decision, one event and one point; the stale queued delivery rejects. No credit/provider/cache operation occurs.

All 66 complete paths run sequentially on one shared orchestrator with fresh session state. An additional test interleaves C→D and S→V on distinct sessions/clocks: histories/events remain separate, earlier events are unchanged, disclosure does not leak into the verified session, and identities differ. A fresh practice session starts at turn 0/pressure 0 with empty histories/events/points, null terminal outcome and null debrief. No audio state/resource exists in this test runner to leak.

## Confirmed defect and fix

The initial new suite passed **34/35 tests**. The one failing test proved that the legacy `observedEvents[0].callerTesting` said:

> No previous adaptive tactic was active; the system-safe fallback was used.

The actual preceding caller was **system.opening at pressure 0**. Canonical learner events and the main deterministic debrief already matched actual path state; only the legacy descriptive summary was wrong.

`turnOrchestrator.ts` now describes the recorded `currentResponseId`/pressure when no tactic is attributed. The existing tactic description is retained for subsequent authority/fear turns. The old fallback wording remains only for contexts with no attributed tactic **and no current response identity**. This is a minimal description correction; no policy, state composition, approved speech, pressure, terminal mapping, classifier, provider or audio logic changed.

No canonical content/policy mismatch was found and no approved content was edited. All other complete-path comparisons passed before this correction.

## Validation results

New suite: `apps/web/src/pathMatrix.test.tsx` — **35 tests**: 24 natural representative rows, one exhaustive comparison, five suffix cases, two partial paths, one duplicate delivery, one isolation/reset and one legacy-summary regression. New runner: `apps/api/src/testing/behaviorPath.ts`.

Focused command:

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/web/src/pathMatrix.test.tsx apps/api/src/policyTransitions.test.ts apps/web/src/pressureEscalation.test.tsx apps/api/src/terminalState.test.ts apps/api/src/turnOrchestrator.test.ts
```

**Focused: 198/198 PASS**, exit 0. **Full npm run check: PASS**, exit 0; **912/912 tests**, 35 added over the 877 baseline. Typecheck, lint, scenario validation (approved S-01 runtime=true), API build, web build and secret scan all PASS. **git diff --check: PASS**, with separate clean whitespace checks for both new source files and this report. Provider calls: **0**.

## Exact files changed in Phase 5D

- `apps/api/src/testing/behaviorPath.ts` — new test-only pure path runner, fixtures and signature.
- `apps/web/src/pathMatrix.test.tsx` — representative/exhaustive orchestration, event/debrief/UI, suffix/duplicate/isolation tests.
- `apps/api/src/turnOrchestrator.ts` — legacy opening-response description correction only.
- `package.json` — register the new test suite only.
- This report.
- `docs/evidence/evidence-ledger.md` — Phase 5D evidence row.

The starting checkout already contained Phase 5C changes. Start-of-phase SHA-256 comparison confirms exactly these six Phase 5D files: three existing files changed and three new files. Existing Phase 5C files/history are preserved. No dependency/lockfile, environment, approved/review/history scenario, classifier/policy, credit/cache, provider, browser audio/VAD, debrief algorithm, event schema or production UI change was made. Local .env was neither read nor changed. Temporary validation files were removed after recording results.

## Known limitations and next-phase boundary

- This phase validates composition for the approved bounded S-01 release and six supplied behavior labels. It is not classifier accuracy, pressure optimization, a new scenario/language, training efficacy or provider benchmarking.
- Caller playback is a simulated acknowledgement here, not decoded/heard audio. Existing Phase 4C.3 physical evidence and Phase 5C offline cleanup/player coverage remain separate evidence; no new physical result is claimed or needed for this description-only production fix.
- Partial failure is injected at the existing typed boundary; actual cache/provider/player error behavior remains covered by Phase 5C. No new provider capability/billing claim is made.
- Repeat comparison excludes operational telemetry/random legacy IDs but retains canonical event identities, ordering, complete debrief and state histories. Stateless previews still cannot prove omitted external session facts.
- No new public provider configuration, reserve, cache seed or browser microphone request was used. Phase 5E has not started.

PHASE 5D STATUS:
COMPLETE
