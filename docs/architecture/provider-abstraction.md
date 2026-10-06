# Provider abstraction

Shared interfaces and Zod schemas live in `packages/contracts`:

- `SpeechRecognizer.transcribe(SpeechRecognitionRequest) → TranscriptEvent`
- `SpeechSynthesizer.synthesize(SpeechSynthesisRequest) → AudioResult` (scenario/version/response reference only; no arbitrary text field)
- `Reasoner.generateScenario(ScenarioBrief) → DraftTree`
- `PrismaRealtimeTransport` lifecycle, PCM frame, and normalized event contracts
- `ApprovedResponseResolver` for server-side lookup of reviewed scenario text

The general provider interfaces define internal data. The separate Prisma realtime contract records only the explicitly supplied endpoint, transport, PCM, and event facts for later verification; it contains no credentials or actual WebSocket implementation. It does not require word timestamps or per-word confidence. Provider ISO times remain reference data. TTS receives a response reference; a server-side resolver must obtain the reviewed script before an adapter sends any synthesis request.

The API contains mock adapters in `providers/prisma`, `providers/timbre`, and `providers/evon`. The STT mock returns injected text as a normalized `TranscriptEvent` through the recognizer contract; the TTS mock returns an empty, explicitly non-playable byte buffer; the reasoner mock emits a draft placeholder. None performs network I/O or represents actual provider behavior. Mock text bytes are transient request data, not stored audio. A raw Prisma WebSocket transport is a future backend-only adapter; the Python SDK is outside the product design.

Before a real adapter is implemented, record the verified API contract, key handling, language/voice behavior, rate limits, credit meter, error mapping, data handling, and a reproducible smoke-test artifact in `docs/evidence/provider/`. Provider secrets belong only in server-side environment variables and must never be logged or bundled into the web client.
