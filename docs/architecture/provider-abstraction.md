# Provider abstraction

## Phase4C.2 caller output

Backend TimbreSpeechSynthesizer implements existing reference-only SpeechSynthesizer, with optional provider-neutral cancellation. ApprovedCallerCatalog checks current runtime eligibility/version/safety and reuses the approved resolver. Backend composition maps unchanged S-01 mock-only voice metadata to the verified-request Nalini delivery profile. CallerAudioService resolves approved text → deterministic byte cache → credit reservation only on MISS → one provider request → finalized PCM WAV cache. Session-scoped metadata/binary routes reject arbitrary text and stale/foreign references. Browser playing/ended supply local timing; mock mode remains. See [Phase4C.2 implementation/evidence](../evidence/phase4c2-real-caller-voice.md). Earlier sections describe historical boundaries.

Shared interfaces and Zod schemas live in `packages/contracts`:

- `SpeechRecognizer.transcribe(SpeechRecognitionRequest) → TranscriptEvent`
- Optional `SpeechRecognizer.openStream(StreamingRecognitionRequest) → StreamingRecognitionSession` (`ready`, `sendFrame`, `finish`, `cancel`)
- `SpeechSynthesizer.synthesize(SpeechSynthesisRequest) → AudioResult` (scenario/version/response reference only; no arbitrary text field)
- `Reasoner.generateScenario(ScenarioBrief) → DraftTree`
- `PrismaRealtimeTransport` lifecycle, PCM frame, and normalized event contracts
- `ApprovedResponseResolver` for server-side lookup of reviewed scenario text

The general provider interfaces define internal data. The shared Prisma realtime contract records local mock constraints and provider hypotheses for later verification; it contains no credentials or live transport implementation. It does not require word timestamps or per-word confidence. Provider ISO times remain reference data. TTS receives a response reference; a server-side resolver must obtain the reviewed script before an adapter sends any synthesis request.

The API contains mock adapters in `providers/prisma`, `providers/timbre`, and `providers/evon`. The STT mock returns injected text as a normalized `TranscriptEvent` through the recognizer contract; the TTS mock returns an empty, explicitly non-playable byte buffer; the reasoner mock emits a draft placeholder. None performs network I/O or represents actual provider behavior. Mock text bytes are transient request data, not stored audio. Phase 4C.1 adds a separate backend `PrismaRealtimeSpeechRecognizer` behind the optional streaming interface, disabled unless explicitly configured and started for approved S-01 hi-IN content. Session/turn code remains provider-neutral. The Python SDK is outside the product design.

Phase 4A recorded the scoped verified STT baseline; unverified capabilities, billing and provider limits remain unverified. New runtime implementation/testing and the content-blocked live acceptance are recorded separately in [Phase 4C.1 evidence](../evidence/phase4c1-real-turn.md). Provider secrets belong only in server-side environment variables and must never be logged or bundled into the web client.

Phase 4A adds an isolated opt-in WebSocket verification utility (`npm run verify:prisma`). It uses a candidate parser with optional metadata and the existing credit guard; no production `SpeechRecognizer` or runtime provider selection is changed. Normal checks remain offline. See [Prisma verification evidence](../evidence/provider/prisma-realtime-verification.md) for configuration, observed results and unresolved gates.

Phase 4B adds provider-neutral browser timing facts and a development PCM discard sink behind the existing session/consent boundary. It produces mono PCM16LE at16000 Hz in1024-byte frames for a later backend adapter. It does not connect browser capture to Prisma, modify provider authentication, require provider VAD/partials/word timing, or add Timbre. See [browser audio](browser-audio.md).
