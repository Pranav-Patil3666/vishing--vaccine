# Phase 4A — Prisma realtime verification

**PHASE 4A STATUS: COMPLETE — 2026-10-09.** Baseline transport (L2), one isolated short word, one composite segmentation case and one tiny code-mixed synthetic case (L3), plus one omitted-auth error observation (L4), establish the closure requirements. The acceptance table below states the limits. True N: **4 provider attempts total: 1 developer-reported +3 directly observed; 3 accepted connections +1 rejected upgrade**. This task used **2 attempts**, with no retries or concurrent runs. Billing amount remains unknown. No production adapter is activated and Phase4B is not implemented.

Historical sequence: L1 was reported by the developer (connected/authenticated, 16 kHz, speech_start, then unsupported-event failure); its exact first-run timestamps were not supplied. L2 was a directly observed successful baseline. L3 reused one reviewed composite for short, segmentation and Hinglish observations to fit the unchanged project-local cap. L4 omitted only the auth header. Optional features still labeled UNVERIFIED do not block closure.

The developer confirmed that no separate participant-specific documentation is available beyond the official public docs and challenge/account access. Credentials were configured locally for the live probes and are never reproduced here. No credential was present at the initial readiness inspection. Do not infer `ACCOUNT-SPECIFIC` or `NOT SUPPORTED` without evidence.

## Sources and documented hypotheses

Primary references accessed 2026-10-08: [official realtime STT documentation](https://docs.gnani.ai/api/STT/stt-websocket) and [official REST STT documentation](https://docs.gnani.ai/api/STT/speech-to-text). Public documentation is a documented reference, not a live participant observation. REST success would not prove the realtime contract.

The realtime reference describes `/stt/v3/stream`, upgrade-header configuration, raw PCM, segment events and optional VAD settings. Its examples suggest the candidate fields below. They do not establish that this account receives the same behavior. `/stt/v4/stream` and `x-partials` have no participant evidence. No documented default is silently enabled in production.

## Capability matrix

Sources: **D** = public realtime documentation as a hypothesis; **C** = existing local candidate contract; **P** = project verification target; **L1** = developer-reported first live observation; **L2** = direct baseline; **L3** = direct combined speech probe; **L4** = direct omitted-auth probe. L2–L4 were observed 2026-10-09. [L3/L4 sanitized trace](prisma-closure-2026-10-09.json). VERIFIED field presence means observed for these inputs, not always present or required. No capability is VERIFIED by the offline suite.

| Capability | Expected / hypothesis | Observed | Status | Evidence |
|---|---|---|---|---|
| WebSocket endpoint | `wss://api.vachana.ai/stt/v3/stream` | Exact validated nonsecret configuration inspected; connection accepted | VERIFIED (working endpoint for this account/input) | L2/L3; L1 also reported successful connection; version/path not inferred from docs |
| Alternate endpoint | `/stt/v4/stream` | None | UNVERIFIED | P; N=0 |
| Auth header | `x-api-key-id`; selected `GNANI_API_KEY` source | Configured auth accepted; omission rejected with HTTP401 | VERIFIED (working mapping and one omitted-header rejection) | L2/L3/L4; invalid credentials/other accounts untested; secret withheld |
| Language header | `lang_code`; no automatic `hi-en` passthrough | Configured `hi-IN` accepted | VERIFIED (tested configuration only) | L2/L3; other values/omission untested |
| Sample-rate header | `x-sample-rate` | Configured16000 accepted and reported by server | VERIFIED (tested configuration only) | L2/L3; omission/default untested |
| Transcript format | Optional `x-format` | None | UNVERIFIED | D; N=0 |
| Model / preferred-language configuration | No participant configuration established | None | UNVERIFIED | P; N=0 |
| Audio encoding / signedness / sample width | Raw signed 16-bit PCM | Validated PCM16 fixtures sent; transcripts received | VERIFIED (tested fixtures accepted) | L2/L3; alternatives/requirements untested; no accuracy claim |
| Channels | Mono | Validated mono fixtures sent; transcripts received | VERIFIED (tested fixtures accepted) | L2/L3; alternatives/requirements untested |
| Endianness / container | Little-endian; no WAV/MP3 container | Validated raw PCM16LE fixtures sent; no container | VERIFIED (tested fixtures accepted) | L2/L3; alternatives/requirements untested |
| Sample rates | 8000, 16000, 44100, 48000 candidates; 16000 primary | 16000 configuration reported; transcripts in L2/L3 | VERIFIED (16000 tested path); other rates UNVERIFIED | 2 directly observed complete speech runs; no accuracy claim |
| Frame size works | 1024 bytes candidate | L2:114 frames; L3:169 frames; min/max1024 bytes | VERIFIED (1024-byte framing works) | L2/L3; does not establish REQUIRED |
| Frame size required / arbitrary buffering | Exact1024 vs other even frame lengths | None | UNVERIFIED | P; N=0 |
| Final trailing partial frame | Separate explicit experiment | None | UNVERIFIED | P; N=0 |
| Realtime pacing / faster uploads | Probe sends at source cadence; faster upload untested | Existing source-cadence probes completed | VERIFIED (paced path works); faster uploads UNVERIFIED | L2/L3; N=2; tolerance/limits untested |
| Silence / keepalive / idle expiry | Bounded tail silence; no idle assumptions | Two-second zero-PCM tails sent in L2/L3; no dedicated idle experiment | UNVERIFIED (keepalive and idle semantics) | L2/L3; tail acceptance does not establish idle requirements |
| Initial connected / start control | Candidate waits for `connected`; no start frame | `connected`; reported sample_rate16000 and chunk_size512 | VERIFIED (event/config fields only); start-control requirements UNVERIFIED | L1/L2/L3; N=3; reported chunk size does not prove required frame bytes |
| Transcript event | Candidate `type=transcript`, text string | Three transcripts across L2/L3; exact Roman phrase matches false | VERIFIED (event/field presence for these inputs) | L2/L3; N=2 speech runs; no finalness/accuracy/reliability inference |
| Processing event / meaning | Candidate `processing`; speech-end meaning unproven | Not seen in L2/L3 | UNVERIFIED | 2 complete controlled speech runs; no global absence claim |
| Speech-start event | Provider VAD metadata only; no learner timing authority | Live `speech_start` with ISO references; 2 occurrences in L3 | VERIFIED (event occurrence and supplied timestamp shape) | L1/L2/L3; timing semantics/always-present fields not established |
| Other VAD-start events | No architecture dependency | None | UNVERIFIED | P; N=0 |
| Speech-end / VAD-end event | No architecture dependency | Not seen in L2/L3 | UNVERIFIED | 2 complete controlled speech runs; no global absence claim |
| Partials / revisions / replacements | Final-only compatible; ordering unproven | No explicit partial/revision or repeated-segment update seen in L2/L3 | UNVERIFIED | Absence in these runs does not establish NOT SUPPORTED; finalness not inferred |
| Segment ID | Optional candidate string | Present in all3 directly observed transcripts; distinct fingerprints | VERIFIED (presence/type only) | L2/L3; raw IDs suppressed; replacement semantics untested |
| Segment index | Optional candidate nonnegative integer | L2:1; L3:1 then2 | VERIFIED (presence/type and this observed order) | L2/L3; reset/ordering guarantees untested |
| Audio duration | Optional candidate `audio_duration_ms` number | L2:1408; L3:1024,2548 | VERIFIED (presence/type only) | L2/L3; semantic interpretation unverified |
| Provider latency | Optional candidate `latency` number | L2:88; L3:76,65 | VERIFIED (presence/type only) | L2/L3; measurement definition unverified |
| Provider timestamp | Optional ISO reference, never local timing authority | ISO strings in connected, speech_start and all3 directly observed transcripts | VERIFIED (presence/shape only) | L2/L3; clock semantics/skew untested |
| Word timestamps | Excluded from core dependency | None | UNVERIFIED | P; N=0 |
| Per-word / segment confidence, emotion | Excluded from core dependency | None | UNVERIFIED | P; N=0 |
| Minimum segment option | `x-min-segment-ms` not sent; default/effect unknown | None | UNVERIFIED | D/P; N=0 |
| Graceful close / EOS / flush | Probe tests silence + drain + code1000; no EOS control frame | Requested close1000 completed in both complete speech runs | VERIFIED (requested graceful close works); EOS/flush requirements UNVERIFIED | L2/L3; no general close/flush guarantee |
| Reconnect / ping / pong / timeout | No reconnect; WS auto-pong; account behavior unknown | None | UNVERIFIED | P; N=0 |
| Error event / upgrade / close codes | One controlled omitted-auth attempt | HTTP401 upgrade rejection; local WS close1006; no audio sent | VERIFIED (specific omitted-auth error path only) | L4; N=1; JSON body, other errors/retry/failed charging UNVERIFIED |
| Segmentation case | Three speech parts with1200 ms and200 ms gaps | Two speech_start/transcript pairs, segment indexes1→2 | VERIFIED (one composite case observed) | L3; N=1; no causal pause-only or reliability claim |
| Short utterances | One short isolated word and one short phrase | Isolated synthetic `okay` (534.94 ms) produced first segment; later phrase produced second | VERIFIED (arrival for this fixture) | L3; N=1; exact Roman match false; minimum usable duration/reliability UNVERIFIED |
| Supported tested language / Hinglish | `hi-IN`, safe `haan one second` input | Later code-mixed synthetic group produced Devanagari-only output with2 digit characters | VERIFIED (one tiny case/output script observed) | L3; N=1; en-US synthetic voice; general accuracy/word retention/code-mix correctness UNVERIFIED |
| Number / punctuation / normalization | Only benign speech and `DUMMY-4821` permitted | L3 later output contained2 digit characters; source was spoken words | UNVERIFIED (normalization semantics/correctness) | L3; N=1; digit presence alone does not prove intended normalization |
| Request / concurrent / minute-hour limits | Need account docs/dashboard; do not exhaust limits | None | UNVERIFIED | P; N=0 |
| Connection / transcription / failure charging, expiry | Billing unit and actual balance changes unknown | None | UNVERIFIED | P; N=0 |

### Header evidence requirements

| Candidate name | Documented requiredness | Semantic input | Verified accepted values | Omission behavior |
|---|---|---|---|---|
| `x-api-key-id` | Required in public docs; omission rejected in L4 | `GNANI_API_KEY` selected; secret never reproduced | Configured participant credential accepted | HTTP401 upgrade rejection, observed local1006 |
| `lang_code` | Required in public docs | Provider language identifier | `hi-IN` accepted for tested cases | Not tested |
| `x-sample-rate` | Optional in public docs | Actual source sample rate | `16000` accepted | Not tested |
| `x-format` | Optional | Candidate `verbatim` / `transcribe` | None | Not tested |
| `x-min-segment-ms` | Optional in public reference | Candidate segmentation control; omitted by probe | None | Not tested |
| `x-partials` | Not established | Interim output hypothesis; omitted by probe | None | Not tested |
| Preferred-language / model options | Not established | Require account-confirmed names and meanings | None | Not tested |

The public auth header name does not settle whether `GNANI_API_KEY` or `GNANI_API_KEY_ID` contains the appropriate account value. The harness requires `PRISMA_VERIFY_CREDENTIAL_ENV` to select one explicitly; it never guesses, sends both, or places auth in a URL.

## Ready implementation and how to run

`npm run verify:prisma` is the explicit developer command. It is absent from `test`, `check`, `build` and CI. The utility has no HTTP route. API startup and this command automatically load the root `.env` through Node's built-in server-only loader; existing process environment values take precedence. Keep `.env` ignored and untracked, and commit only `.env.example`. Never put credentials in shell command history, chat, source, Vite variables or reports.

1. Generate the smallest useful offline synthetic fixture:

   ```powershell
   powershell.exe -NoProfile -File scripts/create-prisma-fixture.ps1 -Phrase 'one second' -SampleRateHz 16000
   ```

   This Windows `System.Speech` helper outputs a manifest path under the OS temp directory. It uses raw mono PCM16LE, a SHA256 manifest and a fixed benign phrase allowlist. It invokes no provider. Installed voice/accent/language quality is not guaranteed; record the voice when conducting Hinglish tests and listen locally before spending credits. A phrase longer than eight seconds is rejected. Local synthetic test files are permitted; learner recording/storage is not introduced.

2. Set these nonsecret fields explicitly in the server environment: `PRISMA_VERIFY_WS_URL`, `PRISMA_VERIFY_AUTH_HEADER`, `PRISMA_VERIFY_CREDENTIAL_ENV`, `PRISMA_VERIFY_LANGUAGE_HEADER`, `PRISMA_VERIFY_LANGUAGE_CODE`, `PRISMA_VERIFY_SAMPLE_RATE_HEADER`, `PRISMA_VERIFY_SAMPLE_RATE_HZ`, `PRISMA_VERIFY_FIXTURE_MANIFEST` and `PRISMA_VERIFY_LIVE=true`. Select the endpoint/header hypothesis deliberately; the command has no endpoint default. Configure only the selected credential locally. URLs containing userinfo, queries or fragments are refused.

3. Supply `CREDIT_CAP`, `RESERVE_CAP`, positive `STT_COST_UNITS`, and explicit cumulative `PRISMA_VERIFY_USED_UNITS`. These are project-configured abstract units, **not an inferred Gnani cost**. The existing guard must permit the projected usage before a socket opens. Keep caps at zero until the budget is deliberately set. Before each manual run, update cumulative usage conservatively and reconcile with the account meter. The utility does not maintain a cross-process billing ledger; do not launch concurrent runs.

4. Optional `PRISMA_VERIFY_FRAME_BYTES` defaults to1024; even values2–4096 support later isolated framing experiments. Default last frame is zero-padded; `PRISMA_VERIFY_TRAILING_PARTIAL=true` deliberately sends the trailing remainder. The optional format header/value pair is omitted unless both configured. No minimum-segment, partial or VAD-tuning header is sent.

5. Run exactly one intentional probe. It sends at realtime cadence (no catch-up bursts), including two seconds of zero PCM, waits three seconds for transcripts, then requests normal close. A twenty-second global deadline and one-second close wait bound the session. A missing transcript, rejected upgrade, unknown event, malformed data or abnormal close yields nonzero exit through existing typed errors. No retries, start/EOS control messages or automatic follow-up requests occur. A transport pass is only evidence for that exact input/configuration.

6. Review sanitized console metadata and enter a dated evidence row with exact nonsecret configuration, synthetic phrase/fixture hash, local ordering, numeric results, true N and limitations. Do not commit raw provider responses. Segment IDs are fingerprinted, transcript bodies and raw provider errors are discarded. Known field names/types are recorded; arbitrary unknown keys/values are suppressed. If an unknown event appears, the probe fails: review its bounded safe diagnostics and revise the candidate parser only with justified evidence. Never turn unknown events into synthetic transcripts.

### Explicit closure modes

The fixture helper now supports `-Probe BASELINE|SHORT|SEGMENTATION|HINGLISH|COMBINED`. BASELINE preserves original single-phrase generation. Other modes use fixed benign phrase sequences, strip only exact zero PCM padding, insert measured zero pauses, and record reviewed sample ranges, selected voice and SHA256. The manifest loader checks phrase allowlists, range order, gap bytes, rate/hash/size and expected-text consistency. The mode selector does not relax baseline transport validation.

`npm run verify:prisma:closure -- <fixture-directory>` selects SHORT, SEGMENTATION, HINGLISH and one ERROR attempt; `--combined` instead selects one combined speech case plus ERROR. It validates all selected fixtures and total projected local units before opening a socket. Every actual attempt also uses the existing guard, conservatively carrying one configured reservation forward per attempt. It never alters `.env`, caps, costs, baseline headers or transport settings. An unknown provider event stops the batch for review, with no automatic retry.

`npm run verify:prisma:error` is an explicit single omitted-auth command. The same strict baseline config is parsed first, and only the outgoing auth header is omitted in an isolated negative path. No fake credential is committed. No audio is sent on an unexpectedly accepted connection. DNS/network failures do not count as auth-rejection success. Normal test/check/build commands remain offline.

## Protocol catalogue (closure cases completed below; optional extensions remain unrun)

Do not run this list automatically. Start with one successful baseline, reconcile cost, then choose the next smallest useful test. Keep all live tests sequential and explicitly budgeted; no repeated auth errors or deliberate quota exhaustion.

| Step | Controlled input | Record / classification rule |
|---|---|---|
| Baseline | One short synthetic phrase, primary16kHz, candidate1024 frames, explicit provider language | Endpoint/auth/PCM/rate verified-working only after actual successful observation; do not assert REQUIRED |
| Lifecycle / field inventory | Same baseline diagnostic order and field types | First event, processing, receipt timing, transcript optionality, close/EOS outcome; ISO references never used for learner timing |
| Framing | One changed even frame length or trailing partial, if justified by baseline | Working vs required distinction, buffering/rejection; unsupported only when tested |
| Segmentation | Reviewed composite with short words/phrases and measured pauses | Segment fingerprints/indexes/durations and event order. L3 completes one case; helper records sample ranges. Optional broader pause/reliability experiments remain unrun |
| Short Hinglish | `haan`, `nahi`, `rukko`, `one second`, `okay`, `verify karunga` | Presence/ordering, Latin/Devanagari output, local voice provenance; no accuracy claim from this set |
| Code mixing / normalization | Benign security phrase and `DUMMY-4821` | Provider language identifier, scripts/digits, punctuation; exact synthetic output only in a controlled report if needed |
| Partials / speech boundaries | Baseline event sequence; justified option testing only later | Final/partial/revision/replacement semantics, VAD events; missing from one run does not prove NOT SUPPORTED |
| Invalid conditions | One controlled omitted-auth attempt in L4 | Explicit negative mode preserves strict baseline validation. Other auth/language/rate/binary conditions remain unrun; do not weaken baseline validation or retry |
| Rate / credit | Account docs/dashboard and before/after balance for intentional small runs | Units, failed-request charging, connection charges, expiry/concurrency limits; leave unknowns UNVERIFIED without direct evidence |

Faster-than-realtime tolerance, long-idle closure and keepalive needs are not established by this paced bounded baseline. No telephony degradation experiment belongs here. Do not tune minimum-segment/VAD settings until baseline and actual account behavior justify the next isolated test.

## Assumptions versus observations

| Old assumption / encoded behavior | Actual observation | Required change |
|---|---|---|
| Shared frames must be exactly1024; four rates accepted locally | 1024-byte frames and16000 worked in L2/L3; requiredness and alternatives remain unknown | Preserve mock/shared schemas; other framing remains a separate experiment |
| Shared transcript requires timestamp, segment ID/index, duration, latency | All five fields present in3 transcripts; requiredness remains unknown | Candidate parser keeps these optional; production/shared normalization remains deferred |
| Processing timestamp indicates speech end | Processing not observed in L2/L3 | Preserve corrected wording: unproven provider metadata, never learner timing authority |
| Project `hi-en` can identify intended experience | Explicit provider `hi-IN` accepted in L2/L3 | No automatic `hi-en` passthrough; future adapter mapping must use verified configuration |
| Existing backend dummy fixtures use older names while Phase3A authoring uses `DUMMY-\d{4}` | Local code inspection only | Preserve both existing implementations; Phase4A test phrase uses only established `DUMMY-4821` |

L1 established only configured connection/authentication, 16000 configuration, `connected` config fields and occurrence of `speech_start`; transcript and close were not promoted before the rerun. L2 additionally established the specific frame/PCM path, transcript field presence and requested normal close shown above. The isolated verification parser recognizes `speech_start` and preserves its valid optional ISO timestamp as provider reference data beside a separate local monotonic receipt. It creates no learner speech-start timestamp and performs no clock conversion. Production recognizer, TranscriptEvent schema, mock lifecycle and policy are unchanged. Live normalization behind `SpeechRecognizer` remains deferred. The speech_start parser test now uses L2's sanitized type/timestamp subset; other offline values remain fabricated.

## L2 — unchanged baseline rerun, 2026-10-09

After adding only verification-parser support for `speech_start`, `npm run check` passed: **150/150 tests**, typecheck, lint, scenario validation, builds and secret scan. Three new offline tests cover separate provider/local timestamps, missing/invalid provider time, and continued streaming after speech_start. Following that validation, exactly one `npm run verify:prisma` was run with existing root `.env` and process configuration unchanged. Endpoint, headers, language, rate, frame size, fixture, credit settings and production provider behavior were not edited. The existing guard approved the request. No retry occurred.

The command exited0 with `single-fixture-transport-pass`. Full sanitized live trace (timestamps are provider references; local receipt times are session-relative milliseconds):

```jsonl
{"eventType":"credit-approved","receivedAtMonotonicMs":0.09309999999999263}
{"eventType":"socket-open","receivedAtMonotonicMs":261.7231}
{"receivedAtMonotonicMs":322.4826,"knownFields":{"type":"string","timestamp":"string","config":"object","message":"string"},"unknownFieldCount":1,"eventType":"connected","providerTimestamp":"2026-10-09T11:35:07.385729+00:00","reportedSampleRateHz":16000,"reportedChunkSize":512}
{"receivedAtMonotonicMs":709.6498999999999,"knownFields":{"type":"string","timestamp":"string"},"unknownFieldCount":1,"eventType":"speech_start","providerTimestamp":"2026-10-09T11:35:07.775190+00:00"}
{"receivedAtMonotonicMs":2057.5488,"knownFields":{"type":"string","timestamp":"string","text":"string","audio_duration_ms":"number","segment_id":"string","segment_index":"number","latency":"number"},"unknownFieldCount":3,"eventType":"transcript","providerTimestamp":"2026-10-09T11:35:09.124703+00:00","characterCount":2,"hasLatin":false,"hasDevanagari":false,"digitCount":2,"matchesSyntheticPhrase":false,"segmentFingerprint":"b76239e4be693fa2","segmentIndex":1,"audioDurationMs":1408,"providerLatencyMs":88}
{"eventType":"audio-sent","receivedAtMonotonicMs":4591.8264,"frameCount":114,"minFrameBytes":1024,"maxFrameBytes":1024,"sentAudioDurationMs":3648}
{"eventType":"close-requested","receivedAtMonotonicMs":7606.665300000001}
{"eventType":"socket-closed","receivedAtMonotonicMs":7648.4921,"closeCode":1000}
{"result":"single-fixture-transport-pass","transcriptCount":1,"frameCount":114,"closeCode":1000,"localElapsedMs":7648.609,"caveat":"This run does not verify untested capabilities or complete Phase 4A."}
```

No processing, speech_end, partial or replacement event was seen. Those capabilities remain **UNVERIFIED**, not NOT SUPPORTED. One returned segment does not verify segmentation behavior, short-utterance reliability, field optionality, Hindi/Hinglish support or finalness. The transcript did not exactly match the expected synthetic phrase; no recognition accuracy claim is made. Unknown field values/names and transcript bodies remain suppressed. Reported chunk_size512 does not establish a provider frame-size requirement. Credit approval establishes only the local configured budget, not charging units or billing amount.

## Initial harness execution record (historical, before L1)

- Configuration inspection: selected credentials and live probe settings absent; no secrets printed.
- Offline suite: 26 verification tests passed (configuration, fixture integrity, optional metadata, privacy, local receipts, credit guard, realtime pacing, lifecycle and typed failures). These do not prove provider behavior.
- Offline helper: generated one `one second` synthetic16kHz fixture in OS temp. The loader accepted its raw PCM manifest/hash: 52,000 bytes, 1,625 ms. This checks local fixture integrity, not recognition or voice quality. No participant audio used. Windows speech generation required approved execution outside the sandbox.
- Live probe: **not attempted** because credentials/configuration/budget are missing. `npm run verify:prisma` was exercised locally with live opt-in explicitly disabled and missing configuration: exit1, typed `INVALID_REQUEST`, no socket opened. This is a refusal-path check, not live provider evidence.
- Required before live work: selected server credential, intentional endpoint/header/language configuration, reviewed fixture, explicit cap/reserve/cumulative usage/estimated units, and account balance/charging reference. Public docs are available; separate participant-specific documentation is not asserted to exist.
- Full `npm run check`: **passed, exit0** — typecheck, lint, **144/144 tests** (118 existing +26 new), all three scenario validations, API/web production builds and secret scan. Initial sandbox run failed13 existing loopback-fetch tests; approved rerun outside the sandbox passed all144. No provider requests occur in either run. `git diff --check` also passed.

## Phase 4A file inventory

Existing Phase3/3A working-tree changes were preserved. Only the following additions/modifications belong to this pass; generated build artifacts remain ignored.

Modified:

- `package.json` — register opt-in command and offline test file.
- `apps/api/package.json` — exact `ws@8.22.0` and `@types/ws@8.18.2` dependencies.
- `package-lock.json` — resolve those API dependencies, preserving prior frontend entries.
- `.env.example` — blank server-only configuration and explicit live gate.
- `docs/architecture/prisma-realtime-contract.md` — distinguish mock constraints, probe choices and unverified provider behavior.
- `docs/architecture/provider-abstraction.md` — describe isolated verification boundary.
- `docs/evidence/evidence-ledger.md` — N=0 readiness record.

Created:

- `apps/api/src/providers/prisma/verificationConfig.ts` — explicit environment and bounded synthetic fixture validation.
- `apps/api/src/providers/prisma/verificationEvents.ts` — candidate parser and sanitized metadata.
- `apps/api/src/providers/prisma/verifyPrisma.ts` — one bounded guarded WebSocket probe with local pacing/receipt clock.
- `apps/api/src/providers/prisma/prismaVerification.test.ts` — 26 deterministic offline tests.
- `scripts/verify-prisma.ts` — opt-in CLI and safe nonzero errors.
- `scripts/create-prisma-fixture.ps1` — offline local synthetic PCM helper.
- `docs/evidence/provider/prisma-realtime-verification.md` — this capability matrix, protocol and execution record.

## Preserved boundaries

Browser → backend → provider remains the intended architecture. No frontend secret, browser mic/VAD, Timbre, Evon authoring change, policy change, dummy-rule change, persistent learner audio, transcript logging, word timing/confidence dependency, or provider clock authority is introduced. `/health` remains non-billable. Phase4A closure permits Phase4B to begin; neither Phase4B nor a production STT adapter is implemented here. Production activation remains subject to its separate consent, privacy and readiness gates.
