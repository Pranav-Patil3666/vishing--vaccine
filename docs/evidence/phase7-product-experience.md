# Phase 7 product acceptance

Phase 7 joins learner training, the trainer's authoring evidence, and recent results into one walkthrough. S-01 v0.2.0 is the learner release. S-92 v0.1.1 is the separate human approval and blocked publication example. [Runbook](../demo/phase7-product-walkthrough.md) · [Machine evidence](phase7-product-experience.json)

## Before implementation

The starting tree was clean at `de2f4e8`, the Phase 6 completion commit. The audit covered the hash router and app shell, learner and trainer pages, shared API and event contracts, audio controllers, authoritative runtime catalog, session store, policy and debrief code, Phase 5/6 tests, roadmap, and prior acceptance records.

| Area | Existing behavior and gap | Phase 7 decision |
| --- | --- | --- |
| Landing and catalog | Landing CTAs skipped scenario choice. The library blended published releases and bundled draft metadata, displayed draft demo actions, and treated connection failure as an empty list. | Landing opens Training. Learner cards use the server catalog. Loading, unavailable, empty and withdrawn states are distinct. |
| Briefing and consent | Consent, live S-01, one-turn voice and mock mode were wired. The copy mixed development details and AI voice labels with typed practice. | Keep existing routes and mode separation. Explain the selected mode and require affirmative consent before creating a session. |
| Active call | Automatic audio worked, but its primary controls sat below contradictory mock telemetry. Typed S-01 requests set the legacy `demoMode` flag and routed to the generic safe fallback. | Put the automatic controller first. Approved typed practice selects the existing safe policy path and displays the approved response reference as text. |
| Debrief | Existing event-based pressure timeline and rubric. Missing debrief could show default score values, and top-level coaching was hard to find. | Put outcome and evidence first, keep detailed timing and rubric in an expandable section, and limit feedback when data is missing. |
| Trainer | Existing local generate/import, schema and safety validation, ancestor preview, verified workflow export, CLI proposals and approval audit. Status distinction was buried. | Keep the existing workflow, clarify intake and separate review, publication and runtime availability. |
| Results | Backend had an in-memory session store and per-ID read route. The browser retained one active ID and showed one result. API restart cleared sessions. | Keep up to 20 recent IDs in session storage for this tab and load existing safe session projections. |
| Offline coverage | Phase 5 fake audio and lifecycle harnesses and Phase 6 isolated typed-release tests were present. | Add the offline browser launcher around the existing API factory. Verify the product journey through the same API and reuse the protected audio regressions. |

## 7A learner experience

- **Selection and consent.** The library loads the backend's authoritative catalog, and Start refreshes that catalog and checks the selected exact version before the existing session gate. S-01 presents its fictional organization, known-channel training objective, Hindi/Hinglish and the turn limit. The briefing explains AI voice and transient microphone transcription for voice mode. Typed practice displays approved caller text. Decline returns to Training without creating a session. A browser reload never grants consent or starts a call.
- **Call and termination.** The automatic call surface maps the actual controller states to plain-language instructions. Microphone permission remains tied to **Start automatic conversation**. Existing audio calibration, actual playback end, streaming, classification, response selection and cleanup remain authoritative. **End simulation** stops browser resources before the API request. Navigation and page reload close an unfinished call, and late browser callbacks cannot open another result. An already-admitted typed turn settles before End commits on the server. This guard applies to typed work and leaves live cancellation in place.
- **Offline practice.** The demo API uses the existing factory with mock adapters and no provider credentials. The client uses the approved S-01 pin and deterministic classifier/policy. The initial synthetic sample revealed an honest safe-fallback branch in the browser. The final **Ask for time** sample uses the established `I need more time.` test phrase, and **Verify independently** uses the existing Hinglish test phrase. No classifier change was needed.
- **Debrief.** The heading shows the scenario, version, mode, time started when recorded, completion status and exact outcome meaning. The number of committed events drives the turn count. Coaching follows those events. An expressed verification choice does not prove an external check. Agreement remains distinct from synthetic disclosure, and safe fallback and max turns are neutral outcomes. Learner stop remains a separate status. The tactic list uses each event's actual caller category and ignores merely selected future tactics. The existing reviewed feedback, pressure timeline and observable rubric remain available when their evidence matches the session. Missing turn or rubric data is reported as limited evidence.

The browser ran S-01 with `STALLED → VERIFIED_INDEPENDENTLY`. It displayed the approved authority continuation, then opened a two-turn independent-verification debrief. The backend recorded `SAFE_VERIFIED`, selected `authority` and `system.safe-ending`, and recorded caller pressure 0 then 1. A separate typed `stop simulation` run opened **Safe word used**, with one committed event and capture disabled. The real live-mode briefing was opened read-only and showed the AI voice and microphone disclosure with Start disabled before consent. The existing live pipeline was exercised with fake browser capture, STT and TTS in regression tests.

## 7B trainer experience

Scenario authoring presents generation/import, validation, human review and controlled publication as distinct steps. It gives the exact existing CLI commands and reads saved files locally. Opening a draft automatically runs the existing schema and safety checks. Findings distinguish blocking errors, reviewable warnings and information. The preview preserves hashes, version and provenance, content sections, ancestor loading and validated graph facts.

The browser opened S-90 as `DETERMINISTIC_MOCK` and S-91 as `MANUAL_IMPORT` with an unverified declared origin. Each had zero errors and two warnings. The S-92 saved revision alone returned `LINEAGE_INVALID`. Selecting its original saved ancestor cleared the finding. Opening the verified workflow export replaced the standalone preview, showed `APPROVED`, current validation, 20/20 mandatory checks passed, zero errors and warnings, `PUBLICATION_BLOCKED` and **Not playable**. The UI displayed the original approval and publication IDs and seven recorded compatibility blockers. The exact historical snapshot remains in the read-only workflow export. No browser write endpoint was added. Existing proposals remain downloads for the local CLI.

## 7C dashboard and results

The backend still stores sessions in process memory. The browser stores only a bounded list of session IDs and an active-session ID for recovery in this tab. It reads the existing safe session endpoint after reload. There is no new store, identity, raw audio, transcript history, or backend session listing. Restarting the API expires the results. A missing ID, failed lookup or empty index has an explicit state. A session's stored metrics supply its start time when available.

| Metric | Definition |
| --- | --- |
| Recorded | Unique available session IDs from this tab, including any still in progress. |
| Completed | Calls whose existing lifecycle reached normal completion. |
| Stopped | Calls closed by learner stop or safe word, including typed safe-word outcomes. |
| Independent verification and practice-token disclosure | Ended sessions with the corresponding recorded terminal decision. A decision remains visible if closing playback was interrupted. |
| Outcome breakdown | One closure category per ended session. In-progress sessions are excluded. Interrupted closure stays distinguishable from a normal terminal outcome. |
| Observed decisions and caller tactics | Counts per committed turn. Caller exposure uses the recorded caller category, and learner behavior uses the committed classification. |

History orders sessions newest first and links each ended session to the same debrief representation. Voice practice and offline demonstrations have separate groups. The browser observed the empty state, three offline records covering verification, safe fallback and safe-word stop, three outcome buckets with the denominator of three, and the same three history rows after reload.

## Quality and safety

The primary destinations are Overview, Training, Scenario authoring and Session history. The keyboard skip link focused the main content without changing the hash route. The catalog, results and call state use text and accessible status messages. The browser was inspected at 1280 px desktop width and 820 px tablet width, with a working tablet menu, focus landing on the destination main region, and no page-level horizontal overflow. The final tablet history table fit its 734 px container with 13 px body text. This was a targeted check of the demo path.

Trusted response resolution, provider integrations, deterministic policy and classifier, terminal commits and live audio guards retain their existing behavior. Phase 6 tests enforce draft/approval/hold/tamper isolation. The browser and local API both rejected S-92 as a learner scenario. The offline API also reported zero Prisma and Timbre attempts. Evon and other LLM calls were zero.

Before and after verification, the Phase 6 reference was used to check 14 original fingerprints, 16 Phase 5 fingerprints, the separate S-01 line fingerprint and 14 additional files. Those files include all 10 review journal commits, the actor policy and the S-92 export. The fresh registry and verified export retained sequence 10, the same head, exact S-92 approval, audit and publication history. The real playable catalog retained S-01 v0.2.0 only. Test lifecycle writes remained disposable. [Phase 6 reference](phase6e-acceptance.json)

## Checks and limitations

The focused test command covers the learner browser/API journey, history restoration, failure and retry, permission denial and cancellation, debrief semantics, dashboard aggregation, the automatic start panel, session client and typed End race. The Phase 6 acceptance command covers authoring, review and publication integrity. The full check covers Phase 5, Phase 6 and Phase 7, including fake live providers, media release, terminal playback, stale observations and no post-terminal turns. Exact run counts and fingerprints are in the machine evidence.

The Loom walkthrough is ready in offline typed mode. The browser inspection of live mode covered disclosure and consent, and live timing and media handling used the established fake-provider tests. A fresh physical microphone or paid-provider session was outside Phase 7 verification. Results are scoped to one browser tab and one API process. Phase 8's final polish, stability and video preparation remain a separate phase.

| Verification | Final result |
| --- | --- |
| `npm run test:phase7` | 40 passed. Includes nine new product and typed-session tests. |
| Audio privacy tests | 7 passed. Updated the existing source check to follow the call page and stop callback. |
| `npm run test:phase6e` | 214 passed. Existing authoring, review and trusted publication coverage. |
| `npm run check` | 1,200 passed, zero failures, cancellations or skips. Typecheck, lint, scenario validation, API and web builds, and secret scan passed. The web build retains its existing chunk-size warning. |
| `git diff --check` | Passed. |
| Protected fingerprints and provider calls | 45 comparisons matched. Prisma 0, Timbre 0, Evon 0, other LLMs 0. |

The new source files contain the training and results pages, session result presentation helpers, Phase 7 integration tests and offline launcher. The implementation updates the shell and router, session API client, typed End route, call and authoring presentation, CSS, and existing regression assertions. The [machine evidence](phase7-product-experience.json) contains the exact file manifest.

**Phase 7 is complete. Learner, trainer and dashboard acceptance passed. The Loom path is ready in offline mode. Phase 8 has not started.**
