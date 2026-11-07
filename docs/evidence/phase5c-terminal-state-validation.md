# Phase 5C — terminal-state validation

Date: **2026-10-24**. Canonical release: **S-01 v0.2.0 / hi-IN**. Provider calls: **0 Prisma / 0 Timbre / 0 Evon**. Phase 5D has not started.

## Pre-edit audit

Inspected policy/response guards, the approved runtime scenario, session lifecycle and End, conversation acknowledgements, runtime audio ingress and cancellation, caller cache/service/routes, browser conversation ownership, learner capture/reusable microphone, actual worklet and HTML audio release, API serialization, debrief projection, UI labels/controls, and the Phase 4C.3/5A/5B tests/evidence.

The audit was reported before edits. Existing architecture:

1. S-01 declares `SAFE_WORD`, `LEARNER_ENDED`, `SAFE_VERIFIED`, `DUMMY_SECRET_DISCLOSED`, `MAX_TURNS`, `SAFE_FALLBACK`. The wider shared outcome enum also contains `SCENARIO_COMPLETED`, which this S-01 adaptive pool does not emit. STOPPED/ERROR are conversation phases, not new policy outcomes. Session lifecycle uses ENDED_BY_LEARNER/ERROR/COMPLETED.
2. SAFE_VERIFIED, DUMMY_SECRET_DISCLOSED and MAX_TURNS reference **system.safe-ending**. SAFE_FALLBACK references **system.safe-fallback**. The policy's safe-word/explicit-end safety response reference is system.safe-ending, but real-conversation SAFE_WORD stops immediately without fetching/playing another caller line; UI manual End does not call policy or require a line.
3. A natural terminal Finish commits its causal learner event and pressure point, stores the terminal outcome, and enters TERMINAL_CALLER_PREPARING. Browser control auto-fetches the approved asset and plays it. COMPLETED requires actual `playing` then `ended` observations acknowledged by the server. Preparation/provider completion alone is not completion.
4. The conversation controller checks the committed outcome before another learner window. Backend ingress rejects terminal/stopped/error or wrong-phase requests before provider reservation. Policy rejects stale terminal session facts. No UI rerender drives synthesis/turn selection.
5. Final controller cleanup aborts pending local work, stops playback and learner capture, stops the reusable microphone and clears its deadline. Actual capture release stops tracks, closes/disconnects worklet/context, and removes listeners. HTML playback removes handlers/source, pauses and revokes its object URL. Backend End/fail cancels windows and caller requests/assets.
6. Manual End synchronously stops browser resources, then ends the backend session and navigates to debrief. It yields STOPPED/ENDED_BY_LEARNER, with partial debrief only if committed events exist. Natural completion yields COMPLETED/complete. Failures yield ERROR/partial with the last committed facts and typed failure; no fabricated behavior/event.
7. Audit gaps: late start acknowledgements were published before the generation check; a synchronous stop in a committed-turn callback could be followed by CALLER_PREPARING; callbacks from an already-failed player could acknowledge playback before async failure cleanup; End overwrote ERROR, and manual End during terminal playback overwrote the causal outcome. Regression reproductions and fixes are below.

No reviewed scenario text, response identity or policy mapping was changed.

## Terminal matrix

| Trigger | Outcome | Response ID | Audio | Next learner turn | Final state | Debrief |
| --- | --- | --- | --- | --- | --- | --- |
| VERIFIED_INDEPENDENTLY | SAFE_VERIFIED | system.safe-ending | One natural terminal playback | Never | COMPLETED / COMPLETED | Complete, verification evidence, actual per-turn latency, no compliance moment |
| DISCLOSED_DUMMY_SECRET | DUMMY_SECRET_DISCLOSED | system.safe-ending | One natural terminal playback | Never | COMPLETED / COMPLETED | Complete, first synthetic disclosure moment on its causal turn, no real-credential claim |
| UNKNOWN, turns 1–2 | SAFE_FALLBACK | system.safe-fallback | One natural terminal playback | Never | COMPLETED / COMPLETED | Complete fallback, no false verification/disclosure |
| Final turn REFUSED/STALLED/COMPLIED/UNKNOWN | MAX_TURNS | system.safe-ending | One natural terminal playback | Never; no turn 4 | COMPLETED / COMPLETED | Complete bounded outcome, three actual events/points, heard pressure 0→1→1 |
| Manual End | LEARNER_ENDED when no prior causal outcome; otherwise retain it | None requested | Stop active playback immediately | Never | ENDED_BY_LEARNER / STOPPED | Partial if events exist; null otherwise |
| Configured safe word | SAFE_WORD | Policy references system.safe-ending; immediate real-runtime stop takes precedence | No additional caller playback | Never | ENDED_BY_LEARNER / STOPPED | Partial committed-event review under existing architecture |
| Technical failure | Retain a committed causal policy outcome, otherwise null | No required retry/ending | Stop; failed terminal audio cannot count as success | Never | ERROR / ERROR | Partial if events exist; null otherwise; typed failure retained |

Final State lists session lifecycle / conversation phase. No MANUAL_STOP, ABORTED or TECHNICAL_ERROR enum was invented. Verification/disclosure still outrank MAX_TURNS on turn 3. UNKNOWN on turn 3 still follows MAX_TURNS precedence. COMPLIED never fabricates disclosure or a compliance marker.

## Natural completion, exactly once

Representative browser/HTTP tests drive opening → learner speech → actual Finish result → approved terminal asset → playback start → playback end → COMPLETED. They cover first-turn verification/disclosure/UNKNOWN; repeated STALLED, REFUSED and COMPLIED to turn 3; final-turn UNKNOWN, verification and disclosure.

Before terminal playback ends, the session is not COMPLETED and its debrief is `in_progress`. The causal event is already committed exactly once. Duplicate start/end callbacks, repeated controller start/finish/stop/dispose and late microphone/driver callbacks cannot add a player, calibration, stream, event, pressure point or completion callback. A terminal caller line is never a learner event. Pressure points remain one-to-one with learner events and display the preceding caller's pressure.

The controller's single drive and one-use playback object prevent duplicate playback. Per-play `started`, `ended` and `settled` flags reject repeated/stale callbacks. Backend caller-start acknowledges an identical active observation idempotently. Duplicate terminal caller-ended after COMPLETED is safely rejected with INVALID_STATE; it does not mutate the completed state. The browser ignores it before sending another request. No retry loop is introduced.

Terminal cache tests explicitly exercise HIT (zero TTS units/attempts) and MISS (one guarded injected synthesis, one playback). Completed-session caller-audio/start/late-Finish/late-PCM requests are rejected without another STT/TTS reservation. These are project-local units and offline doubles, not provider billing observations.

## Cleanup matrix

| Terminal path | Mic stopped | Caller stopped | Pending requests canceled/ignored | Events preserved | Debrief |
| --- | --- | --- | --- | --- | --- |
| SAFE_VERIFIED | Yes, before terminal asset fetch; final cleanup idempotent | Actual ended handler releases player/source/URL | Abort/generation guards; backend window disposed | Exactly causal turn count | Complete after ended acknowledgement |
| DUMMY_SECRET_DISCLOSED | Same | Same | Same | First disclosure marker only | Complete, synthetic context |
| SAFE_FALLBACK | Same | Same | Same | One first-turn event in representative test | Complete fallback |
| MAX_TURNS | Same | Same | Same; no fourth stream | Three events/points, pressure 0→1→1 | Complete bounded outcome |
| Manual stop | Synchronous stop/release | Stop active player | Abort and generation rejection; End cancels server windows/assets | Existing events only; no synthetic final event | Partial or null |
| SAFE_WORD | Immediate cleanup | No extra terminal player | Learner stream disposed, no further caller work | Safe-word causal turn preserved | Existing partial review |
| ERROR, including terminal audio failure | Cleanup before publishing local ERROR | Stop active player; failed player cannot acknowledge success | Fail cancels backend work; late responses ignored | Committed terminal/nonterminal evidence retained | Partial or null, never fake complete |

The browser tests use controllable driver/player doubles to verify ownership/cancellation. Additional tests execute the **actual capture driver and actual worklet source** with browser API doubles: repeated stop/abort for natural terminal/manual/safe-word/technical release stops the track once, closes the context once, disconnects/closes the worklet once, removes all registered listeners, and produces no subsequent callback. Existing reusable-microphone tests prove nonterminal turn flush does not close those resources early. Existing actual HTML playback tests prove one pause/revocation, source/listener removal and inert stale callbacks.

This is software cleanup evidence. It is not a new physical microphone-indicator observation.

## Manual stop and cancellation stages

Tests stop from READY, caller preparation with a delayed asset response, caller playback, calibration, learner listening, learner finalization with a delayed recognizer result, actual policy resolution, the committed-turn callback, and terminal caller playback. They verify STOPPED, immediate resource release, no completion callback, preserved event/point counts and no stale progression.

- READY End requests no microphone/audio/provider work and commits no event.
- Delayed start/asset responses cannot publish a session or start playback after stop.
- Delayed recognizer Finish cannot commit after End. Actual policy-resolution cancellation is checked again before state/commit progression.
- Stopping immediately after a committed nonterminal event preserves that event for partial review, without the next caller/learner turn.
- Stopping terminal playback preserves the already committed causal outcome, but marks the conversation STOPPED and its review partial. That outcome is evidence of the learner turn; it does not claim playback completed.
- Repeated End is idempotent. End after ERROR now preserves ERROR, failure metadata and partial evidence. End after natural COMPLETED or safe-word ENDED_BY_LEARNER preserves that final state.

## Technical failures

Offline fault injection exercises actual runtime STT failure, actual approved policy resolution failure, actual cache lookup failure, injected TTS transport failure, terminal playback failure, and calibration/driver failure. No provider adapter configuration is altered.

If terminal policy was committed before TTS/cache/playback failure, the causal event/outcome remains and the conversation becomes ERROR, not COMPLETED. If STT/calibration/policy failed before commit, no learner event is manufactured. Previous committed events remain available. Typed cause/stage data survives API/controller propagation. A test injects failure directly into `AdaptivePolicyEngine.decide`; the existing outer transport stage may be STT_FINALIZE while the precise APPROVED_RESPONSE_UNAVAILABLE cause is retained. This phase does not change provider or transport-stage architecture.

## Reproduced defects and minimal fixes

Four initial regression tests **all failed before fixes**:

1. **Late startup session publication:** `drive` called `update(await start)` before checking generation. A delayed start response after stop still invoked onSession. It now checks generation before publishing the response.
2. **Synchronous stop overwritten by next iteration:** after onTurn, the loop could set CALLER_PREPARING even though the callback stopped the controller. The drive now checks generation/abort at the beginning of every iteration.
3. **Settled failed-player callbacks:** a failure settled the play promise, but same-tick playing/ended callbacks could still acknowledge it before the async catch advanced generation. Both callbacks now also check `settled`.
4. **ERROR overwritten by cleanup/End:** controller stop used to change ERROR to STOPPED; backend End used to replace ERROR with ENDED_BY_LEARNER/LEARNER_ENDED. Both preserve final ERROR for automatic conversations. Other runtime modes keep their existing behavior.

The expanded manual-terminal test then reproduced a fifth issue: End during terminal audio replaced SAFE_VERIFIED with LEARNER_ENDED. Automatic End now retains an existing causal terminal outcome, while still marking STOPPED/ENDED_BY_LEARNER and partial. A pure regression also covers disclosure/error preservation.

Production changes are confined to **session.ts and conversationController.ts**. No classifier, policy/pressure mapping, approved scenario text, Prisma/Timbre configuration, event schema, VAD/audio DSP, credit strategy, caller service or debrief rendering/algorithm was changed.

## Exhaustive terminal leaves

The pure lifecycle suite traverses all six behaviors from each reachable nonterminal prefix and stops at terminal, using canonical scenario content, actual engine, canonical event builder/append/projection, conversation acknowledgement function and reviewed debrief templates.

| Result | Count |
| --- | ---: |
| Reachable decisions | 78 |
| Terminal leaves | **66** |
| SAFE_VERIFIED leaves | 13 |
| DUMMY_SECRET_DISCLOSED leaves | 13 |
| SAFE_FALLBACK leaves | 4 |
| MAX_TURNS leaves | 36 |

Every leaf asserts approved terminal response, null active tactic, supported/non-increasing terminal pressure, causal event/point counts, completion only after acknowledgement, deterministic complete debrief, first synthetic disclosure marker where relevant, typed policy/runtime re-entry rejection, idempotent fail/End and preservation of previous events. Fetch/randomness are fail-fast in this traversal. Leaf counts are software cases, not live trials.

Safe-word/manual/technical conditions are additional lifecycle tests; they are not counted as extra six-label policy leaves. Fresh-session tests reset terminal outcome, pressure, event/point histories and playback/clock identity.

## UI and debrief

Mounted StrictMode panel tests cover COMPLETED for each natural outcome, STOPPED for End/safe-word, and ERROR for technical stop. Final panels do not expose start/resume/learner controls and rerenders cannot request a microphone. Existing event-card tests separately assert SAFE VERIFIED, DUMMY SECRET DISCLOSED, SAFE FALLBACK and MAX TURNS labels. Existing app debrief presents explicit complete-versus-partial status and actual outcome/failure; Practice Again navigates to a new pre-call/session flow.

Complete debrief is generated only when conversation phase is COMPLETED. STOPPED and ERROR yield partial; zero committed turns yield null rather than fabricated evidence. Terminal audio adds no event/pressure point. Independent verification has no compliance marker; disclosure has only its causal synthetic marker. Identical event/session facts reproduce identical debriefs, without network/LLM/emotion inference.

## Validation

Focused command:

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/api/src/terminalState.test.ts apps/web/src/audio/conversation.test.tsx apps/web/src/audio/callerPlayback.test.ts apps/web/src/audio/browserCapture.test.ts apps/web/src/audio/reusableMicrophone.test.ts apps/web/src/components/ConversationPanel.test.tsx apps/web/src/components/render.test.tsx apps/api/src/policyTransitions.test.ts apps/web/src/pressureEscalation.test.tsx
```

**44 new tests** over the 833 baseline: 29 browser/API conversation cases, four pure terminal lifecycle cases (one enumerates all 66 leaves), four actual driver/worklet release cases and seven mounted terminal-panel cases. The new API terminal suite is registered in the root normal test command; expanded existing suites already run there.

Final focused group: **305/305 PASS**, exit 0. Full **`npm run check`: PASS**, exit 0; **877/877 tests**. Typecheck, lint, scenario validation (approved S-01 runtime=true), API build, web build and secret scan all PASS. **`git diff --check`: PASS**, with separate clean whitespace checks for the new source/report files. **Provider calls: 0**. Four initial race reproductions failed before their fixes; the expanded terminal-stop regression also exposed the causal-outcome overwrite, then passed after the targeted correction.

The checkout was clean at the start of this phase. Final scope is the ten files listed below; no dependencies, lockfile, approved/review/history content, environment configuration, classifier, policy/pressure mapping, provider, credit/cache service or audio/VAD implementation changed. Temporary test logs were removed after recording results.

## Files changed

- `apps/api/src/session.ts` — automatic End preserves ERROR and an existing causal outcome.
- `apps/web/src/audio/conversationController.ts` — generation/settled guards and ERROR-preserving stop.
- `apps/api/src/terminalState.test.ts` — new exhaustive terminal lifecycle/debrief/reset suite.
- `apps/web/src/audio/conversation.test.tsx` — browser/API terminal, stop-race, fault, cache, no-credit/re-entry tests; optional test-only onTurn hook.
- `apps/web/src/audio/browserCapture.test.ts` — actual driver/worklet final release idempotency.
- `apps/web/src/components/ConversationPanel.test.tsx` — terminal status/control/rerender tests.
- `package.json` — register the new terminal suite only.
- `docs/architecture/session-api.md` — terminal ownership/finalization clarification.
- This report.
- `docs/evidence/evidence-ledger.md` — Phase 5C evidence row.

## Physical evidence, limitations and boundary

- Reused the user-confirmed Phase 4C.3 physical SAFE_VERIFIED evidence: safe-ending auto-played, no third learner turn, microphone stopped and two-event/two-point debrief. No new physical result is claimed. Guards added here preserve the successful active-generation path; offline lifecycle and actual browser-resource-driver regressions validate the changes.
- **New manual browser validation needed: NO** for completion of this offline phase. A new physical indicator/OS-driver check was not performed or made mandatory. Driver/player API doubles do not establish hardware behavior across all browsers.
- Natural terminal audio can still fail due to provider/cache/device conditions; correct behavior is ERROR with evidence, not fabricated success. No reliability or new provider capability/billing claim is made.
- Stateless policy previews still cannot infer omitted lifecycle facts. Actual runtime supplies them and retains backend phase/consent/token guards.
- Generic mock/recoverable state semantics are unchanged. Automatic-conversation ERROR remains final; no resume path was added.
- Phase 5D has not started.

PHASE 5C STATUS:
COMPLETE
