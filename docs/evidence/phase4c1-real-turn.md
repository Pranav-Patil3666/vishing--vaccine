# Phase 4C.1 — runtime integration and acceptance boundary

Initial implementation: **2026-10-13**. Latest acceptance preflight: **2026-10-14**. Classifier robustness follow-up: **2026-10-18** (user timezone Asia/Calcutta).

**PHASE 4C.1 STATUS: INCOMPLETE — OFFLINE ROBUSTNESS FIX; LIVE RETRIES A + B PENDING.**

The original implementation was completed offline while S-01 was DRAFT. The user subsequently reviewed and explicitly approved the exact Hindi/Hinglish content, promoted through the existing lifecycle to canonical **S-01 v0.2.0 / hi-IN / RUNTIME_ELIGIBLE**. See [the completed approval record](s01-hi-en-runtime-approval.md). The preflight below opened no provider connection. The user has now reported **four physical live attempts**, preserved below: the first exposed missing loanword aliases, the second succeeded after that fix, and the third/fourth exposed rejection-scope and phonetic-English gaps. This follow-up is entirely offline; two targeted physical checks and cleanup evidence remain pending.

## LIVE ATTEMPT 1 — original user-reported observation

Source: user's **PHASE 4C.1 LIVE ACCEPTANCE FIX — HINDI/HINGLISH CLASSIFIER NORMALIZATION** brief, received2026-10-14. This is a human report of the physical browser/real-Prisma run, not a new agent-observed socket trace. Exact capture time, session ID and full Finish JSON were not supplied; none are invented.

| Field | Original observation — not changed by the fix |
|---|---|
| Physical input / transport | User reports physical browser mic → existing capture/backend path → real Prisma → transcript → classifier/policy → event/pressure timeline |
| Scenario / language | Approved canonical S-01 v0.2.0 / hi-IN, per acceptance context |
| Intended spoken input | Main pehle independently verify karunga. |
| Actual normalized transcript | **मैं पहले इंडिपेंडेंटली वेरिफाई करूंगा।** |
| Transcript script | Devanagari, including English loanwords written in Devanagari |
| Classifier | **UNKNOWN** |
| Policy / response ID | **SAFE_FALLBACK / system.safe-fallback** |
| Tactic | Not separately supplied; the existing fallback policy selects no tactic |
| Pressure | **0** |
| Reported fallback text (approximately) | Baat clear nahi hui; pressure badhaye bina practice call yahin rokte hain. Aap known official app ya number se independently verify karein. |
| Displayed local response latency | **2631 ms** |
| Displayed local speech duration | **2960 ms** |
| Overlap candidate | **false** |
| Provider segment count | **1** |
| Canonical event / pressure point | **1 / 1**, user-reported |
| Session | **COMPLETED** |
| Provider connection / first transcript | Approximately **954 ms / 11084 ms**, one displayed service-clock sample; not learner response latency or provider-only inference time |
| Optional segment IDs/indexes/provider timestamps/duration/latency | Not supplied; missing optional metadata is not a failure |
| Source sample rate / frame count / caller and learner boundary instants / pre-speech silence | Not supplied; do not reconstruct from expected formulas |
| Detailed mic/worklet/socket cleanup and raw-audio persistence observation | Not separately reported; COMPLETED alone is not a physical resource observation |
| Outcome | Live transport/runtime path succeeded; deterministic classifier coverage gap discovered |

The brief also reports a favicon404; it is unrelated and was left unchanged. There is no reported voice transport failure to optimize. No accuracy, WER, p50/p95, billing or robustness claim follows from this one case. At the original 2026-10-14 correction handoff there was **1** reported Phase4C.1 provider attempt, **0** implementation calls and **0** retries. The later attempts below extend that history without changing this result.

## Generalized classifier correction — offline, 2026-10-14

Root cause was reproduced before editing: the actual transcript returned UNKNOWN. `normalizeTranscript` only applied NFKC/whitespace; verification used fixed Roman and native-Hindi phrase regexes, without aliases for the Devanagari English loanwords. A separate partially duplicated verification regex also drove a safety signal.

`apps/api/src/behaviorClassifier.ts` now centralizes classifier-only Unicode-aware clause/token normalization and a bounded alias vocabulary. It preserves Devanagari combining marks and whole-token boundaries; lowercases only internal matching forms; retains negation and exact dummy-token spelling. Existing exported transcript normalization and provider/UI text are unchanged. No full acceptance sentence appears in runtime matching logic.

Concepts cover learner/self action, independent action (`independently`, `khud`, `खुद`/`ख़ुद`, `स्वयं`, observed `इंडिपेंडेंटली` and a bounded spelling variant), verify/check/confirm actions (including observed `वेरिफाई` and bounded variants), official/known app/website/channel/number/contact, first-person future forms, and exclusions for negation/caller instructions/secret handover. These are authored deterministic aliases with offline coverage, not newly observed provider spellings or a general transliteration service. Verification nouns alone do not establish action/intent.

Matching requires learner control plus a verification/check action (or a call to an official/known contact) and independent or official/known-channel context. Pair relationships are bounded to nearby tokens. Clause-local negation, caller-directed/provided channels, token handover, questions and insufficient evidence cannot produce VERIFIED_INDEPENDENTLY. Commas do not discard trailing negation. Unsupported or ambiguous language remains subject to the existing conservative rules; this is not general natural-language understanding.

Precedence is preserved: confirmed upstream dummy disclosure → positive independent verification → refusal → explicit compliance → stalling → UNKNOWN. Verification was already ahead of refusal; refusal of credentials followed by a separate positive verification clause still yields verification, while refusal/negation of verification itself does not. No new secret detection was added. The same verification match now drives its contextual safety signal and explains decisions through the existing `behavior.verify_independent` ID plus matched concept IDs. No production UI complexity was added.

Offline validation: classifier **59/59 PASS**; classifier/runtime/canonical review regression group **140/140 PASS**. Added **58 tests** (56 classifier cases and2 canonical runtime cases) over baseline342; no existing tests removed or renamed. Canonical runtime replay preserves the exact Devanagari transcript and yields VERIFIED_INDEPENDENTLY → existing SAFE_VERIFIED → `system.safe-ending`, null tactic, pressure0, one event/point and cleanup through an injected offline recognizer. A combined independent-verification/dummy-token case proves disclosure still wins. These are offline replays, not changes to Attempt1's result.

Full `npm run check`: **PASS**, exit0; **400/400 tests** (baseline342 +58 additions), typecheck, lint, scenario validation, API/web builds and secret scan. `git diff --check`: **PASS**. File hashes confirm all scenario/authoring/history content, approval report, adaptive policy and provider/timing implementation files are unchanged from the start of this fix. Temporary test logs removed. No existing tests removed or renamed; no commit created.

Files changed by this fix: `apps/api/src/behaviorClassifier.ts`, `apps/api/src/behaviorClassifier.test.ts`, `apps/web/src/audio/realVoice.test.ts`, this report, `docs/evidence/evidence-ledger.md`, and `docs/architecture/real-voice-turn.md`. S-01 content/approval, adaptive policy, Prisma adapter, transcript assembler, audio/VAD/timing, environment and credit/provider configuration are unchanged.

## LIVE ATTEMPT 2 — user-reported successful alias correction

Source: user's classifier-robustness brief received **2026-10-18**; exact capture time and full Finish JSON not supplied. This updates the former pending-retry placeholder with the user's actual report.

- Intended learner input: same/similar to Attempt1, **Main pehle independently verify karunga.**
- Provider transcript: described as similar to the previous Devanagari result; **exact text not supplied**.
- Observed classifier/policy: **VERIFIED_INDEPENDENTLY → SAFE_VERIFIED**.
- Meaning: independent verification was recognized after the prior alias patch, in this reported case.
- Response ID/text, tactic/pressure, local timings, segments, event/point counts and physical cleanup: not separately supplied; do not copy Attempt1 values or prefill expected values.

## LIVE ATTEMPT 3 — leading rejection scope gap

Source: same 2026-10-18 user brief; exact capture time, provider transcript and full Finish JSON not supplied.

- Intended/spoken input, approximately: **Nahi, main independently verify karunga.**
- Provider transcript: **not supplied**; the spoken phrase is not an exact transcript claim.
- Reported classifier: **UNKNOWN**; policy result not separately supplied (existing UNKNOWN policy resolves SAFE_FALLBACK).
- Identified gap: the prior token normalizer retained leading `nahi` as action negation, and the matcher rejected any clause containing negation. This deterministic failure is reproduced offline using the intended phrase; it is not a reconstruction of missing provider text.
- Other live measurements/cleanup: not supplied.

## LIVE ATTEMPT 4 — English speech under hi-IN gap

Source: same 2026-10-18 user brief; exact capture time, screenshot/log and full Finish JSON not supplied. Repository evidence contains no additional exact transcript for this attempt.

- Intended/spoken input: **I will independently verify.**
- Provider transcript, **approximate fragment only**: **आई विल इंडिपेंडेंटली वेरिफाय ...**. Ellipsis is the report's omission, not verified provider punctuation or a known suffix.
- Reported classifier/policy: **UNKNOWN / SAFE_FALLBACK**.
- Identified gap: `आई`, `विल` and `वेरिफाय` were missing bounded aliases. Synthetic completions and mixed-script concept combinations reproduce and cover this gap offline; they are explicitly not full observed live transcripts.
- Other live measurements/cleanup: not supplied.

## Classifier robustness correction — offline, 2026-10-18

Before editing, the intended Attempt3 phrase produced UNKNOWN with tokens `negation/self/independent/verify/intend`. A synthetic Attempt4-style completion `आई विल इंडिपेंडेंटली वेरिफाय करूंगा।` also produced UNKNOWN: `आई`, `विल`, `वेरिफाय` remained unrecognized. The existing aliases were whole-token mappings, not full-sentence matches. Existing precedence was and remains confirmed dummy disclosure → independent verification → refusal → compliance → stalling → UNKNOWN.

The internal pipeline remains raw provider/UI text unchanged → classifier-only NFKC/Unicode word-and-mark tokens → centralized bounded aliases/concepts → scope checks → existing labels. Added forms: `स्वतः`, `इन्डिपेंडेंटली`, `वेरिफाय`, `चेक`, `कन्फर्म`, `आई`, `विल`, plus Latin `will` as FUTURE and `nope`/`mat`/`नॉट` rejection/negation controls. Existing `apne aap`, native/Roman future forms, verification nouns, independent/check/official/known-channel concepts remain compositional. A verification noun still needs a learner future/action form; a noun or action alone does not establish independent verification.

A bounded scope rule gives only an initial standalone no/nahi/nahin/native equivalent/nope/mana marker immediately followed by explicit SELF the internal REJECTION role. This tolerates omitted STT commas without requiring a whole sentence. Any later negation, or an initial not/never/refuse/mat, retains NEGATION and vetoes verification in that action clause. Commas otherwise stay inside action scope, so `verify, nahi karunga` cannot become a positive match. Hard sentence/semicolon/conjunction boundaries retain the previous clause handling. This is a limited deterministic scope rule, not a full language parser.

Evidence IDs now include `behavior.scope.leading_rejection` when applicable and `behavior.scope.action_not_negated` on successful matches, alongside learner/action/independent/channel concepts. No new labels or production UI controls were added. Caller-directed instructions/provided channels, caller participation, questions, secret handover, and insufficient agency/context retain conservative exclusions; directed `aapke saath` participation is also excluded. Existing refusal/compliance/stalling patterns and upstream-confirmed dummy precedence are unchanged. Unsupported refusal wording such as `Main kuch nahi bataunga.` remains UNKNOWN under those existing patterns.

Tests added: **101 classifier cases** (including a 60-case synthetic concept cross-product, leading rejection, action negation, bounded aliases, false positives, normalization and precedence) and **5 approved-canonical runtime replays**. The runtime cases cover positive Roman/English/phonetic-English and negative action scopes, preserve exact transcript/segment/UI text, use existing terminal response/pressure policy, append one event/point, retain local timing and clean injected streams/PCM. No real provider is contacted.

Validation: classifier **160/160 PASS**; configured classifier/runtime/canonical-review group **246/246 PASS**. An initial combined invocation omitted the repository's JSX tsconfig, causing six `React is not defined` render failures (including an existing test); rerunning with the existing `apps/web/tsconfig.app.json` command passed without changing production rendering.

Full `npm run check`: **PASS**, exit0; **506/506 tests**, baseline400 +106 additions (101 classifier,5 runtime), no tests removed. Typecheck, lint, scenario validation, API build, web build and secret scan all PASS. Scenario validation confirms canonical/package approval and **runtime=true**. `git diff --check`: **PASS**. File hashes show exactly the six files listed below changed during this follow-up; approved scenario/package/candidate/history, policy, Prisma adapter, timing/VAD, environment examples and provider configuration sources are unchanged. Temporary validation logs/hash snapshot removed; no commit created.

Files changed in this follow-up: `apps/api/src/behaviorClassifier.ts`, `apps/api/src/behaviorClassifier.test.ts`, `apps/web/src/audio/realVoice.test.ts`, this report, `docs/evidence/evidence-ledger.md`, `docs/architecture/real-voice-turn.md`. No full sentence is hardcoded in runtime matching. No LLM, translation or whole-sentence transliteration was added. Implementation provider calls: **0**. S-01 content/approval, policy, Prisma adapter, VAD/timing/framing, environment, language and credits are outside this change.

## LIVE RETRIES A + B — pending physical checks

**NOT EXECUTED by this follow-up.** At most two new physical checks are prepared, each in a fresh approved S-01 REAL_STT session:

**READY FOR LIVE RETRY A + B.** Offline validation passed; physical live success is not prefilled.

| Retry | Say after the cue | Expected for a semantically equivalent transcript |
|---|---|---|
| A | Nahi, main independently verify karunga. | VERIFIED_INDEPENDENTLY → SAFE_VERIFIED |
| B | I will independently verify. | VERIFIED_INDEPENDENTLY → SAFE_VERIFIED |

Both should resolve existing `system.safe-ending`, null tactic, pressure0, one event/point and COMPLETED; these are expectations, not measured results. Record each actual Finish response and physical cleanup separately. No negative live tests, extra provider probe or automatic retries are authorized for this fix. Preserve failures if either occurs. Phase4C.1 remains INCOMPLETE until both previously failing positive cases succeed live and cleanup evidence is returned.

## Final acceptance preflight — 2026-10-14

Preflight evidence recorded at **2026-10-14 06:41:15 UTC**; this is not a live speech/provider observation timestamp.

- Root `.env` loads through existing server-only `loadRootEnvironment` / Node `loadEnvFile`; existing process values take precedence. `GNANI_API_KEY`: PRESENT; valid runtime configuration: PRESENT; positive STT cost and configured credit capacity: PRESENT. No secret value was printed. The only local configuration change was enabling the non-secret `PRISMA_RUNTIME_ENABLED=true`; `.env` remains ignored and `.env.example` remains unchanged.
- Confirmed actual script startup: `npm run dev:api` → `Vishing Vaccine API listening on 127.0.0.1:3001`; `npm run dev:web` → Vite `Local: http://127.0.0.1:5173/`. Web and proxied health returned HTTP200 in development.
- One **non-billable, unconsented readiness session** used canonical S-01/version0.2.0/hi-IN/REAL_STT. Runtime status returned READY; lifecycle RUNTIME_ELIGIBLE; consent not-requested; event count0; pressure point count0. No `/real-audio/start` or frame/finish request was issued, and the session was ended. Temporary API/web processes were stopped after readiness checks; no listeners remained on3001/5173.
- Fixed baseline remains `wss://api.vachana.ai/stt/v3/stream`; credential from server `GNANI_API_KEY` via `x-api-key-id`; `lang_code=hi-IN`; `x-sample-rate=16000`; mono PCM16LE/1024bytes. Provider implementation, framing, language, credit settings and approval history are unchanged.
- Boundary inspection found a genuine defect: VAD used confirmation times, adding start evidence delay and end hangover to learner timing. The smallest correction retains all thresholds/windows but estimates start at the first qualifying block's start and end at the last above-off-threshold block's end. Caller callbacks and later-confirmed VAD boundaries are sorted chronologically within the same bounded browser-clock fact list; overlap is retained rather than clamped away. These are block-level estimates based on browser callback time and block duration, not hardware sample timestamps or measured acoustic accuracy.
- Existing real-turn aggregation uses first local start and final local end across the response. A defect allowed an unfinished last segment to borrow an earlier end; it now leaves whole-turn duration unavailable. A completed response uses first start → last segment end, including internal pauses; this is elapsed response span, not summed voiced time. Automatic completion still occurs on a confirmed end after the cue; no segmentation or VAD tuning was added. Development discard diagnostics are labeled **Latest segment**; the real result's canonical duration is turn-level.
- Focused regressions: **80/80 PASS**. Six new tests cover boundary estimates/candidate reset, caller/VAD confirmation ordering and overlap, complete multi-segment aggregation, and an unfinished final segment. Two focused runs exposed stale diagnostic-label expectations after labeling latest-segment facts; expectations were corrected. No live failure/retry occurred.
- Full `npm run check`: **PASS**, exit0; typecheck, lint, **342/342 offline tests**, scenario validation, API/web builds and secret scan. Pre-task baseline336; six new tests; none removed. `git diff --check`: **PASS**. The approved scenario/package/history/report files were hash-compared before/after and remain unchanged.

## Existing run steps for targeted live retries A + B

Physical learner speech must come from the user. Four historical attempts are now reported; these steps apply only to new retries A + B above (maximum two new provider turns). Keep existing API/web processes if running; `tsx watch` reloads the classifier. Refresh the pre-call page and create a fresh session for each check rather than reusing a completed turn. Commands below are needed only if the development servers are stopped. The fix stops at this handoff until real observations are supplied.

Terminal1 — API:

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:api
```

Expected: `Vishing Vaccine API listening on 127.0.0.1:3001`.

Terminal2 — web:

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:web
```

Expected: Vite `Local: http://127.0.0.1:5173/`. The inspected local `.env` already contains `PRISMA_RUNTIME_ENABLED=true`; no manual secret/environment assignment is needed.

1. Open `http://127.0.0.1:5173/#/training/precall/S-01` (canonical S-01 / Northstar Cooperative Bank). Keep DevTools Network open for Fetch/XHR evidence; use headphones to reduce cue bleed.
2. Choose **REAL STT · one hi-IN voice turn**, tick the simulation-consent checkbox, and click **Start simulation**.
3. In **Voice response**, read the approved opening text, tick the separate transient-microphone consent checkbox, and click **Start real voice turn** once. Allow browser microphone permission.
4. Remain quiet through calibration and the actual three-second mock tone cue. Wait until it ends and **Respond now** is shown.
5. For A say **Nahi, main independently verify karunga.** For B, in a separate fresh session, say **I will independently verify.** Stop speaking naturally. Wait for local VAD completion, **FINISHING**, and the real result. Do not submit typed text or extra controls; do not manually retry on failure.
6. Copy the **response JSON only** from the request ending `/real-audio/finish` (successful result or sanitized error). Do not copy request headers, the `/start` token response, raw PCM or credentials. This finish result includes normalized text, segments/reference metadata, classifier/policy/response, canonical local timing facts, session events and pressure points. Also report the source sample rate shown under **Real turn technical facts** and whether the microphone indicator stopped.
7. After capturing each result, click **End simulation** if still available and report cleanup/error behavior. Preserve each output. Stop after A + B; do not run additional or negative live tests.

Requested return evidence: actual normalized transcript/script; segment count/IDs/indexes/optional metadata; behavior; terminal/tactic; pressure; responseId/text; caller start/end and learner start/end with browser clock identity; local latency/silence/duration/overlap; provider connection/first-transcript reference times; canonical event and pressure-point counts; frame counts; microphone/backend cleanup; error stage/code if any. Missing optional provider metadata is not a failure.

## Implementation

- Backend `PrismaRealtimeSpeechRecognizer` implements the existing `SpeechRecognizer` with an optional provider-neutral streaming extension. API composition alone selects it; turn/session code consumes interfaces. Phase 4A verification utilities are not runtime dependencies.
- Browser capture reuses Phase 4B end to end, including local VAD, actual mock cue callbacks, clock identity, 48k/native resampling, mono 16k PCM16LE, exact 1024-byte frames, bounded forwarding and teardown. No worklet/DSP/VAD tuning changed.
- Separate `real-audio/{status,start,frame,finish,cancel}` routes enforce local origin/Host, session/turn/clock correlation, both consent checks, first-turn S-01/hi-IN scope, approved content, limits and credit reservation. Existing development discard sink and mock typing remain separate.
- Runtime uses the verified v3 participant endpoint and headers, one socket per turn, waits for `connected`, streams bounded PCM, sends paced zero frames for settling, drains for a bounded interval and requests close 1000. It never retries or calls Timbre/Evon.
- Normalized optional segment metadata preserves reference timestamps/IDs/indexes/duration/latency. Whitespace normalization preserves Unicode. Indexed ordering, arrival fallback, duplicate protection, bounded segment storage and conflicting-identity failure are deterministic. No partial/replacement/finalness capability is inferred.
- Existing classifier, adaptive policy, resolver, learner-turn builder, event log and pressure builder are reused. One response produces one decision/event. Local browser timing supplies latency/duration; provider time cannot replace it. Interruption remains unavailable. Only `DUMMY-\d{4}` disclosure is accepted in the runtime path; old named fixtures retain mock-only compatibility.
- Approved response text is available in the real-turn panel; no synthesis/cache/TTS operation is performed. The panel distinguishes Prisma transcript, deterministic classifier/policy, browser timing and provider reference metadata. Existing End stops the mic immediately and cancels the backend stream.
- No raw audio persistence/logging was added. Backend counts and metadata-only final summaries are retained; returned transcript/segment text uses existing sensitive-value redaction. Credentials remain server-only. `.env.example` adds a disabled opt-in flag; root `.env` is unchanged and ignored.

See [runtime architecture and limits](../architecture/real-voice-turn.md) for API details, lifecycle, timing domains, default settings and limitations.

## Historical offline implementation validation — 2026-10-13

Canonical baseline before this task: **226 tests**. Current suite: **288/288 passing**, with **62 added tests**. `npm run check` covers typecheck, lint, offline tests, scenario validation, API/web builds and secret scan.

Coverage includes:

- Observed connected/speech_start/transcript shapes; optional metadata; Unicode/Latin/Devanagari/mixed text; whitespace; ordered/missing-index segments; duplicates; conflicting identities; empty transcript.
- Malformed JSON/transcripts/metadata, unknown/unverified events, wrong accepted configuration, socket error/early close, connect/total/close deadlines, bounded forwarding and stale callbacks.
- Five existing behavior labels and approved-fixture policy responses; verified terminal behavior; exact dummy token and rejection of real-looking numbers/legacy mock tokens; safe word; no-speech versus empty-STT; zero TTS calls.
- Local latency 450 ms and duration 1000 ms despite deliberately unrelated provider reference metadata; overlap produces null latency and unknown interruption. One canonical event and one pressure point only.
- Consent/credit/config/content gates, original DRAFT content rejection, first-turn restriction, cross-origin/Host rejection, invalid frames/sequences/clocks, duplicate Finish, end/cancel during pending transcription and cleanup.
- The actual browser forwarder → local HTTP runtime → actual Prisma adapter → **local fake WebSocket** → existing intelligence → component render chain. Two provider-shaped segments plus a duplicate assembled to `मैं official channel se verify करूंगा`, classified `VERIFIED_INDEPENDENTLY`, selected the fixture safe terminal response and produced one event/point. This is entirely offline and is not an observed Prisma transcript.
- Phase 4B runtime-option controller regressions cover cue/calibration ordering, local VAD finish, overlap, no-speech timer cleanup and a stale queued finish. Existing fetch receiver and development completed-summary regressions remain.

The first full-chain test assertion read the fake server's close code before its asynchronous notification. The test was corrected to await the actual close event rather than assume event ordering. Earlier typecheck placement was corrected by keeping web/HTTP/component integration coverage in the web test workspace. These were test-harness corrections, not provider observations.

## Live acceptance record

| Required live observation | Current record |
| --- | --- |
| Real provider attempts | **4 historical user-reported attempts; 0 additional during this fix** |
| Real physical browser response | Attempts1–4 reported; targeted retries A + B pending |
| Scenario/language | Canonical approved S-01 v0.2.0 / hi-IN Hindi-Hinglish; runtime eligibility true |
| Browser/source rate | No new live measurement; prior Phase 4B device QA is reported complete by the user |
| Target audio | Implementation fixed to mono PCM16LE, 16000 Hz, 1024 bytes/frame |
| Provider transcript/script/segment count | Attempt1 exact Devanagari/1; Attempt2 described as similar but exact text absent; Attempt3 absent; Attempt4 approximate phonetic-Devanagari fragment only |
| Live behavior, tactic, pressure | Attempt1 UNKNOWN/SAFE_FALLBACK/0; Attempt2 VERIFIED_INDEPENDENTLY/SAFE_VERIFIED; Attempt3 UNKNOWN; Attempt4 UNKNOWN/SAFE_FALLBACK; further tactic/pressure data not supplied |
| Live approved response ID/text | Attempt1: system.safe-fallback; approximate reported text preserved above |
| Live caller end/learner start/end/latency/duration/overlap | Boundary instants not supplied; displayed2631ms latency,2960ms duration, overlap=false |
| Live provider connection/transcript/policy timing | Approximately954ms connection /11084ms first transcript; policy timing not supplied |
| Live event log / pressure timeline / cleanup | Attempt1 reports1 event/1 point and COMPLETED; detailed physical cleanup not supplied |

No STT/classifier accuracy, p50/p95, provider billing or physical compatibility claim follows from these offline fixtures. Historical Phase 4A evidence is untouched. Prior Phase 4B pending reports remain historical; the latest user brief reports its manual cases completed without supplying new quantitative records.

## Created files

- `packages/contracts/src/realVoice.ts`
- `apps/api/src/providers/prisma/runtimeConfig.ts`
- `apps/api/src/providers/prisma/prismaRealtimeRecognizer.ts`
- `apps/api/src/providers/prisma/transcriptAssembly.ts`
- `apps/api/src/providers/prisma/prismaRealtimeRecognizer.test.ts`
- `apps/api/src/runtimeAudioIngress.ts`
- `apps/api/src/testing/realVoiceFixture.ts` — explicitly offline-only; never runtime scenario approval
- `apps/web/src/audio/realVoice.test.ts`
- `apps/web/src/components/RealVoiceTurnPanel.tsx`
- `docs/architecture/real-voice-turn.md`
- `docs/evidence/phase4c1-real-turn.md`

## Modified files

- `.env.example`, `package.json`
- `packages/contracts/src/domain.ts`, `providers.ts`, `index.ts`
- `apps/api/src/errors.ts`, `health.ts`, `server.ts`, `session.ts`, `turnOrchestrator.ts`, `learnerTurnEventBuilder.ts`, `timing.ts`
- `apps/web/src/App.tsx`, `sessionApi.ts`
- `apps/web/src/audio/controller.ts`, `controller.test.ts`, `transport.ts`, `useBrowserAudio.ts`, `privacy.test.ts`
- `docs/architecture/browser-audio.md`, `provider-abstraction.md`, `prisma-realtime-contract.md`, `session-api.md`, `timing-model.md`, `frontend.md`
- `docs/evidence/evidence-ledger.md`

## Remaining live observation

The transport chain and one corrected classification have user-reported live evidence. The latest two classifier gaps are corrected offline. Phase4C.1 remains incomplete until targeted retries A + B confirm semantically correct classification, existing approved policy/response resolution, one event/point and cleanup. Return each actual Finish response JSON, source rate and microphone/stream cleanup observation. Historical provider attempts: **4 user-reported**; additional calls during this fix: **0**; new retries A + B: **0/2 executed**. Phase4C.2 has not begun; no Timbre or Evon call.

PHASE 4C.1 STATUS:
INCOMPLETE
