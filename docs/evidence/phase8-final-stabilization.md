# Phase 8 final stabilization

**Accepted on 2026-11-09.** The offline Loom path is ready for recording. The demonstrated behavior is frozen pending the owner's Git checkpoint. [Recording runbook](../demo/phase8-final-loom-runbook.md) · [Machine-readable evidence](phase8-final-stabilization.json)

## A. Pre-implementation audit

The audit used the staged Phase 7 app on `main` at `de2f4e8`, the roadmap, previous acceptance evidence, runtime boundary, and real browser screens. The initial catalog recovered after the API became available and the baseline learner flow reached a two-turn debrief. No P0 blocker was reproduced in the connected path. The 28 staged Phase 7 paths became commit `877435a` during this work. Phase 8 edits stayed unstaged.

| Priority | Observed problem | Correction |
| --- | --- | --- |
| P1 | A reload with an unconfirmed End could expose the active call again. An unconfirmed typed submit could unlock the same controls after End also failed. | The call screen now yields to an interrupted-state recovery panel. One End retry can recover committed turns. A confirmed 404 clears the expired session reference. |
| P1 | A stop phrase appeared as an unclear learner response. | The debrief and timeline identify the session control. Results count the stop as an outcome and exclude the phrase from behavior totals. |
| P1 | Route focus could land below a heading. The compact menu could expose off-screen links to Tab. | New routes start at the top with main focus. Compact navigation moves focus to the current link and returns it to the menu on Escape. |
| P1 | The trainer panel's sticky heading covered approval and publication status cards. An invalid export advised the user to consult an operation contract. | The cards sit below the heading and show separate approval, publication and availability. The error identifies the required file. |
| P1 | The active prompt and consent controls were small at laptop resolution. Fonts depended on remote stylesheets. | The typed call, consent, results, and review summaries use legible sizes and local system fonts. The active form fits in the tested laptop viewport. |
| P2 | The page entrance animation and development footer drew attention from the call. | Page entrances are immediate. The footer identifies the local training workspace. |

## B. Browser visual and accessibility checks

In-app Chromium screenshots and measurements covered 1920×1080 desktop, 1280×720 laptop and 820×900 tablet. The approved Hinglish line rendered at 15 px and the response field at 14 px. A Devanagari test phrase displayed without clipping and was replaced with the approved demo input before submission. The laptop Submit button ended at y=700 px with the route at y=0. The debrief outcome rendered at 18 px. The trainer status cards sat below their heading, and full fingerprints wrapped at both desktop and tablet sizes. Overview, the active laptop call, the debrief and the tablet history had no document-level horizontal overflow. The tablet history retained all six column headings.

Verified keyboard Tab order, visible focus, Skip to content, menu focus and Escape, browser Back, direct routes, consent labels, the safe-word stop, and form errors. Route entrances have no animation and the reduced-motion CSS rule is present. This was a practical browser check in the tested viewports.

## C. Demo reliability and result accuracy

| Offline S-01 run | Session ID | Result |
| --- | --- | --- |
| Fresh process and tab | `06bc9d30-f1ec-4304-a392-495f7a4601d4` | SAFE_VERIFIED, 2 events, 2 pressure points |
| Second successive run | `1d041a71-f696-4ed3-a2c7-4bc893d6b84f` | SAFE_VERIFIED, 2 events, 2 pressure points |
| After browser reload | `ca04b35f-b912-4c73-b4ab-915e84bc02a1` | SAFE_VERIFIED, 2 events, 2 pressure points |
| After clean API restart | `7a1d5c84-3018-4eb2-828b-1cb2cd6a8797` | SAFE_VERIFIED, 2 events, 2 pressure points |

The four distinct sessions used S-01 v0.2.0 and the approved package pin. Explicit consent preceded Start. The two samples produced `STALLED` with `authority`, followed by `VERIFIED_INDEPENDENTLY` with `system.safe-ending`. The browser showed the approved authority text, the two committed decisions, claimed authority as a caller tactic, and the recommendation to use an independently known official channel. The pressure timeline showed two points and latency **Not captured**. The API's late End responses preserved the terminal result and both events.

The browser safe-word run committed one `SAFE_WORD` event, opened the stopped debrief, and presented the phrase as a stop control with no standalone rubric score. The committed event retains the original classifier label. The healthy walkthrough showed no browser warnings or errors. History kept the first two records after a tab reload. Overview counted three completed offline runs and three independent verifications before the API restart. The prior records expired after restart. Tablet history then showed the five new records in descending timestamp order, with independent verification and learner-ended results labeled separately.

The browser rendered S-90's deterministic-mock provenance and S-91's manual-import provenance. Both were drafts with zero errors and two warnings. A standalone S-92 revision showed `LINEAGE_INVALID` until its saved parent was supplied. Its validation then passed with zero errors and warnings. Loading the verified workflow export cleared a deliberately reintroduced standalone lineage finding and showed S-92 v0.1.1, **APPROVED**, **20/20**, **Submitted validation current**, **PUBLICATION_BLOCKED** and **Not playable**. The expanded record showed the exact approval and publication IDs and runtime eligibility false. Feeding a draft into the workflow selector produced a recovery message and cleared the earlier preview.

## D. Recovery and cleanup

| Exercise | Result |
| --- | --- |
| Frontend before API | The catalog showed an actionable unavailable screen. **Retry connection** exposed S-01 after the API started. |
| Fixed port conflicts | A second offline API and second Vite process each exited 1 on their occupied port. A later Vite restart rebound port 5186 and returned HTTP 200 for the app. |
| Mid-session disconnect and reload | The API was stopped after one committed turn. A response could not be confirmed. Both the first failure and a reload showed the interrupted panel with no response action. After restart, the End retry resolved the old ID as expired. The next call required new consent. |
| End before any turn | The stopped debrief showed zero turns and no scoring evidence. |
| End after one turn, refresh during an active call | Each preserved one turn and one point in its stopped debrief. |
| Leave an active call and use Back | The old route offered its ended debrief. |
| End during processing, duplicate Start/End and lost response | Integration tests cover serialization, duplicate guards, explicit retry after a confirmed unchanged turn, and a single End retry after reconnect. |
| Voice consent and capture failures | Fake microphone coverage passed for denial, missing device, unsupported capture and release after leaving a pending permission request. No physical capture was exercised. |

The terminal API projections reported `recordingEnabled=false`. Shutdown was limited to the verification processes. The intended port-conflict and disconnect tests explain the corresponding local server messages.

## E. Security and protected state

The backend's playable catalog contained S-01 v0.2.0 only. S-02 and S-03 stayed drafts. Direct local session creation for S-90, S-91, S-92 and S-93 returned HTTP 404 `SCENARIO_NOT_FOUND`, creating zero sessions and invoking zero adapters. The browser also rejected the S-92 learner route. Phase 6E reconfirmed local review and publication isolation, approved response resolution and the synthetic-data boundaries.

All 45 protected file hashes matched the Phase 7 baseline before and after verification. A fresh review-store read and verified export matched the same S-92 snapshot, approval, publication attempt, lineage and 13 audit events at journal sequence 10. The S-01 package pin remains `aea62488777054921bbd3527fe1f2366e02d81d2ee0a6c0990c6e4163a8c3e46`. The approved S-92 content hash remains `7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337`. Its historical publication result remains `PUBLICATION_BLOCKED` and runtime eligibility is false.

Real calls totaled Prisma 0, Timbre 0, Evon 0 and other LLMs 0. The offline process counters showed zero STT and TTS attempts before and after the restart. The offline launcher uses local mock adapters and the suites use offline doubles.

## F. Regression results

| Command or check | Result |
| --- | --- |
| `npm run test:phase7` | 43/43, zero failures or skips |
| `npm run test:phase6e` | 214/214, zero failures or skips |
| `npm run check` | 1,203/1,203, zero failures or skips. Typecheck, lint, scenario validation, package/API/web builds, and secret scan passed. |
| `git diff --check` and `git diff --cached --check` | Passed. |
| Protected SHA-256 comparisons | 45/45 matched. |

The full check includes the Phase 5 behavior, pressure, terminal, and runtime-invariant suites plus the Phase 6 and Phase 7 regressions. Vite reported a 537.61 kB minified JavaScript chunk above its advisory threshold. Both the build and local recording flow passed.

## G. Delivery and freeze

The runbook and two evidence files are new. The roadmap, evidence ledger and eleven web files were modified. The machine-readable file lists the exact paths, browser cases, sanitized API outcomes, preflight results and fingerprints. Use `npm run dev:api:offline` and the fixed Vite command in the runbook. The two-terminal setup and startup/recovery procedure passed on Windows with Node 22.19.0 and npm 10.9.3.

The recording is scoped to typed practice. Physical microphone behavior and paid-provider execution were outside this verification. Real Evon is absent. Session history is tab- and API-process-scoped. These limits leave the recorded learner, trainer and results paths available. The remaining operator step is to run the preflight on the recording machine. Phase 8 is complete and freeze is recommended. After owner review and staging of the intended files, use `git commit -m "Freeze Vishing Vaccine offline demo"`. [Runbook](../demo/phase8-final-loom-runbook.md)
