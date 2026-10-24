# Phase4C.2 — real caller voice and browser timing

Date:2026-10-18, Asia/Calcutta. Baseline:506 passing tests.

**PHASE 4C.2 STATUS: COMPLETED — user-confirmed physical acceptance, 2026-10-18.** The user explicitly reported: “4c.2 status is completed - all physical checks have completed”. This confirmation supersedes the historical pending status below. The original implementation/probe records remain unchanged; no missing physical timestamps, latencies, transcript, session ID, cache-hit counts, or provider usage have been invented.

## Provider verification: one request

Primary references inspected before implementation: [official REST contract](https://docs.gnani.ai/api/TTS/tts-inference), [SSE alternative](https://docs.gnani.ai/api/TTS/tts-sse), [voice catalog](https://docs.gnani.ai/api/TTS/available-voices). The standalone verification harness preceded runtime integration; runtime imports no probe code. REST was chosen for bounded complete assets.

The user configured TTS_COST_UNITS=1, CREDIT_CAP=2, RESERVE_CAP=0 locally and authorized continuation. The existing credit guard ran before the request. A durable attempt marker prevents repeated probe calls; no retry, auth-error probe or batch was sent. Configured units are not Gnani billing measurements.

| Fact | Observed scope |
|---|---|
| Request timestamp | 2026-10-18T07:05:29.948Z |
| Provider attempts | **1 total** |
| Endpoint/auth | POST `https://api.vachana.ai/api/v1/tts/inference`; `X-API-Key-ID` from backend `GNANI_API_KEY`; value never logged |
| Content | Canonical approved/runtime-eligible S-01 v0.2.0, reviewed_safe `system.opening` |
| Exact approved text | Namaste, Northstar Cooperative Bank ke verification desk se bol raha hoon. Aapke demo account ka verification pending hai. |
| Accepted request | `text`, `model=timbre-v2.5`, `voice=Nalini`, `language=hi-IN`, `speed=1` |
| audio_config | sample_rate48000, num_channels1, sample_width2, encoding linear_pcm, container wav |
| Response | **HTTP200**, **audio/wav**, binary **645164bytes** |
| Request to complete body | **1976ms**, one backend monotonic sample; not provider-internal latency/statistics |
| Actual audio inspection | RIFF/WAVE, PCM format1, mono48000Hz,16bit,96000bytes/s; **6720ms** from sample bytes |
| Other provider metadata | No model/voice/language identity echo relied upon; these are accepted request settings, not inferred from sound |
| Browser decode / heard intelligibility | **PENDING** |

The initial harness reported FAILED_NO_RETRY **after successful synthesis** because RIFF/data lengths were streaming sentinels `0xFFFFFFFF`. Saved bytes were inspected offline, without another request. The bounded WAV helper now accepts this observed final-data form and finalizes only container length fields for delivery/cache. Samples, rate, pitch and approved text are unchanged; no transcoding/telephony degradation was added. A sanitized synthetic header fixture covers this difference. The record retains `initialHarnessStatus=FAILED_NO_RETRY`, offline reanalysis and current `VERIFIED_STREAMING_WAV`.

[Sanitized machine evidence](provider/timbre-verification.json) preserves original SHA256 `5ec6f2f86268b0ed60ddc86d4bdd9a1e7423fe7773c867b043875d0908dcaa5f`, finalized SHA256 `0e1546d48f317b7e62326e3a0c63b5ba0d5a0b4ded1d8cd6e8d24daf16bb47fe`, approved text and technical facts. It contains no credential or learner data. Missing-auth behavior, quality, billing/rate limits and other formats/voices are not live verified.

## Contracts, approval and runtime

Existing `SpeechSynthesizer.synthesize(approvedReference) → AudioResult` remains reference-only. Its only extension is optional provider-neutral `{signal}` cancellation. AudioResult bytes/media/duration/cache is unchanged; a separate caller-asset contract carries safe delivery metadata/reference.

Only backend composition constructs TimbreSpeechSynthesizer. ApprovedCallerCatalog validates current S-01/hi-IN/version/runtime eligibility/safety, reuses ApprovedResponseResolver and resolves authoritative text. The adapter checks reference approval/voice fields again. Browser POST accepts **only turnNumber and responseId**, rejecting arbitrary text, voice, scenario and approval claims. The ID must equal the session's authoritative opening or first selected response. All eight canonical IDs remain unchanged: system.opening, urgency, authority, isolation, fear, reward, system.safe-ending, system.safe-fallback.

The shared service/cache/player covers opening and selected responses. S-01's reviewed legacy `voice_id=mock-only` is untouched; the explicit backend delivery profile selects Nalini without inventing voice approval metadata or rewriting content. Provider/model/voice/language/speed/format are centralized. Session/turn code contains no Timbre request fields.

TIMBRE_RUNTIME_ENABLED defaults disabled. Missing key/positive cost makes the path unavailable without failing startup; mock mode still works. Existing server-only root env loading is reused. `.env` remains ignored; `.env.example` contains names/non-secret defaults only. User added cost1; this implementation recorded local **TIMBRE_USED_UNITS=1** for the actual probe reservation. The gate was already enabled locally; STT settings and key values are unchanged. API restart reads edits; existing process values take precedence.

Credit flow: content validation → cache lookup → HIT returns without reservation/provider call → MISS uses existing credit guard → one synthesis → cache write. Reservations are not automatically refunded on failures. Initial configured TTS usage is loaded from TIMBRE_USED_UNITS. Existing accounting is process-local/by operation, not a durable aggregate Gnani billing ledger. Startup, status, session creation and policy finalization do not automatically call Timbre.

Local origin/Host, consent, REAL_STT/safe mode and S-01 current turn/response are required. Only positions0/1 exist in this phase. Audio GET references are session/turn bound, expire after120s and cannot regenerate audio. Pending duplicates share work; cache misses coalesce. End/disconnect aborts pending work and late results are rechecked. Cancelling the originating shared synthesis can fail other waiters conservatively; there is no hidden retry. Terminal selected audio can play without reopening the microphone or advancing a turn.

## Cache and actual backend delivery

- Replaceable CallerAudioCache, filesystem **`.cache/tts/`**, ignored by Git.
- Existing createTtsCacheKey hashes canonical JSON: NFKC approved text, provider/model, voice, language, sorted audio config including speed, stable REST/container configuration version. No response/session/learner ID, API key or timestamp affects content identity. Exactly the same NFKC text is sent to Timbre; no semantic/whitespace rewrite.
- Cache objects hold only key/media/byte length/SHA256 and finalized caller WAV bytes as base64. No learner audio/transcript, auth or session-specific sensitive content enters this cache.
- Managed bound32 entries/32MiB, per-asset8MiB and≤60s. Writes serialize and replace atomically; oldest entries are evicted. The separately saved one-time verification WAV artifacts are fixed probe artifacts, not managed cache entries.
- Hits validate size, hash and WAV. Corrupt entries are removed; an explicit subsequent miss may regenerate once through the guard. Failure produces a typed error, not a regeneration loop.
- `seed:timbre-cache` verifies saved artifact SHA, exact approved text and current profile before offline seeding; it has no provider transport.

Actual cache key: `tts-5d7b09b0a0e3d59e213258907698998c377a3c91350a64aad8902f963a9e9cec`. Offline seed/read returned HIT/645164bytes/zero provider calls.

A separate readiness check served **the real saved participant audio** through the actual local API: approved POST → HIT → session GET → audio/wav645164bytes/6720ms. Provider transport was forbidden and miss credit denied. Provider calls0, microphone captures0, learner events0, pressure points0. The playback-only readiness session was ended, recordingEnabled=false and server closed. This proves backend cache delivery, not browser playback; details are in the machine record's backendCacheDelivery field.

## Browser playback and local timing

The real-turn panel offers an explicit **Use real caller audio (Timbre/cache)** checkbox. Mock cue remains the labeled default. Real opening audio loads before mic/STT opening and plays after existing quiet calibration. An HTMLAudioElement uses a Blob URL; its first **playing** event records start, successful **ended** records end. `play()` invocation/Promise, fetch/decode completion, provider latency and duration arithmetic are not timing authority.

Both callbacks enter the existing capture controller's **performance.now()−origin/audioClockId shared with VAD**. Caller end5000/learner start7200 produces canonical2200ms offline; overlap retains null latency and unchanged disabled interruption gate. Caller48k source remains independent of learner16k/1024-byte PCM. VAD thresholds, resampling, classifier and policy are unchanged.

Playback follows the explicit Start real voice turn interaction. Autoplay/decode/fetch/play/pause failures stop progression/capture, return typed CALLER_AUDIO_FAILED, and fabricate no normal end. End/unmount aborts fetch, pauses/resets audio, detaches handlers, revokes URL and rejects stale callbacks. Duplicate prepare/play/rerender paths are guarded. End remains available for stopping terminal-response playback.

Finish retains approved text/tactic/pressure and adds audio-availability metadata. **Play approved next line** is explicit and single-use, through the same service/player; it starts no second learner turn. Its local duration is a review observation; Phase4C.3 will connect subsequent learner clocks. Opening→first learner response is this phase's canonical timing cycle. The isolated SAFE_VERIFIED timeline-heading bug is fixed with a render regression.

## Offline validation

Normal tests use injected transports/browser doubles or loopback servers and make zero Gnani calls. Focused group **128/128 PASS** covers adapter success/auth/config/media/malformed/empty/timeouts/cancel/errors/no retry, approval gates, exact cache inputs, HIT/MISS/single-flight/corruption/eviction/credit, selected-response delivery, end/stale requests, playback events/errors/URL cleanup, local latency/overlap, failure before mic/STT, mock regressions and full caller→API/adapter/cache→browser callbacks→canonical learner event replay.

Baseline506; **59 tests added**, final **565/565 PASS**, no tests removed. Final `npm run check`: **PASS, exit0**; typecheck, lint, scenario validation, API build, web build and secret scan all PASS. Scenario validation confirms S-01 approved/runtime=true. `git diff --check` and whitespace inspection of new files PASS. The final focused128/128 run includes the explicit End-after-terminal guard: a completed session can review its selected audio until End is pressed; End then blocks further caller preparation/GET even though the legacy session lifecycle preserves COMPLETED. Cache hit/miss counters update once per prepared asset, without extra learner events/points.

File audit: **18 created,27 modified** committable files in this phase; protected content/approval/history/classifier/policy/Prisma/VAD/DSP files unchanged by hash comparison. Temporary readiness/validation scripts, logs and hash snapshot removed. Initial typecheck found a session-return annotation and typed-array generic mismatch, both corrected. A `tsx -e` seed attempt failed ESM/CJS package resolution without transport; the dedicated ESM seed script passed. These local harness corrections caused no additional provider request.

## READY FOR LIVE 4C.2 ACCEPTANCE

One physical cycle is pending. The opening is already cached, so no new Timbre generation is needed. Do not rerun verify:timbre or repeat failed billable tests. Use headphones; speaker-bleed accuracy remains unclaimed.

**Terminal1 — API:** restart an existing API with Ctrl+C so it reloads `.env`, then:

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:api
```

Expected127.0.0.1:3001. Local key, gate, positive costs/cap and prior TTS usage1 are configured; no manual secret assignment.

**Terminal2 — web:**

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:web
```

**Browser URL:** http://127.0.0.1:5173/#/training/precall/S-01

1. Refresh; create a **fresh** session: REAL STT · one hi-IN voice turn → simulation consent → Start simulation.
2. In Voice response choose **Use real caller audio (Timbre/cache)**. Verify REAL STT · REAL CALLER AUDIO and visible AI-generated/SIMULATION disclosure.
3. Confirm separate microphone consent → **Start real voice turn** once → allow microphone. Stay quiet during calibration.
4. Hear spoken approved opening beginning **Namaste, Northstar Cooperative Bank ke verification desk se bol raha hoon...**, rather than the tone. Wait for its actual end/Respond now.
5. Say **Main independently verify karunga.** Stop naturally; wait for VAD/Finish/result. Opening playback is sufficient; leave Play approved next line unused to avoid another generated asset.
6. Inspect Real turn technical facts: system.opening, TTS CACHE, model/voice/language, audio/wav645164bytes/48000Hz, asset providerAttempts0, source duration6720ms, audioClockId and actual local start/end/duration. Compare browser duration approximately with6720ms; actual ended callback is authoritative.
7. Paste **response JSON only** from metadata `POST /api/sessions/<id>/caller-audio` and `POST .../real-audio/finish`. Do not send headers, `/start` token, PCM or credentials. Also report whether audio was heard/intelligible, source mic rate and stopped mic/playback indicators.
8. End simulation and report cleanup or sanitized stage/code. Preserve a failure; one controlled physical cycle is requested.

Expected, not observed: local playing/ended → learner speech → equivalent transcript → VERIFIED_INDEPENDENTLY/SAFE_VERIFIED → one event/point → cleanup. No live browser playback duration, learner response latency or physical cleanup measurement exists yet.

## Known limits / blocker

Physical browser decode/heard playback and real timing/cleanup are the remaining Phase4C.2 blocker. One provider sample gives no quality, Hinglish-perfection, reliability, latency-distribution, billing or rate-limit claim. Transport is fixed to the accepted REST/model/voice/language/PCM-WAV profile. Browser lifecycle timestamps are not measured speaker acoustics. Cache is local/replaceable, counters are operator-configured process accounting, and abort does not prove no provider charge. A fresh checkout has no ignored saved asset; normal tests require none. No Phase4C.3, S-02/S-03 voice expansion, live Evon, content/pronunciation edits, telephony pipeline or pilot was started. Phase4C.1's historical evidence remains unchanged.

## Created files

- `apps/api/src/callerAudio/{catalog,cache,service,routes,wav}.ts`
- `apps/api/src/callerAudio/{callerAudio,wav}.test.ts`
- `apps/api/src/providers/timbre/{runtimeConfig,timbreSpeechSynthesizer}.ts`
- `apps/api/src/testing/{callerWavFixture,callerAudioAssetFixture}.ts`
- `apps/web/src/audio/{callerPlayback,callerPlayback.test}.ts`
- `packages/contracts/src/callerAudio.ts`
- `scripts/{verify-timbre,seed-timbre-cache}.ts`
- `docs/evidence/provider/timbre-verification.json`
- This report.

## Modified files in this phase

- `.gitignore`, `.env.example`, `package.json`
- `packages/contracts/src/{providers,index,browserAudio,realVoice}.ts`
- `apps/api/src/{errors,health,server,turnOrchestrator,runtimeAudioIngress}.ts`
- `apps/api/src/cache/cacheKey.ts`
- `apps/web/src/{App.tsx,sessionApi.ts}`
- `apps/web/src/audio/{controller,controller.test,errors,useBrowserAudio,realVoice.test}.ts`
- `apps/web/src/components/{RealVoiceTurnPanel,PressureTimeline,render.test}.tsx`
- `docs/architecture/{provider-abstraction,timing-model,real-voice-turn}.md`
- `docs/evidence/evidence-ledger.md`

Local only: `.env` gained prior TTS usage1 (cost1 added by user); ignored caller assets/cache saved/seeded. No key value changed/committed. Scenario/authoring/review/history/approval report, classifier/policy and Prisma/VAD/DSP/frame implementations are unchanged. Runtime ingress changed only optional caller-availability metadata. Temporary scripts/log/hash snapshot are removed after validation; no commit requested.
## User-reported physical closure — 2026-10-18

The user explicitly confirmed that all Phase 4C.2 physical checks have completed and directed work to Phase 4C.3. This accepts the prior physical checklist (opening cache/heard playback, local playback-end/learner timing, real verification/safe terminal path, selected approved next-line playback and stop/cleanup) at user-report scope. The original provider probe, offline counts, and historical pending instructions above are retained as history. Exact physical session IDs, playback durations, response latencies, cache counts and provider usage were not supplied with this confirmation and remain unspecified. No extra probe or physical action was performed to record this closure.
