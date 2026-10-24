# Phase 4C.3 — bounded multi-turn S-01

Initial implementation: 2026-10-18, Asia/Calcutta. Completion confirmation: 2026-10-21.

**PHASE 4C.3 STATUS: COMPLETE.**

The user confirmed successful physical two-turn acceptance on 2026-10-21. The final presentation-only turn-heading correction and full validation also passed; see the completion entry below. Earlier INCOMPLETE/pending statuses and failed attempts are retained as dated history. No unprovided session ID, timing or usage measurement is inferred. Phase 5/6 has not started.

## Prerequisite and scope

The user explicitly confirmed on this date that Phase 4C.2 is completed and all its physical checks are completed. That is user-reported acceptance, not a new agent observation. Its historical pending/probe records are retained in `phase4c2-real-caller-voice.md`; no missing numerical measurements were inferred.

The canonical S-01 remains version 0.2.0, hi-IN, reviewed/approved and runtime eligible. Its reviewed content, authoring package, approval/history files, classifier, adaptive policy, Prisma/Timbre adapters, framing, and VAD thresholds have not changed in this phase. No provider documentation or capability has been newly marked VERIFIED by these offline tests.

## Implementation, state machine and bounds

`REAL_CONVERSATION` is an explicit development-only S-01 mode. Existing mock typing and the single-turn real-STT diagnostic remain available.

```text
IDLE → CALLER_PREPARING → CALLER_PLAYING
     → [actual browser ended + backend acknowledgement]
     → LEARNER_LISTENING → LEARNER_FINALIZING
     → [whole transcript → classifier → policy → one canonical event]
     → CALLER_PREPARING …

terminal policy → TERMINAL_CALLER_PREPARING → TERMINAL_CALLER_PLAYING
                → [actual browser ended] → COMPLETED → automatic debrief

safe word / End → STOPPED (immediate cleanup; no further caller audio)
technical failure → ERROR (typed code; committed events retained; partial debrief)
```

The browser has one session controller, one granted microphone stream, one monotonic origin and one UUID audio clock. Backend lifecycle acknowledgements validate session, current caller position/response, clock, phase and chronological order. STT cannot start before actual ended acknowledgement. Each learner controller borrows a turn-scoped lease of the stream; existing quiet calibration occurs before caller playback while caller preparation runs. Caller samples are discarded, never queued for Prisma. Listening starts automatically after ended acknowledgement and provider readiness. No normal manual Play/Finish/next-turn button is involved.

The scenario's authoritative **maximum is 3 learner turns**, pressure cap 2. All five approved tactics currently have pressure 1; the opening is pressure 0. An actual three-turn path is therefore **0 → 1 → 1**, not an invented 0 → 1 → 2. The chart retains the broader 0–5 scale. A 600,000 ms session clock bound and existing bounded learner/provider/caller deadlines prevent an indefinite loop.

Terminal conditions remain the existing policy: SAFE_VERIFIED, DUMMY_SECRET_DISCLOSED, MAX_TURNS, SAFE_FALLBACK/no approved tactic, SAFE_WORD, and explicit LEARNER_ENDED. Specific safe-word/End stops take precedence over playing terminal audio. Technical codes are CALLER_AUDIO_FAILED, LEARNER_AUDIO_FAILED, PROVIDER_FAILED, CREDIT_LIMIT_REACHED, TURN_LIMIT, SESSION_TIMEOUT. Credit denial is distinguished from a generic audio failure; no retry is automatic.

## Identity, commit and transcript handling

- Turn identity is `${sessionId}:turn-N`; caller position N−1 must belong to the immediately preceding approved response.
- Finish waits existing bounded Prisma final-segment settle; whole-turn aggregation, Unicode preservation and segmentation guards remain unchanged.
- Classification and policy select only existing approved response IDs. TTS begins only after the event commit is received, never speculatively from a partial transcript.
- Exactly one learner event and pressure point per committed learner turn. Opening and terminal audio create no extra learner events.
- Concurrent Finish requests share their in-flight result; late Finish is rejected. Duplicate playback callbacks settle once; backend duplicates are idempotent or rejected without advancing. Generation/abort guards discard stale capture, provider, playback and error acknowledgements, including after End/navigation.

## Timing, pressure, compliance and debrief

Each event retains its own immediately preceding caller start/end and learner VAD start/end on the shared browser clock. Response latency is that event's learner start minus caller end. Caller fetch/synthesis/provider timestamps are not learner timing anchors. Provider timestamps remain reference metadata. Provider setup may contribute to elapsed caller-end-to-speech time; this is not a psychological reaction-time or first-transcript service-latency claim.

Pressure changes only through existing deterministic policy. The first synthetic dummy-secret disclosure sets the one compliance moment, at approximate segment precision; no disclosure means no marker. Interruption remains UNKNOWN/unvalidated; caller playback samples are discarded, so barge-in is not claimed.

Backend debrief construction reads the full canonical ordered event log. Automatic mode loads the existing APPROVED debrief variants only after validating the approved package against the exact canonical scenario. Each matching behavior variant renders its own `{behavior}`, `{latency}` and `{timestamp}`. Unknown/unavailable values remain explicit; UNKNOWN has no invented approved variant and retains the existing deterministic factual summary. The result includes complete/partial/in-progress status and terminal outcome. No transcript, LLM or network is needed to generate it.

The SVG curve renders one ordered pressure point per learner event, y=0–5, x=turn, associated per-event latency, and one first-compliance marker. Null latency is labeled unavailable, never plotted as zero or substituted with another turn. The detailed timeline/table retain each behavior, policy, latency and timing availability.

## Cleanup, cache and credit behavior

Actual terminal playback end, safe word, End, error, timeout or navigation closes the microphone stream/worklet/context and caller playback, revokes blob URLs, clears timers/listeners/PCM and cancels pending requests/provider streams. No next learner turn starts after a terminal policy. A reload cannot reconstruct a physical audio clock; a started session must be ended and a fresh session created.

The existing approved-reference/cache/Timbre path is reused. Hits cost no provider call; each unseen approved line requires one guarded synthesis. No arbitrary TTS, pre-rendering, provider retry, mock transcript, or runtime LLM was introduced. Existing STT/TTS per-operation in-memory reservations and configured prior TTS usage remain authoritative project-local guard inputs; they are not durable account-wide billing or Gnani billing units. Do not reset prior usage to force a run.

Sanitized local readiness inspection (no provider request): Prisma and Timbre configured; CREDIT_CAP=2, RESERVE_CAP=0, STT_COST_UNITS=1, TTS_COST_UNITS=1, configured prior TTS use=1. Opening and safe-ending cache files are present; authority is absent. With those inputs the guard permits two STT windows and one authority synthesis. Cache validity is rechecked on actual use. Prior usage must reflect the user's completed 4C.2 work; if it is stale, reconcile it locally and ensure the chosen allocation permits the one missing line before acceptance. No environment values or caps were changed by this phase.

Implementation provider attempts: **Prisma 0, Timbre 0, Evon 0. Physical microphone sessions: 0.** Offline fake providers use temporary caches, never the live cache. Live acceptance counts/hits remain pending.

## Offline validation

Baseline: **565 tests**. Added **32** offline tests in `apps/web/src/audio/conversation.test.tsx`; focused **32/32 PASS**, full suite **597/597 PASS** (0 failures, skipped or cancelled).

Coverage includes actual canonical S-01 two turns STALLED→VERIFIED; three turns REFUSED→STALLED→VERIFIED; repeated COMPLIED stopping at 3; turn-two disclosure and first compliance; UNKNOWN fallback; provider timestamp non-authority; wrong clock/caller/timing; pre-ended STT denial; concurrent/late Finish; duplicate/stale ended; End during caller/listening/provider settle; automatic terminal playback boundary; one microphone/shared clock; caller samples discarded; caller delivery/playback/STT/microphone/credit failures; prior committed-event preservation; timeout; new-session identity; cache reuse/provider counts; reviewed per-turn placeholders/nulls; deterministic debrief; three-point synthetic 0/1/2 curve with null and one compliance marker.

Initial offline failures exposed test-fixture issues: the synthetic driver emitted faster than the existing eight-frame transport bound, and the credit fixture assumed one shared STT/TTS allocation. Audio pacing and positive per-operation fixture costs were corrected without weakening production bounds/credit gates. Final focused pass is 32/32. Historical live attempts from earlier phases remain untouched.

## Physical acceptance — one controlled two-turn session

**READY FOR LIVE 4C.3 ACCEPTANCE**

From `D:\vishing--vaccine`, use two PowerShell terminals (or the already running updated development processes):

```powershell
# TERMINAL 1 — API
npm run dev:api
```

```powershell
# TERMINAL 2 — WEB
npm run dev:web
```

Browser route: `http://127.0.0.1:5173/#/training/precall/S-01`.

1. Select **Automatic S-01 conversation · maximum 3 learner turns**, review the consent and click **Start simulation**.
2. In **Automatic S-01 conversation**, click the enabled **Start automatic conversation** button. The pre-call consent plus this explicit microphone-start gesture is used; no second checkbox is required. Grant browser microphone permission. Wear headphones and remain quiet during preparation/calibration.
3. Opening `system.opening` should play automatically. Wait for it to finish and for **LEARNER LISTENING**.
4. Turn 1: say **“थोड़ा समय चाहिए।”** (`Thoda samay chahiye.`). Pause for local VAD and Prisma finish. This native-script phrase is tested as STALLED. Do not click a Play button.
5. The committed event should select **authority** at pressure 1. Expected automatic caller line: **“Northstar Cooperative Bank ki demo verification team se hoon; is practice step ka status confirm kar dijiye.”** It should play without interaction. Wait for actual end and **LEARNER LISTENING** again.
6. Turn 2: say **“Main independently verify karunga.”** Expected behavior VERIFIED_INDEPENDENTLY and terminal SAFE_VERIFIED.
7. `system.safe-ending` must auto-play: **“Independently verify karna safe kadam hai. Is practice call ko yahin khatam karte hain; ab apne response ka debrief dekhein.”** Only after its actual end should COMPLETED and the debrief appear automatically. No third learner window.

### Expected versus observed

| Fact | Expected | Actual physical observation |
|---|---|---|
| Session/clock | One session, one browser clock | PENDING |
| Learner events/pressure points | Exactly 2 / 2 | PENDING |
| Labels | STALLED, VERIFIED_INDEPENDENTLY | PENDING |
| Caller IDs | system.opening → authority → system.safe-ending | PENDING |
| Pressure by learner turn | 0 → 1 | PENDING |
| Local caller playback durations | Actual playing→ended for all 3 lines | PENDING |
| Learner response latencies | Own preceding caller end for turns 1 and 2 | PENDING |
| Terminal | SAFE_VERIFIED; COMPLETED after final ended | PENDING |
| Debrief | Automatic, both events/own timing, two curve points | PENDING |
| Cleanup | Mic indicator off, no audio/pending turn/streaming | PENDING |
| Provider/cached assets | Each caller source/cache hit, synthesis/recognition counts | PENDING |

Return the session ID and confirmation that all three caller lines were heard automatically, the two event rows/curve, and final outcome. If anything differs, include both sanitized `real-audio/finish` response bodies and final session response from Network, plus **Technical audio facts** (copy before automatic navigation if needed). These contain caller metadata (cache/source/media duration/local start/end), and each Finish contains that turn's own timing and provider service timing. Do not send authorization headers or keys. Browser technical facts are ephemeral on navigation; the final canonical learner events retain their preceding playback anchors. Record closing playback duration from the final `conversation/caller-ended` response's caller start/end if needed.

After terminal audio confirm: browser microphone indicator gone; caller silent/inactive; no further `real-audio/start`/frame/finish requests; no pending turn; no late playback; COMPLETED. The app should navigate to the debrief without another click. First-transcript service times of about 10–13 seconds were reported in prior samples; record the new actual values separately from local response latency, with no p95/general performance claim.

If the run fails, keep its session/output and exact failure point. Do not edit state/event JSON or overwrite failed evidence. Fix the observed cause before a deliberately authorized retry.

## Files changed in this phase

Scope checked against a file-hash snapshot taken before this turn: **9 created, 20 modified**. Temporary verification scripts/logs/snapshot are removed after recording results.

Created:

- `packages/contracts/src/conversation.ts`
- `apps/api/src/conversationRuntime.ts`
- `apps/api/src/conversationDebrief.ts`
- `apps/web/src/audio/conversationController.ts`
- `apps/web/src/audio/reusableMicrophone.ts`
- `apps/web/src/audio/conversation.test.tsx`
- `apps/web/src/components/ConversationPanel.tsx`
- `apps/web/src/components/PressureLatencyCurve.tsx`
- This evidence report.

Modified:

- `packages/contracts/src/{domain,index,browserAudio,callerAudio,pressure}.ts`
- `apps/api/src/{health,session,turnOrchestrator,runtimeAudioIngress,eventLog}.ts`
- `apps/api/src/callerAudio/routes.ts`
- `apps/web/src/{App.tsx,sessionApi.ts}`
- `apps/web/src/audio/{controller,errors,transport}.ts`
- `apps/web/src/components/PressureTimeline.tsx`
- `package.json` (adds only the new offline test to the existing explicit test list)
- `docs/evidence/phase4c2-real-caller-voice.md` (user completion confirmation)
- `docs/evidence/evidence-ledger.md` (append-only new entries)

Existing uncommitted changes from previous phases were preserved. No approved content, policy/classifier, provider contract/adapter, `.env`, dependency/lockfile, or VAD threshold changes. No Phase 5/6 work. No commit created.

## Final validation result

Full `npm run check`: **PASS**, exit 0. Typecheck, lint, all 597 offline tests, scenario validation, API/web/package builds and secret scan passed. Canonical S-01 and its review package remain approved, runtime=true. No frontend credential values detected. Root `.env` remains gitignored and unchanged.

`git diff --check`: **PASS**, exit 0.

**Remaining completion blocker:** user physical two-turn automatic conversation and evidence above. Debrief generated and cleanup confirmed physically: **NOT YET OBSERVED**. All live durations, response latencies, exact transcript-derived behaviors and cache/provider counts remain pending until that run.

## Physical turn-zero startup blocker and correction — 2026-10-19

### Reported failed attempt (preserved)

The user selected automatic mode, accepted pre-call consent and clicked Start simulation. The training page showed READY, a session ID, the automatic panel and 0/3 committed turns, but no reachable Start automatic conversation control. A later panel state showed STOPPED at 0/3. No microphone permission, calibration, opening playback or learner turn occurred. This is one user failure report; the exact session ID and physical attempt count were not supplied. No Prisma/Timbre connection or classifier result is inferred.

### Root cause and inspection

`main.tsx` mounts the app inside React StrictMode. Its development effect replay runs the panel's setup → cleanup → setup cycle. The old panel cleanup called `instance.dispose()`. Old `dispose()` called `stop()` even for an untouched IDLE controller, publishing a STOPPED snapshot through the still-live React callback. The replacement controller began in IDLE, but setup never published that fresh snapshot. Thus the panel kept STOPPED while the backend session correctly remained READY/IDLE. Its `state === "IDLE"` render branch then omitted the start button entirely.

There was a second unnecessary gate: the button was initially disabled by a separate local `consent=false` checkbox even when pre-call session consent was already granted. The explicit start click now authorizes microphone preparation under that existing session consent.

Inspection traced `App.tsx` PreCallPage → startSimulation → API createDemoSession(runtimeMode=REAL_CONVERSATION, demoMode=false) → grantConsent → setSession → live navigation → LiveCallPage → ConversationPanel. Automatic-mode propagation and consent handoff were correct. Backend `createSessionState` initializes conversation.phase=IDLE; `transitionConsent` sets state=READY, consent=granted. End sets STOPPED; backend start requires READY/IDLE. No backend lifecycle change is needed. There was no named startAutomaticConversation handler previously; the button used an anonymous `controller.current?.start()` callback. No CSS hiding, provider readiness, credentials, classifier or policy caused this entry failure.

### Exact before/after entry conditions and handler

Before:

```text
render CTA iff (snapshot?.state ?? IDLE) === IDLE
disable iff !localCheckboxConsent || initialSession.conversation.phase !== IDLE
            || session.consent.status !== granted
```

After:

```text
untouched controller setup publishes its own IDLE snapshot
cleanup suppresses callbacks from the old instance
disposing an unused controller does not publish STOPPED or end a session

render CTA while the current controller is IDLE
enable iff runtimeMode=REAL_CONVERSATION && session.state=READY
           && session.consent.status=granted && conversation.phase=IDLE
           && turnNumber=0 && terminalState=null
display READY in this untouched READY session
```

Missing consent or another failed eligibility condition keeps the button disabled with an accessible explicit reason. Existing terminal session phases override local display. The controller independently checks eligibility, current IDLE state, session ID and a synchronous one-use guard; stale/double starts cannot bypass the UI.

Exact click path: **startAutomaticConversation → BoundedConversationController.start(currentSession) → drive → acquireBrowserMicrophone → navigator.mediaDevices.getUserMedia**. Microphone acquisition is invoked before any network await, from the click call stack. Navigation, effect setup/replay, rerender and focus perform no microphone/provider request. Once permission/pipeline acquisition resolves, the existing backend start acknowledgement, microphone driver, calibration, approved opening preparation/playback and actual-ended learner transition continue. No provider contracts or audio processing settings changed.

Explicit End retains its existing path: local stopControl stops the controller immediately; the API end route records STOPPED. Disposing a running controller still cancels resources and ends its session on navigation. Disposing an untouched controller is inert; an intentional stop from READY still stops it and blocks stale startup. The current READY session can be used after loading the fixed page; no End-first or session restart workaround is required.

### Regression tests, changes and scope

Added `apps/web/src/components/ConversationPanel.test.tsx`: 12 mounted React/DOM and controller regressions covering StrictMode replay, visible/enabled READY CTA with granted consent, synchronous getUserMedia invocation exactly once, duplicate click/rerender, no spontaneous STOPPED, missing consent with accessible reason, updated consent handoff, MOCK/REAL_STT isolation, End from READY/starting, untouched navigation cleanup, and stale start after intentional stop.

Development-only pinned `jsdom@26.1.0` and `@types/jsdom@21.1.7` allow the normal offline suite to mount actual React StrictMode and dispatch real DOM clicks. Device/provider APIs are mocked; no physical microphone or external provider is accessed. No production dependency changed. Initial test-fixture failures omitted SafeSession's required debrief projection; the fixture was corrected, with no production contract changes.

Files changed by this correction:

- `apps/web/src/components/ConversationPanel.tsx`
- `apps/web/src/audio/conversationController.ts`
- `apps/web/src/components/ConversationPanel.test.tsx` (new)
- `package.json` (test list and development-only test dependencies)
- `package-lock.json`
- This report and `docs/evidence/evidence-ledger.md`.

Focused UI-entry plus existing automatic, 4C.1 real-STT and 4C.2 caller-playback tests: **91/91 PASS**. Full npm run check: PASS, exit 0; 609/609 tests, typecheck, lint, scenario validation, builds and secret scan all PASS. git diff --check: PASS. Prior full baseline 597 + 12 new regressions = 609.

Agent live Prisma/Timbre/Evon calls for this fix: **0**. Approved scenario/review/history, provider adapters/contracts, classifier/policy, VAD/DSP, microphone driver, environment and training-page design are unchanged. Phase 4C.3 remains INCOMPLETE pending physical retry. No Phase 5/6 work.

**READY TO RETRY 4C.3 PHYSICAL ACCEPTANCE** — offline validation is complete. Load the updated training page in its READY session, click the visible Start automatic conversation button and follow the same two-turn physical procedure above. Preserve any subsequent failure separately; this turn-zero failure has not been overwritten or counted as a successful conversation.

## Credit denial before first learner window — 2026-10-19

### Preserved physical failure and confirmed operation

The user confirmed the missing-start-button blocker was resolved. The opening played, caller-ended succeeded, then the first learner window was denied. Session: `c4bf05e4-6895-4d90-9d69-5611ceea0f82`. Request: `POST http://127.0.0.1:5173/api/sessions/c4bf05e4-6895-4d90-9d69-5611ceea0f82/real-audio/start` (local Vite proxy). HTTP 429:

```json
{"error":{"code":"CREDIT_LIMIT_REACHED","message":"Configured stt project-unit cap reached.","fallbackMode":"demo-safe"}}
```

The fail endpoint succeeded and the session entered ERROR at 0/3 committed turns, without LEARNER LISTENING. This is preserved as a separate failed physical run, not a passing conversation.

The exact rejection is `RuntimeAudioIngress.handle("start") → orchestrator.reserveRecognition(sessionId) → authorizeBillable("stt", STT_COST_UNITS, …)`. It occurs **before** `recognizer.openStream()`, so this rejected start makes no Prisma request. Opening TTS/cache lookup, playback, caller-ended, classifier/policy, logging and debrief did not trigger this denial. The code/message explicitly identifies STT; `demo-safe` is an error-envelope field and does not fabricate a runtime transcript or event.

### Settings and counter storage

Read only the allowlisted numeric/boolean fields from root `.env`; no key or secret was printed. Observed settings:

| Setting | Root configuration |
|---|---:|
| CREDIT_CAP | 2 |
| RESERVE_CAP | 0 |
| STT_COST_UNITS | 1 |
| TTS_COST_UNITS | 1 |
| TIMBRE_USED_UNITS | 1 |
| PRISMA_VERIFY_USED_UNITS | 0 |

There are no overrides for these settings in the agent shell. That is not a dump of the separately running API's environment: Node preserves inherited environment overrides, and API settings are read at process startup, not on each request. A restart from the intended configuration is required for an effective change.

`TurnOrchestrator.usedUnits` is one process-memory `Map<string, number>` per API server, with separate `stt` and `tts` keys. It is shared across sessions, not stored on SessionState or persisted to disk. Runtime STT starts from `budget.usedUnits=0`; runtime TTS is seeded from `TIMBRE_USED_UNITS=1` when Timbre is configured. Each allowed reservation increments only its operation key. Failed/cancelled attempts are conservatively not refunded, and zero committed events do not imply zero reservations. The older typed/mock transcription path also uses this orchestrator's configured STT units; those project-local simulations are not proof of real provider billing.

`PRISMA_VERIFY_USED_UNITS` belongs to the standalone verification script and does **not** seed runtime STT. Caller cache files hold audio assets, not credit counters. The standalone Timbre attempt marker records verification evidence and is not a runtime balance. Neither `.env` seed is automatically rewritten as the process spends units.

The denial reads `usedUnits.get("stt") ?? budget.usedUnits` and evaluates:

```text
projectedUsage = currentSttUsed + 1
usableCap = max(0, loadedCreditCap - loadedReserveCap)
deny when projectedUsage > usableCap
```

**With the inspected cap=2, reserve=0, cost=1 actually loaded, the exhausted STT counter is 2**: it starts at zero, increments by one only while allowed, and the third reservation is denied. This value is deduced from the guard, not a readout of a live counter. The public 429 includes no counter/cap snapshot. A read-only GET of the supplied failed session from the currently running local API returned `SESSION_NOT_FOUND`; its historical memory state is no longer available there. Consequently exact historical loaded overrides, prior window identities and direct numeric counter observation cannot be recovered from that response or session store. No values were invented or reset to claim otherwise.

### Accounting audit: no charging bug found

- CallerAudioService validates/reads cache first. A valid HIT returns immediately, reserves **zero** units and makes **zero** synthesis requests, even if TTS credit is exhausted.
- A MISS shares pending work and reserves exactly TTS_COST_UNITS immediately before one synthesis. A rejected reservation makes zero provider requests.
- Each actual Prisma window reserves STT_COST_UNITS immediately before one connection. Finish uses the existing transcript and does not charge STT again.
- There is no 3-turn maximum pre-reservation. Starting a session/caller clock has no credit charge.
- Browser playback, file-cache delivery, caller callbacks, deterministic classifier/policy, event/pressure logging, debrief and SVG rendering add no provider-unit reservations.
- No provider retry or retry-induced reservation is automatic. A new explicit attempt may require a new reservation; earlier failed/cancelled windows remain counted.
- These are **separate per-operation caps**, not one shared aggregate STT+TTS counter. This existing architecture was preserved; cap 4 must not be described as a combined four-unit account/billing ceiling.

Conclusion: the reported request is a runtime STT allocation denial, consistent with process-wide prior reservations/exhaustion, not a cache-hit charge or full-session prepayment bug. No production accounting code was changed.

### Exact retry allocation and local change

Read-only SHA-256/media/WAV cache validation found `system.opening` valid (6,720 ms), `system.safe-ending` valid (7,200 ms), and `authority` absent. No cache was modified and no provider was contacted.

| Upcoming work | STT units | TTS units |
|---|---:|---:|
| Opening cache HIT | 0 | 0 |
| Learner turn 1 | 1 | 0 |
| Authority MISS | 0 | 1 |
| Learner turn 2 | 1 | 0 |
| Safe ending HIT | 0 | 0 |
| If safe ending instead misses | 0 | +1 |
| Current-cache total / ending-miss worst case | **2** | **1 / 2** |

Thus this controlled acceptance needs **3 new project-local operation units with the currently validated caches, or 4 if the ending misses**. If the opening is also lost/invalid, add another TTS miss; no broad library pre-generation is needed.

For existing process counters `S` (STT) and `T` (TTS), two turns require `S+2 <= CREDIT_CAP-RESERVE_CAP` and `T+M <= CREDIT_CAP-RESERVE_CAP`, where `M` is the actual number of TTS misses. A new process uses S=0 and T=the configured prior-TTS seed. With seed=1 and current caches the mathematical per-operation usable minimum is 2; ending-miss worst case needs 3. The inspected cap 2 therefore can run the current-cache path in a fresh process, but does not supply two more STT reservations after an existing process has spent its STT allowance.

Recommended finite configuration for the requested retry:

```dotenv
CREDIT_CAP=4
RESERVE_CAP=0
STT_COST_UNITS=1
TTS_COST_UNITS=1
TIMBRE_USED_UNITS=1
```

**Only CREDIT_CAP changes from its observed value, 2→4.** All other shown settings already exist. Keep TIMBRE_USED_UNITS as the honest prior-use seed; the shown 1 is its current configured value, not a new claim that all historical usage totals one. If reconciling prior TTS usage yields `U > 2`, use `CREDIT_CAP >= RESERVE_CAP + max(2, U+2)` for the ending-miss worst case (at least the recommended finite 4). Do not lower a higher reconciled counter to fit. Do not change PRISMA_VERIFY_USED_UNITS to try to affect runtime.

Stop and restart the API once to load the intended root environment (and ensure inherited cap overrides do not supersede it), then create a fresh acceptance session because the failed session is ERROR/no longer in the current store:

```powershell
# API terminal, from D:\vishing--vaccine after stopping the old dev process:
npm run dev:api
```

The restart initializes runtime STT memory to 0 by the current architecture; there is no runtime STT env counter to edit. It initializes TTS memory to TIMBRE_USED_UNITS. Previous failed/paid attempts are not refunded or erased from evidence; this is a deliberate new finite acceptance allocation, not durable account-wide billing enforcement. No guard is removed or bypassed. This diagnostic did not edit `.env`, reset the running counters, restart the user's process deliberately, or invoke a provider.

### Regression validation and changes

Added 9 offline tests to the existing `apps/web/src/audio/conversation.test.tsx`, extending only its fake-provider/cache setup. They prove zero-unit cache HIT at exhausted credit; one-unit MISS; one-unit Prisma reservation with no extra Finish/classifier/event/debrief charge; a complete two-turn cap-4 flow with prior TTS seed and both missing responses; pre-request STT/TTS denials; no hidden retry/refund after connection/synthesis failure; no max-3 upfront reservation; and prior uncommitted windows across sessions exhausting STT before a fresh session's first turn.

Focused credit/cache/orchestrator group: **91/91 PASS**. Full `npm run check`: **618/618 PASS**, with typecheck, lint, scenario validation, builds and secret scan PASS. `git diff --check`: **PASS**. Baseline 609 + 9 new tests = 618.

Changed files: this report, `docs/evidence/evidence-ledger.md`, and `apps/web/src/audio/conversation.test.tsx`. No production credit guard, provider, frontend runtime, environment, dependency, scenario, classifier or policy changes. Temporary read-only diagnostics/logs are removed after recording results. Agent Prisma/Timbre/Evon requests: **0**.

**READY TO RETRY 4C.3 PHYSICAL ACCEPTANCE** after the local allocation is applied and loaded. Phase 4C.3 remains INCOMPLETE; no successful physical multi-turn result is claimed.

## Complete credit and caller-failure audit — 2026-10-20

This follow-up supersedes the earlier conclusion that no production accounting correction was needed. The earlier physical observations, validation results and unsuccessful attempts above remain historical evidence. All work in this follow-up was offline or a read-only request to the local API; **Prisma/Timbre/Evon calls = 0**.

### Physical attempts retained; limits of the diagnosis

| Attempt | Available physical evidence | Conclusion |
| --- | --- | --- |
| `c4bf05e4-6895-4d90-9d69-5611ceea0f82` | Opening heard; caller-ended succeeded; first POST `real-audio/start` returned HTTP 429 / `CREDIT_LIMIT_REACHED` / `Configured stt project-unit cap reached.`; ERROR, 0/3 events | Confirmed local STT guard denial before a Prisma connection. This is not evidence of a provider-originated rate limit. Historical loaded cap/counter were not exposed. |
| `e7b83e48-9be2-4a1a-b132-d671fca194df` | Approximately “thoda samay chahiye”; STALLED; response latency **2136 ms**; exactly one learner event, one pressure point and 1/3 committed turns; then ERROR / `CALLER_AUDIO_FAILED` | The caller path after the committed turn failed. **Exact underlying cause UNCONFIRMED**: the user no longer has the failed URL/response. No additional live reproduction was requested. |
| Later credit-limit attempt | User had changed root `CREDIT_CAP=4`; UI reported `CREDIT_LIMIT_REACHED` | Session, request stage, response and effective running-process values unavailable. Prior use, stale configuration and accounting defects cannot be distinguished retrospectively. No definite causal claim. |

The current approved policy was replayed offline: STALLED on turn 1 selects **authority**, next pressure 1. This verifies the current code/content path; it does not recover the historical second attempt's selected response or failed network request. Its valid committed event must remain valid regardless of subsequent caller preparation failure.

### Effective settings and all accounting stores

Before editing, the allowlisted root settings were cap 4, reserve 0, STT cost 1, TTS cost 1, Timbre prior-use seed 1 and Prisma verification used 0. Historical private runtime balances were unavailable; no exact failed-run balance was invented. Root `.env` was not edited and remains Git-ignored.

After implementation and full validation, GET `http://127.0.0.1:3001/api/runtime/credit` returned this sanitized snapshot of the **current** API, not the historical failed process:

```json
{
  "processId": 31408,
  "bootId": "a267e5b6-039f-48e8-9e52-5b76da7df619",
  "loadedAt": "2026-10-20T11:14:10.339Z",
  "mode": "development",
  "cap": 4,
  "reserveCap": 0,
  "usableCap": 4,
  "sttCostUnits": 1,
  "ttsCostUnits": 1,
  "initialTtsUsedUnits": 1,
  "simulation": { "sttUsedUnits": 0, "ttsUsedUnits": 0 },
  "stt": { "usedUnits": 0, "remainingUnits": 4, "providerAttempts": 0 },
  "tts": { "usedUnits": 1, "remainingUnits": 3, "providerAttempts": 0 },
  "events": []
}
```

| Store | Actual scope / initialization / persistence |
| --- | --- |
| Runtime STT/TTS | `RuntimeCreditLedger` in `apps/api/src/runtimeCredit.ts`, owned by the existing `TurnOrchestrator`. Separate STT and TTS process-memory counters shared across sessions. STT initializes from the server budget's 0; TTS from `TIMBRE_USED_UNITS` when configured. No runtime balance file or session-backed credit balance. |
| In-flight reservation | Included in runtime `usedUnits` immediately, preventing concurrent overspend. No separate configured `reservedUnits` balance exists. A reservation ticket records RESERVED, ATTEMPTED, RELEASED or DENIED; only an unattempted reservation can be released. |
| Runtime attempt counts and recent audit | Process-memory per-operation counts plus at most 64 records, including guard decision, session, configured cost, used-before/after and provider-attempt flag. Counts are distinct from units and from the historical TTS seed. |
| Typed/mock simulation | Now separate process-memory simulation counters. Existing finite simulation checks remain; simulated operations cannot spend the real runtime provider allocation. No simulated transport is claimed as a billable provider attempt. |
| `PRISMA_VERIFY_USED_UNITS=0` | Explicit environment input to the standalone Prisma verifier (`verificationConfig.ts` / `verifyPrisma.ts`). Not the runtime STT seed; no automatic synchronization or environment write-back. |
| Standalone Timbre verifier | `scripts/verify-timbre.ts` evaluates its configured one-attempt cost against cap/reserve with used=0 and writes a durable exclusive-create attempt evidence record before transport. The existing record prevents another probe; it is not a runtime balance. Runtime TTS uses the separately configured `TIMBRE_USED_UNITS=1` seed. Verifier behavior was not changed. |
| TTS cache | Files contain approved audio/media metadata, not credit balances. Serving a HIT does not enter the provider ledger. Offline cache seeding does not make a provider call. |

The guard formula is unchanged:

```text
cap = development CREDIT_CAP (public-demo uses PUBLIC_DEMO_CREDIT_CAP)
usableCap = max(0, cap - RESERVE_CAP)
projectedUnits = usedUnits[operation] + configuredCost[operation]
allow iff projectedUnits <= usableCap
remainingUnits[operation] = max(0, usableCap - usedUnits[operation])
```

`RESERVE_CAP` is an untouched capacity buffer, not spent credit. The cap applies independently to STT and TTS; it is **not a combined STT+TTS account limit**. The original c4 denial proves `usedSTT + STT_COST_UNITS > loaded usableCap`. If cap 2 / reserve 0 / cost 1 was actually loaded then used STT was 2, as explained in the older section; that is a conditional deduction, not a recovered memory read. Similarly cap 4 does not guarantee four remaining units. We cannot establish whether stale API configuration contributed to either historical failure.

### Confirmed defects corrected

1. **Local STT validation could leak a unit before any socket existed.** Previously the route incremented its counter before synchronous `openStream` validation and never released that reservation on a local throw. It now releases its own reservation exactly once if no transport is returned. Once a stream/connection attempt exists, timeout, provider failure, no usable transcript or cancellation conservatively retain that one unit. Guard rejection makes no transport and changes no used balance.
2. **Mock activity could exhaust the same real runtime allocation.** The older typed/mock pipeline used the same operation-keyed map as real Prisma/Timbre operations. Simulation accounting now has a separate guarded map. Provider costs remain absent from classifier, policy, event append, pressure rendering and debrief.
3. **The actual Prisma adapter still rejected every turn except turn 1.** The automatic ingress accepted bounded later turns, but the real adapter retained a 4C.1-only check. It now accepts integer turns 1–3, rejecting 0, 4 and fractions locally. Wire endpoint, headers, language, framing, segmentation, silence/settle strategy and authoritative local timing are unchanged. An end-to-end offline test uses the actual adapter with fake sockets for both canonical turns; fake recognizer-only coverage had missed this restriction.
4. **Caller errors lost their cause.** The client previously discarded caller-audio error JSON, and the controller treated any HTTP 429 as credit exhaustion. Code inspection proves causes could be obscured; it does not prove e7 was a credit error. Allowlisted `causeCode`, `stage`, `providerAttempted`, cache result and numeric guard decision now survive API → client → controller → failed session. `CREDIT_LIMIT_REACHED` stays credit; `RATE_LIMITED` or a genuine TTS/provider rejection does not become credit merely because its status is 429. HTTP status semantics are retained.
5. **Concurrent calibration and caller preparation could mislabel a local audio failure.** Calibration now records its own CALIBRATION stage / learner-audio failure. Caller resolution, TTS guard/provider/cache, asset fetch, browser decode and playback remain distinguishable. Arbitrary provider text, raw exceptions, headers and credentials are excluded from the shared technical metadata.

TTS validates approved content, configuration and cancellation before its optional provider-boundary callback; then one idempotent guard runs immediately before fetch. HIT returns before this callback. Failed or canceled requests after fetch begins retain their one project-local unit because a provider attempt occurred. Local preflight rejection/cancellation consumes zero. Existing synthesizers without a transport-boundary hook retain guarded entry behavior; the real Timbre adapter reports its precise boundary.

No cache-HIT charging or theoretical max-3-session precharge was found. Existing in-flight TTS coalescing, one audio window per session, controller generation/one-use guards, duplicate Finish handling and absence of retries were preserved and tested. Duplicate guard callbacks are also idempotent. A later explicitly requested new provider operation still requires its own unit; it is not a retry of the old operation hidden by the harness.

Committed learner events and pressure points survive a subsequent TTS/credit/playback failure; tests also open the partial deterministic debrief with the event intact. No transcript is reclassified and no old event is recommitted. The missing-start-button correction remains covered by mounted StrictMode regressions; microphone permission remains tied to the explicit start gesture.

### Development observability

The read-only GET `/api/runtime/credit` uses the existing development/test, loopback peer/Host and same-origin checks. It returns loaded config, boot identity/time, separate runtime/simulation balances, attempt counts and the bounded audit; it makes no provider request. The automatic panel refreshes it at state/turn transitions under **Technical audio facts**. Caller asset facts continue to identify cache HIT/MISS and per-asset provider attempts. Failed sessions retain the structured technical stage/cause, also visible after reloading their session projection. Production/public access is blocked.

### Exact allocation and restart procedure

Read-only SHA-256, metadata and WAV inspection found all caller assets for the intended policy path valid:

| Approved line | Current cache | Duration | New TTS units |
| --- | --- | ---: | ---: |
| `system.opening` | HIT | 6720 ms | 0 |
| `authority` | HIT | 6240 ms | 0 |
| `system.safe-ending` | HIT | 7200 ms | 0 |

This supersedes the earlier inspection where authority was absent; no asset was synthesized or modified during this audit. With the cache unchanged, acceptance needs **2 new STT units and 0 new TTS units**. If authority and safe-ending instead miss, it needs **2 STT + 2 TTS = 4 new project-local operation units**. With loaded counters STT=0 / TTS=1, those worst-case final balances are STT=2 / TTS=3, leaving 2 STT / 1 TTS units under the separate cap-4 architecture. If opening is also lost, one extra TTS miss uses the remaining TTS unit. This is local bookkeeping, not Gnani pricing or measured account billing.

**No additional cap increase or `.env` edit is required for the observed allocation.** Keep these current non-secret settings:

```dotenv
CREDIT_CAP=4
RESERVE_CAP=0
STT_COST_UNITS=1
TTS_COST_UNITS=1
TIMBRE_USED_UNITS=1
```

The seed 1 is the current configured prior-TTS value, not a claim that all historical provider usage totals one. Preserve/reconcile it honestly; do not lower a higher reconciled value to fit the acceptance. Do not edit `PRISMA_VERIFY_USED_UNITS` to affect runtime. No counter file should be deleted, and no runtime STT seed variable exists.

Root environment is loaded once at API startup and inherited process variables take precedence. Stop the API, then from `D:\vishing--vaccine` restart **`npm run dev:api`** before the controlled retry, ensuring old inherited non-secret cap/cost overrides do not replace the intended values. A web restart is unnecessary; reload the updated page. The agent did not manually restart the user's API; development watch/package builds may restart it, which is why the boot identity is exposed.

A new API process initializes runtime STT to 0 and TTS to the honest configured seed by the existing architecture. This is a new finite process allocation; it does not refund old attempts, erase evidence, reconcile durable account usage or restore Gnani credits. No manual counter reset is recommended. Before the one controlled session, Technical audio facts must show the intended loaded values and enough remaining units: at least 2 STT, and up to 2 TTS for response misses. A different balance/seed must be reconciled before provider use, not worked around by repeated cap increases.

### Regression validation

Added **33 offline regressions** over the prior 618-test baseline: 8 ledger, 5 actual Prisma adapter, 6 caller/Timbre boundary, 5 client error propagation and 9 automatic conversation/integration tests. Coverage includes exact cap boundary/reserve buffer; one STT charge; HIT=0; MISS=one configured unit; two-turn worst/cache-rich budgets; no max-3 upfront charge; rejection before transport; failed/canceled pre/post-provider boundaries; duplicate callbacks/Start/Finish/TTS work; mock/runtime isolation; genuine provider 429 versus local credit; post-STALLED event/partial-debrief preservation; and actual adapter turns 2/3 without changing wire settings.

Focused group: **210/210 PASS** (ledger, credit guard, orchestrator, real Prisma adapter using fake sockets, caller service, browser caller playback/controller, automatic conversation, diagnostics, mounted start CTA and API client). Full **`npm run check`: PASS, exit 0; 651/651 tests**, typecheck, lint, scenario validation (approved S-01 runtime=true), API/web builds and secret scan PASS. The first full run exposed two existing safe HTTP-diagnostic regressions in the new error plumbing; the transport retained its existing sanitized HTTP Error/stage while attaching typed metadata, and the focused/full suite then passed. No existing test was weakened. **`git diff --check`: PASS**.

### Files changed by this audit only

The repository already contained work from earlier phases. Comparison against the start-of-audit SHA-256 snapshot identifies the following 31 files; the broader Git diff contains those earlier changes too.

- `apps/api/src/runtimeCredit.ts` (new), `apps/api/src/runtimeCredit.test.ts` (new)
- `apps/api/src/errors.ts`, `apps/api/src/health.ts`, `apps/api/src/turnOrchestrator.ts`, `apps/api/src/runtimeAudioIngress.ts`, `apps/api/src/conversationRuntime.ts`
- `apps/api/src/callerAudio/service.ts`, `apps/api/src/callerAudio/routes.ts`, `apps/api/src/callerAudio/callerAudio.test.ts`
- `apps/api/src/providers/prisma/prismaRealtimeRecognizer.ts`, `apps/api/src/providers/prisma/prismaRealtimeRecognizer.test.ts`, `apps/api/src/providers/timbre/timbreSpeechSynthesizer.ts`
- `apps/web/src/audio/technicalFailure.ts` (new), `apps/web/src/audio/errors.ts`, `apps/web/src/audio/transport.ts`, `apps/web/src/audio/callerPlayback.ts`, `apps/web/src/audio/conversationController.ts`, `apps/web/src/audio/conversation.test.tsx`
- `apps/web/src/sessionApi.ts`, `apps/web/src/sessionApi.test.ts`, `apps/web/src/components/ConversationPanel.tsx`
- `packages/contracts/src/runtimeDiagnostics.ts` (new), `packages/contracts/src/conversation.ts`, `packages/contracts/src/providers.ts`, `packages/contracts/src/index.ts`
- `package.json` (register ledger tests only; no dependency/lockfile change)
- `docs/architecture/session-api.md`, `docs/architecture/real-voice-turn.md`, this report, `docs/evidence/evidence-ledger.md`

Approved scenario/candidate/review/history, classifier, adaptive policy, local timing/VAD/resampler/PCM/worklet/microphone driver, provider configuration, verification harnesses, `.env`, `.env.example`, `.gitignore` and package lock were not changed by this audit. Provider-neutral boundary metadata was added; endpoint/auth/model/voice/language/wire contracts remain frozen. No new live provider capability is marked VERIFIED. Interruption remains UNKNOWN/unvalidated.

### One controlled physical retry — pending

After API restart and page reload, create **one fresh automatic S-01 session**, give consent and click **Start automatic conversation**. Opening must play from cache; on its actual end, LEARNER LISTENING must appear.

1. Say **“थोड़ा समय चाहिए।”** Expected STALLED, exactly one event/pressure point, then approved authority audio automatically.
2. After actual caller end and LEARNER LISTENING, say **“Main independently verify karunga.”** Expected VERIFIED_INDEPENDENTLY, exactly two events/pressure points, then safe-ending audio automatically.
3. Actual ending completion must produce COMPLETED and deterministic debrief, no third learner window, microphone off and no continuing stream. Inspect sanitized cache/guard/attempt facts. If this controlled attempt fails, preserve the stage/cause and partial events; no additional reproduction is requested now.

**READY TO RETRY 4C.3 PHYSICAL ACCEPTANCE**

**PHASE 4C.3 STATUS: INCOMPLETE — READY FOR CONTROLLED PHYSICAL RETRY**

## Second-turn learner re-arm and calibration blocker — 2026-10-20

### Preserved physical failure

User-reported session **`4744c754-a76a-4d2e-9485-fccfea0308fa`** captured/finalized its first learner turn, committed exactly one event, rendered one pressure point and showed **1/3 committed turns**. Continued learner preparation then stopped with **`LEARNER_AUDIO_FAILED · CALIBRATION · INTERNAL_ERROR`**. No exact label, transcript, response latency or hardware-state dump was supplied for this attempt; none is inferred from the other sessions. It is not counted as a successful multi-turn acceptance.

The earlier c4 STT guard denial, e7 post-STALLED caller failure and later credit-limit attempt remain above. In particular, e7's exact underlying cause remains UNCONFIRMED; this new source-level diagnosis does not retroactively establish it. No provider call or new live reproduction was made for this correction.

### Exact failure path established before editing

```text
Turn 1 BrowserAudioController.finish()
  → reusable learner lease.flush()
  → driver.flush()
  → worklet port "flush"
  → LocalCaptureProcessor: this.live = false
  → next process(): return false
  → no more native PCM blocks
next ReusableMicrophone.calibrate()
  → 2500 ms timer rejects BrowserAudioError(TIMING_UNAVAILABLE)
  → conversation calibration catch replaces it with CALIBRATION / INTERNAL_ERROR
```

Running the actual pre-fix worklet source offline in the existing VM style produced:

```json
{"beforeFlushProcessReturns":true,"flushAcknowledged":true,"afterFlushProcessReturns":false,"processorLive":false}
```

The first learner turn worked because the newly created processor was live until that turn's final flush. The second calibration got a new VAD, but the reused processor had been terminally stopped. This is a confirmed lifecycle defect, not evidence of a new credit, transcript or caller-provider problem.

The wrong boundary was the **reusable lease delegating a turn flush to the driver's terminal flush**, rather than an intermediate `track.stop()` or `AudioContext.close()`. Code inspection shows `BrowserAudioController.release()` stops its lease, whose stop only detaches the subscriber; it does not stop the session driver. Track/context/node remained owned by the reusable session. Historical physical track/context values were not recorded, so no hardware observation of running/suspended/closed is claimed. The new actual-driver test demonstrates live track/running context/one connected worklet across both turns, with final stop/close/disconnect occurring once.

The worklet node was reused after its processor had returned false. It was not recreated or double-attached between turns. Each old calibration already created a fresh LocalVad; stale noise-floor/VAD evidence was not the demonstrated cause. Driver event listeners were installed once by the session's one start. The original calibration ran concurrently with caller preparation, before playback; the fix also makes the requested caller-ended → calibration boundary explicit. Actual browser caller playback already tears down its audio/URL before invoking its end callback; no separate React effect starts calibration.

### Chosen reuse architecture and cleanup boundaries

The correction intentionally reuses **one granted MediaStream, one AudioContext and one AudioWorkletNode**. getUserMedia remains tied to the existing explicit start gesture and is not called on navigation or between learner turns.

- `driver.flush({ keepAlive: true })` sends **`flush-turn`**. The worklet emits the partial tail, zeros/resets its block/count and continues returning true. Existing acknowledgement/backpressure bounds remain in effect.
- Default `driver.flush()` still sends terminal **`flush`** and preserves Phase 4B/standalone finish semantics. Hard `stop` remains terminal. The old standalone worklet regression still asserts that ordinary flush makes process return false.
- A learner lease drains its final samples, then detaches only its own callback. Its BrowserAudioController clears the turn's resampler, PCM assembler, VAD, timers and transport resources. The underlying driver remains active and acknowledges/discards microphone samples during caller audio and backend processing.
- After actual caller end and its acknowledgement, one drive enters LEARNER_PREPARING, checks the current generation/session, and calibrates `committedTurnNumber + 1`. A nonterminal flush first drains/discards queued previous/caller samples before attaching the fresh calibration consumer. A fresh LocalVad resets calibration accumulation, noise floor, hysteresis, speech flags and boundaries; a fresh learner controller creates new resampler/frame state, sequence zero and no prior speech timestamps.
- The session clock ID/origin is retained. VAD configuration, 48→16 kHz DSP, 1024-byte frames, local timing authority, classifier, policy and pressure semantics are unchanged. Response latency still uses actual caller end and local learner start in that clock; no calibration delay is subtracted or represented as improved learner performance.
- Final completion/terminal decision, End, navigation of an active run, safe word or technical failure stops the session driver, tracks, worklet/port, AudioContext and listeners. Stop is idempotent. End during calibration cancels its timer/listener and prevents any next Prisma start or event.

### Health checks, identity and error specificity

The browser driver now exposes sanitized health facts: stream active, audio-track count/live/enabled, context state and worklet lifecycle state. Re-arm checks them before attaching a consumer and again after the drain acknowledgement. A dead/disabled stream, closed/suspended context or unavailable worklet fails precisely; there is no blind reuse, automatic getUserMedia reacquisition or resume of a closed context.

ReusableMicrophone uses DISCARD → CALIBRATING → ARMED → CAPTURING → DISCARD, with STOPPED for final cleanup. It checks sequential turn identity, rejects concurrent calibration/duplicate leases, and uses an epoch so an old lease stop or late drain callback cannot replace/clear a newer subscriber. Settled calibration callbacks are inert and remove their timer/abort listener exactly once. Existing caller-ended and controller-generation guards ensure duplicate ended callbacks/rerenders cannot start a second calibration.

Strict technical causes now include MEDIA_STREAM_ENDED, MICROPHONE_DISABLED, AUDIO_CONTEXT_CLOSED, AUDIO_CONTEXT_SUSPENDED, WORKLET_UNAVAILABLE, CALIBRATION_REENTRANT, CALIBRATION_TIMEOUT, CALIBRATION_INVALID_INPUT and INVALID_TURN_STATE. The existing error envelope/session failure path accepts these allowlisted values. The conversation calibration catch preserves them instead of replacing all failures with INTERNAL_ERROR. Technical audio facts also expose the current microphone mode, turn, calibration count and safe resource states; no device IDs, raw audio, credentials or arbitrary exception text is added.

Turn-2 calibration/health failure tests preserve exactly one prior committed event/point, record the typed technical stop, clean up the microphone and make zero second-window provider requests. End still produces the partial deterministic debrief. A fresh session has an empty event history; old callbacks cannot recommit turn 1.

### Offline validation and exact scope

Baseline: **651 tests** from the preceding validated audit. Added **22** regressions:

| Group | Added | Coverage |
| --- | ---: | --- |
| Reusable microphone | 14 | Two clean VAD/lease windows; one driver start; seven unhealthy-resource conditions; duplicate/reentrant/stale identity protection; stop/abort during calibration/reset; timeout and invalid input |
| Actual browser driver + worklet source | 1 | Two finalizations at 48 kHz with real structured-clone transfers; live track/running context/one worklet between turns; clean PCM sequence/window/clock identity; no previous/caller samples; final stop/close/port disconnect once and zero remaining driver listeners |
| Worklet protocol | 1 | Nonterminal drain continues processing, clears old partial samples and remains hard-stoppable; existing terminal flush retained |
| Automatic conversation | 6 | Caller discard then fresh second calibration, duplicate ended callbacks, two-event/point terminal debrief, End during second calibration, dead track/closed context/failed worklet, and missing-block timeout preserving turn 1 without a second provider window |

Focused command (device/provider implementations are mocked):

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/web/src/audio/reusableMicrophone.test.ts apps/web/src/audio/browserCapture.test.ts apps/web/src/audio/worklet.test.ts apps/web/src/audio/conversation.test.tsx apps/web/src/components/ConversationPanel.test.tsx apps/web/src/audio/controller.test.ts
```

**129/129 PASS**. **`npm run check`: PASS, exit 0; 673/673 tests**, typecheck, lint, scenario validation (S-01 runtime=true), API/web builds and secret scan PASS. **`git diff --check`: PASS**. During development a new test's overly exact floating-point comparison, an assertion before the failure API response had arrived, and a fixture lint violation were corrected; existing behavioral assertions were not weakened. These tests do not claim physical device/autoplay acceptance.

Files changed by this correction only (14; earlier work in the broader dirty checkout is preserved):

- `apps/web/src/audio/capture.worklet.js`
- `apps/web/src/audio/browserCapture.ts`
- `apps/web/src/audio/reusableMicrophone.ts`
- `apps/web/src/audio/conversationController.ts`
- `apps/web/src/components/ConversationPanel.tsx`
- `packages/contracts/src/runtimeDiagnostics.ts`
- `apps/web/src/audio/reusableMicrophone.test.ts` (new)
- `apps/web/src/audio/browserCapture.test.ts`
- `apps/web/src/audio/worklet.test.ts`
- `apps/web/src/audio/conversation.test.tsx`
- `package.json` (register the new offline test only)
- `docs/architecture/real-voice-turn.md`
- This report and `docs/evidence/evidence-ledger.md`

No provider adapter, verification script, credit/configuration/cache logic or limits, approved content/review/history, classifier/policy, debrief templates, VAD algorithm, resampler, frame format, clock/timing code, environment, dependencies or lockfile changed. **Live provider calls = 0.** The shared technical-cause contract changes diagnostics validation only; API business/provider behavior is unchanged.

### One controlled physical retry remains pending

Restart the API with **`npm run dev:api`** to ensure it loads the rebuilt shared technical-cause contract; no env/budget change is requested. Reload the browser so the updated worklet/driver/controller are used. Create **one fresh automatic S-01 session**, consent, then click Start automatic conversation.

1. Opening plays; after actual caller end keep quiet during LEARNER PREPARING/calibration and wait for LEARNER LISTENING.
2. Say **“थोड़ा समय चाहिए।”** Expected STALLED, one event/point, then the approved next caller audio automatically.
3. After that caller ends, **second calibration must succeed and LEARNER LISTENING must appear again** with the same granted microphone and clock.
4. Say **“Main independently verify karunga.”** Expected VERIFIED_INDEPENDENTLY, second event/point, safe ending, COMPLETED/debrief, no third learner window and full microphone cleanup.

No additional live reproduction was performed or requested during the fix. All earlier physical failures remain retained. Successful physical chaining, heard audio and browser cleanup are still required before completion; no new provider capability is marked VERIFIED.

**READY TO RETRY 4C.3 PHYSICAL ACCEPTANCE**

**PHASE 4C.3 STATUS: INCOMPLETE — READY FOR CONTROLLED PHYSICAL RETRY**

## Physical acceptance and final turn-card labeling correction — 2026-10-21

### Physical acceptance passed — user confirmation

The user explicitly confirmed that the functional two-turn physical acceptance passed:

- Turn 1 classified STALLED; policy selected authority; approved authority caller audio auto-played.
- Turn 2 classified VERIFIED_INDEPENDENTLY; safe-ending caller audio auto-played.
- No third learner turn/listening window started.
- Microphone fully stopped after terminal completion.
- Deterministic debrief rendered with exactly **2 events and 2 pressure points**.

This is the user's physical observation, not a new agent-operated live run. The successful session ID, exact run time, latency and provider/cache usage were not supplied and are not invented. Earlier failed sessions remain above; their missing evidence is not reconstructed from this successful run. No additional provider capability, timing distribution or interruption validation is claimed.

### Final UI inconsistency: cause and presentation-only correction

The successful run's Turn 1 card displayed SAFE FALLBACK despite STALLED → selected next tactic authority → automatic continuation. `PressureTimeline.tsx` chose its heading using:

```text
SAFE_VERIFIED decision → SAFE VERIFIED
otherwise preceding callerTacticId exists → preceding tactic
otherwise → SAFE FALLBACK
```

The approved opening has no preceding tactic ID. Absence of that ID therefore incorrectly labeled its learner event as fallback, ignoring the actual SELECTED_TACTIC decision and selectedNextTacticId. Other decisions could also show the preceding tactic rather than the event's outcome. The SVG curve itself does not generate these headings and required no change.

The single presentation helper now reads existing policy outcome fields:

| Existing policy decision | Card heading |
| --- | --- |
| SELECTED_TACTIC with selectedNextTacticId | NEXT: AUTHORITY (or the actual selected tactic, formatted in capitals) |
| SELECTED_TACTIC without a tactic ID | CONTINUE |
| NO_APPROVED_TACTIC / DRAFT_SAFE_FALLBACK | SAFE FALLBACK |
| SAFE_VERIFIED | SAFE VERIFIED |
| DUMMY_SECRET_DISCLOSED | DUMMY SECRET DISCLOSED |
| SAFE_WORD / LEARNER_ENDED / MAX_TURNS | Existing decision text with underscores replaced by spaces |

This uses the existing “Next:” tactic style in the card footer and all-caps heading style. It is generic across learner behaviors; no STALLED-specific rule or data rewrite was introduced. Policy codes remain authoritative, including for terminal outcomes. Classifier, policy, schema/events, scenario, pressure calculation/curve, debrief, providers, orchestration and microphone code are unchanged by this correction.

### Regression validation and exact changed files

Replaced the old partial SAFE_VERIFIED fixture with **11 schema-valid heading cases**, covering STALLED/authority, REFUSED/next tactic, COMPLIED/next tactic, continuation without a tactic ID, actual fallback decisions, safe verification, terminal disclosure, safe word, learner end and turn limit. Each case checks both full and compact cards, extracts the actual heading (rather than accidentally matching the footer), verifies one pressure point and asserts input facts are unmodified. The existing HTTP automatic-conversation tests also retain their canonical safe-fallback/safe-ending response assertions.

Focused command:

```powershell
npx tsx --tsconfig apps/web/tsconfig.app.json --test apps/web/src/components/render.test.tsx apps/web/src/audio/conversation.test.tsx
```

**69/69 PASS.** Baseline 673 tests; 11 cases replace 1 existing case, adding a net 10. **`npm run check`: PASS, exit 0; 683/683 tests**, typecheck, lint, approved scenario validation, API/web builds and secret scan PASS. **`git diff --check`: PASS. Agent provider calls for this fix: 0.**

Exactly four files changed relative to the start of this correction:

- `apps/web/src/components/PressureTimeline.tsx` — the only runtime-code change: outcome-based heading helper.
- `apps/web/src/components/render.test.tsx` — generic full/compact heading regressions.
- This report — physical acceptance, final UI correction and completed status.
- `docs/evidence/evidence-ledger.md` — completion entry preserving prior history.

No additional physical retry is required for this label-only correction. The confirmed physical acceptance and passing final UI validation satisfy the remaining Phase 4C.3 gates.

**PHASE 4C.3 STATUS: COMPLETE**
