# Phase 5E — runtime invariants / safety validation

Date: **2026-10-26**. Release: approved **S-01 v0.2.0 / hi-IN**. **0 real Prisma / 0 real Timbre / 0 Evon calls**. Phase 5F has not started.

## Pre-edit audit

Inspected scenario eligibility, policy/response resolution, caller catalog/routes/request schemas, event builder/append, orchestrator/session persistence, pressure projection, runtime audio windows/tokens/deadlines, browser learner/conversation/player generations, reusable capture/VAD/buffers, transcript assembly, event-derived debriefs and prior 5A–5D/audio/session tests. The eight-item audit was reported before editing.

- Approved content is enforced at scenario eligibility, policy input/output, approved response/catalog lookup and strict caller-reference API boundaries.
- The orchestrator constructs a learner event, appends it and its pressure point, then persists both. Duplicate turn IDs already failed at append; per-session orchestration queues and capture tokens prevent duplicate finalization from advancing twice.
- Stale work is identified by session, turn, token, clock and browser generation; playback callbacks also have started/ended/settled flags.
- Policy, ingress, orchestration and browser drive enforce max turns; pressure checks distinguish global 0–5, S-01 ceiling 2 and supported runtime levels 0/1.
- Fail/End preserve committed events for partial review; natural completion waits for terminal caller acknowledgement.
- Audit hypotheses were reproduced before production edits: speculative failed-commit fields persisted, append lacked final-state/cap checks, old learner callbacks shared the conversation generation, and a queued old capture deadline canceled by session rather than its own window.

## Invariant catalog

The provider-neutral test helper is `apps/api/src/testing/runtimeInvariants.ts`. Application code does not import it. Checks combine canonical event/point identity, histories, content resolution, terminal metadata, pressure support and debrief source facts. Race/cleanup tests supplement the snapshot checks; not every temporal property can be inferred from one snapshot.

| ID | Invariant | Result / proof |
| --- | --- | --- |
| INV-01 | Only approved runtime-eligible response identities | PASS — catalog/resolver/schema negatives and reachable-response enumeration |
| INV-02 | At most one committed learner event per turn | PASS — ID checks, append rejection and 20-delivery finalization burst |
| INV-03 | Exactly one pressure point per committed event | PASS — snapshot checker and every persisted orchestration update |
| INV-04 | No orphan pressure point | PASS — ordered identity/field agreement; negative checker mutations rejected |
| INV-05 | No event committed after terminal | PASS — new append guard, stale policy/ingress tests and final-state stress |
| INV-06 | No learner turn/window after terminal | PASS — recording/phase/outcome, ingress/drive and stale learner guards |
| INV-07 | No stale callback mutates current session | PASS — generation/controller/settlement and token/window checks |
| INV-08 | Turn N callback cannot mutate N+1 | PASS — old learner notifications, transcripts/playback and real old-deadline replay |
| INV-09 | Turn index never exceeds maxTurns | PASS — policy/runtime plus new append cap, including corrupted nonterminal state |
| INV-10 | Pressure respects global and approved content bounds | PASS — 0/1 reachable, cap2/global5; malformed/unsupported values rejected |
| INV-11 | No indefinite caller/learner loop | PASS — exhaustive bounded sweep, no caller-only replay loop, hard cap |
| INV-12 | Failure preserves committed learner events | PASS — prior-event snapshot comparisons across fault stages |
| INV-13 | Failure creates no learner behavior | PASS — uncommitted history rollback and STT/classification/commit failures |
| INV-14 | Failure creates no pressure point | PASS — prior event/point counts preserved, persistence spy |
| INV-15 | Failure creates no compliance moment | PASS — no disclosure event means no marker; rejected disclosure commits discarded |
| INV-16 | Terminal caller audio creates no learner event | PASS — event/point counts unchanged by duplicate caller acknowledgements |
| INV-17 | Manual End creates no natural outcome | PASS — existing LEARNER_ENDED/STOPPED or preserved causal outcome only |
| INV-18 | ERROR remains ERROR | PASS — repeated stop/End/fail/stale callbacks retain final error |
| INV-19 | New session inherits no previous state | PASS — completed/stopped/error session-A work cannot affect fresh B |
| INV-20 | Cleanup is idempotent | PASS — resource, timer, player, driver, frame and transcript tests |

## Reachable approved content

The new sweep independently traverses all six labels from every nonterminal prefix, using the Phase 5D runner and the new invariant assertions. It collects caller IDs from actual selected/scheduled path records, then resolves each through the real catalog. **Reachable response count: 5.**

| Reachable response ID | Approved status | Runtime eligible context | Tactic / terminal type |
| --- | --- | --- | --- |
| system.opening | system_safe_template | Approved S-01 v0.2.0 | Initial caller, pressure0 |
| authority | reviewed_safe | Approved S-01 v0.2.0 | AUTHORITY, pressure1 |
| fear | reviewed_safe | Approved S-01 v0.2.0 | FEAR_CONSEQUENCE, pressure1 |
| system.safe-ending | system_safe_template | Approved S-01 v0.2.0 | SAFE_VERIFIED / DUMMY_SECRET_DISCLOSED / MAX_TURNS |
| system.safe-fallback | system_safe_template | Approved S-01 v0.2.0 | Earlier-turn UNKNOWN / SAFE_FALLBACK |

System templates retain their existing `not_applicable` human scenario-review status; this report does not fabricate an additional approval. The containing runtime scenario is the approved release. Other authored tactics remain outside initialized bounded S-01 reachability.

Negative tests reject missing/candidate identities, DRAFT, SAFETY_REVIEW, APPROVED-but-not-runtime-eligible content, wrong version/scenario, draft response text, blank text and malformed released metadata with existing typed errors. Earlier 5A/content suites retain archived-draft and contradictory tactic/category/response/pressure/version/text checks. No draft/candidate was promoted or edited.

### Caller text injection

The caller endpoint accepts only a strict turn number and response ID. Browser `text`, `callerText`, voice and approval-reference fields are rejected. The route binds the request to the current session/turn/response; synthesis resolves server content through ApprovedCallerCatalog. The synthesizer receives an approved reference, not browser speech text. Normal typed mock learner input remains an existing classifier input and cannot directly select arbitrary caller text. No new endpoint or synthesis design was introduced.

## Reproduced defects and production fixes

Initial reproductions: **38 cases, 16 PASS / 22 FAIL**. An additional old-server-deadline reproduction failed with **HTTP409 instead of expected200** for the active turn-2 frame. These failures identify four targeted defect groups:

1. **Speculative commit-failure persistence.** Orchestration assigned the next turn number, behavior/tactic history and terminal outcome locally before append. If append rejected, catch persisted that speculative local state, creating a phantom turn/history or verification/disclosure outcome without an event. Runtime catch now reloads the latest persisted session before applying failure handling. Twelve tests cover all six behaviors after 0 or 1 committed turns; rejected classification/output never leaks into turn/history/outcome/pressure fields. Already committed evidence remains exact.
2. **Append terminal/cap boundary.** A well-formed next event could be appended directly after COMPLETED/STOPPED/ERROR, after an already committed terminal decision, or beyond max turns if upstream state was corrupt. The automatic-conversation append boundary now rejects those cases and enforces the cap. The causal terminal event remains allowed when its new turn fields are prepared but it has not yet been appended. Existing valid natural paths retain their semantics.
3. **Stale learner notifications.** The conversation run generation stays constant across learner turns, so an old learner controller's diagnostics could overwrite turn 2 or change a naturally completed UI back to LEARNER_LISTENING. Learner eligibility and notification handling now require the current learner-controller identity; notifications also require an unsettled listener. Old turn/VAD/error/completion notifications are inert.
4. **Stale server deadline canceled the next window.** A window deadline called cancelSession(sessionId). If its callback was already queued when the old timer was cleared, it could cancel a later turn's capture. The deadline now checks its exact token/window identity before disposing that window. The regression delivers turn 1's saved deadline while turn 2's stream is live, then successfully sends/finishes turn-2 audio.

Production changes are limited to **eventLog.ts, turnOrchestrator.ts, runtimeAudioIngress.ts and conversationController.ts**. No classifier semantics, policy/pressure strategy, approved caller text, provider configuration, schema/terminal type or audio/VAD algorithm changed.

## Atomicity and failure contract

`appendLearnerTurnEvent` returns a new event array; pressure projection is assembled immediately afterward. This internal intermediate object is not persisted separately. A spy on **every actual orchestrator store.update** asserts event/point counts match. The final operation persists the paired state. Caller preparation follows that committed result.

Before commit, STT/classification/policy/event validation failure produces no learner event, point, compliance or natural outcome. The new persisted-state reload also discards speculative turn/history fields. Existing inner orchestration can enter its FALLBACK/ERROR failure state; the automatic controller's typed fail acknowledgement finalizes conversation ERROR. Failure-matrix assertions inspect the completed fail path, while commit rejection tests also inspect the inner snapshot before acknowledgement. No technical error is converted to UNKNOWN.

After commit, caller resolution/TTS/cache/fetch/playback failure preserves the event and point. A committed verification may remain the causal terminal outcome while conversation is ERROR and debrief partial; it does not claim successful playback. SAFE_VERIFIED without a verification event is rejected by the invariant checker. The corresponding rule applies to disclosure.

## Failure-injection matrix

All requests/transports are injected doubles and caches use existing isolated temporary fixtures. Each row asserts final ERROR, preserved event/point count, no guessed behavior/compliance, no next learner window and final resource release. Afterward, repeated stop/End and stale player callbacks remain inert.

| Failure stage | Prior committed events | Final state | Fabricated behavior? | Events preserved? | Cleanup |
| --- | ---: | --- | --- | --- | --- |
| A opening approved-reference resolution | 0 | ERROR, 0 events/points | NO | YES | PASS |
| B opening fetch/delivery | 0 | ERROR, 0 events/points | NO | YES | PASS |
| B opening playback | 0 | ERROR, 0 events/points | NO | YES | PASS |
| C learner calibration | 0 | ERROR, 0 events/points | NO | YES | PASS |
| D STT start | 0 | ERROR, 0 events/points | NO | YES | PASS |
| E STT mid-stream | 0 | ERROR, 0 events/points | NO | YES | PASS |
| F STT finalize on turn 2 | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| G classifier on turn 2 | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| G policy/approved-response resolution on turn 2 | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| H continuation approved-reference resolution | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| I continuation TTS | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| I continuation cache lookup | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| J continuation playback | 1 STALLED | ERROR, 1 event/point | NO | YES | PASS |
| K terminal approved-reference resolution | 1 VERIFIED_INDEPENDENTLY | ERROR, 1 event/point | NO | YES | PASS |
| L terminal playback | 1 VERIFIED_INDEPENDENTLY | ERROR, 1 event/point | NO | YES | PASS |

Separate controls prove finalized valid UNKNOWN → SAFE_FALLBACK/COMPLETED with one event, while a technical finalize failure → ERROR with zero events/behaviors. Twelve rejected-commit injections add before/after-first-turn atomicity coverage for each supplied behavior, including UNKNOWN and synthetic disclosure. Fault-injected catalog methods are restored before checking the unchanged approved content; two initial matrix harness failures were this validation/mock overlap, not additional production defects.

## Stale and duplicate callback matrix

| Callback type | Delivered stale / duplicate? | Mutation allowed? | Result |
| --- | --- | --- | --- |
| Recognized transcript / Finish completion | YES, including a 20-delivery concurrent burst | NO duplicate | One policy decision/event/point; stale deliveries reject |
| Event/policy commit delivery | YES, repeated append and duplicate finalized turn | NO | Existing event remains unique; no duplicate next response |
| Turn-1 learner LISTENING / FINISHING / ERROR / COMPLETED notifications during turn 2 | YES | NO | UI, diagnostics and backend state unchanged |
| Old learner/VAD notifications after COMPLETED / STOPPED / ERROR | YES | NO | No state resurrection or additional input |
| Caller playing / ended | YES | NO duplicate progression | Existing identity/started/ended/settled gates; no caller-only loop |
| Turn-1 server capture deadline during turn 2 | YES | NO | New token/stream remains usable |
| Saved cleared conversation/playback/capture/calibration/no-speech deadlines after completion | YES | NO | No state change, completion callback still once |
| Session-A work delivered after complete/stop/error while B starts | YES | NO | A/B state isolated; wrong-session transcript rejected |
| Late PCM / Finish / playback acknowledgement after terminal | YES, existing 5C plus focused regressions | NO | No extra event, response, point or reservation |

Real-runtime operations retain session/turn/token/clock checks; browser work additionally checks generation, controller identity and settlement. Caller started/ended duplicates are idempotent while valid, or safely reject once stale/final. No new retry loop was added.

## Bounds, natural sweep and content count

The new sweep reapplies INV assertions to every prefix using the 5D runner; it does not assume the prior phase's pass proves the new invariants. **79 prefixes including initial / 78 decisions / 66 terminal leaves** are recomputed. Outcome distribution remains **13 SAFE_VERIFIED, 13 DUMMY_SECRET_DISCLOSED, 4 SAFE_FALLBACK, 36 MAX_TURNS**. There are **5 reachable approved caller IDs**.

Repeated REFUSED/STALLED/COMPLIED stays **0→1→1** and ends at MAX_TURNS. All valid paths end by turn 3; no turn 4, caller-only loop or autonomous learner restart is permitted. A corrupted nonterminal max-turn snapshot is rejected by the real recognized-turn boundary before policy, with append as an additional cap. Pressure rejects negative, NaN, unsupported 2, over-ceiling 3 and over-global 6; existing 5A/5B tests cover the remaining malformed values and contextual contradictions. Earlier committed pressure never changes.

## Evidence/debrief preservation

- Events and pressure points retain unique contiguous turn IDs and exact ordered identity/behavior/current/next pressure agreement. Histories match committed events.
- ERROR/STOPPED partial debriefs include committed turns only; zero turns yields null, with no placeholder UNKNOWN/STALLED or future summary.
- Full debriefs use the committed log. Synthetic disclosure has the first causal marker only; a failed/uncommitted disclosure cannot create one.
- Unavailable latency remains null/UNKNOWN, interruption remains unknown, and speech rate remains null without valid duration. No unmeasured 0ms or guessed emotion/behavior is substituted.
- Manual End produces LEARNER_ENDED/STOPPED when no prior causal outcome exists. Existing causal outcomes are preserved without claiming natural completion. ERROR remains ERROR under cleanup/End; STOPPED cannot become COMPLETED and COMPLETED cannot reopen.

## Isolation, resources and cleanup

New tests isolate completed/stopped/error session-A callbacks from fresh session B and reject stale transcript identity across turns/sessions. Existing 5D interleaving and fresh Practice Again tests remain in the full suite. Session identity, pressure, histories, events, points, compliance, terminal/error state and clock scope stay separate.

New timer instrumentation verifies owned long deadlines are cleared after completion, then deliberately invokes their saved callbacks: no resurrection. Existing actual capture-driver/worklet and HTML player regressions verify tracks/context/worklet/listeners/source/object URL release exactly once and safe repeated cleanup. Learner capture drops its old VAD/controller after completion; a fresh VAD begins calibration without prior speech/hangover state.

New PCM tests clear partial resampler/frame buffers and prove a new zero-input window emits zero samples/bytes. Transcript assembler tests prove duplicate segments are idempotent, conflicts fail closed, clear removes previous-turn segments and independent assemblers do not share session data. Existing fake-socket recognizer tests retain lifecycle/cancellation/assembly coverage. No live microphone capture or provider stream is used.

All new pure invariant harnesses make provider/cache/network/credit methods fail if called. Integration fixtures use only isolated in-memory credit ledgers and temporary test caches; no real runtime counters/cache/configuration are changed. Duplicate/stale reservation behavior remains covered by existing credit/caller/ingress regressions in the focused/full suites.

## Validation

**74 added tests** over baseline 912:

- `runtimeInvariants.test.ts`: 46 cases covering commit faults, append defenses, exhaustive/content/schema/identity/bound/measurement/assembly checks and stress.
- `conversation.test.tsx`: 26 cases covering stale learner/deadline behavior, 15 failure stages, final-state/timer stress and UNKNOWN-versus-error controls. Existing fixture options gain isolated STT-start/frame fault injection only.
- `pcm.test.ts` and `vad.test.ts`: one case each for reset/isolation.
- The new test-only invariant helper defines INV-01..20. The normal root test script registers the API suite.

Focused command:

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/api/src/runtimeInvariants.test.ts apps/api/src/policyTransitions.test.ts apps/api/src/terminalState.test.ts apps/web/src/pathMatrix.test.tsx apps/web/src/pressureEscalation.test.tsx apps/web/src/audio/conversation.test.tsx apps/web/src/audio/callerPlayback.test.ts apps/web/src/audio/browserCapture.test.ts apps/web/src/audio/reusableMicrophone.test.ts apps/web/src/audio/pcm.test.ts apps/web/src/audio/vad.test.ts apps/api/src/callerAudio/callerAudio.test.ts apps/api/src/providers/prisma/prismaRealtimeRecognizer.test.ts
```

**Focused: 472/472 PASS**, exit 0. **Full npm run check: PASS**, exit 0; **986/986 tests**. Typecheck, lint, scenario validation (approved S-01 runtime=true), API/web builds and secret scan PASS. **git diff --check: PASS**, including clean separate whitespace checks for both new source files and this report. Provider calls: **0**.

## Files changed in Phase 5E

Production:

- `apps/api/src/eventLog.ts` — automatic terminal and max-turn append guards.
- `apps/api/src/turnOrchestrator.ts` — runtime error handling reloads the latest persisted session.
- `apps/api/src/runtimeAudioIngress.ts` — deadline bound to exact token/window.
- `apps/web/src/audio/conversationController.ts` — learner identity/settled notification and eligibility guards.

Tests/support:

- `apps/api/src/runtimeInvariants.test.ts` — new API/pure invariant suite.
- `apps/api/src/testing/runtimeInvariants.ts` — new test-only catalog/assertions.
- `apps/web/src/audio/conversation.test.tsx` — stale/failure/timer/identity tests and injected fixture options.
- `apps/web/src/audio/pcm.test.ts` — partial buffer reset test.
- `apps/web/src/audio/vad.test.ts` — fresh VAD isolation test.
- `package.json` — register the new API suite.
- This report and `docs/evidence/evidence-ledger.md`.

Start-of-phase SHA-256 comparison confirms exactly these **12 files** (nine existing, three new). Earlier Phase 5C/5D changes were present at the start and are preserved. No dependency/lockfile, environment, approved/review/history scenario, classifier/policy, credit/cache service, provider configuration, audio/VAD implementation, event schema, production UI or debrief algorithm file changed. Temporary validation logs/hashes were removed after recording results.

## Known limitations and phase boundary

- These are software runtime invariants for the approved bounded S-01 release, not classifier accuracy, psychological safety, training efficacy or fraud-prevention claims.
- Faults, transcripts, audio, browser devices and provider sockets are deterministic/injected fixtures. Existing physical 4C.3 evidence remains separate; no new hardware or provider capability/billing result is claimed or required to reproduce these defects.
- The appender is an internal boundary returning a transient event-only object; event/point atomicity is established at orchestration persistence. The in-memory store is not a general transactional database or an authorization surface for arbitrary internal mutation.
- Snapshot checks cannot prove async idempotency alone; the callback/token/deadline stress tests supply that evidence. Inner pipeline failure states and the automatic controller's final ERROR acknowledgement retain the existing ownership split.
- Legacy mock/developer-preview recovery semantics remain unchanged; draft tactics still cannot enter the real approved runtime. No approval/content/provider configuration was changed.
- Local .env is neither read nor changed by this task. Phase 5F has not started.

PHASE 5E STATUS:
COMPLETE
