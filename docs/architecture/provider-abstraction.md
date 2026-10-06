# Provider abstraction

Shared interfaces live in `packages/contracts`:

- `SpeechRecognizer.transcribe(SpeechRecognitionRequest) → TranscriptEvent`
- `SpeechSynthesizer.synthesize(SpeechSynthesisRequest) → AudioResult`
- `Reasoner.generateScenario(ScenarioBrief) → DraftTree`

They define internal data only. They contain no vendor URL, authentication header, provider response field, voice ID catalog, billing meaning, or language-code assumption. Optional provider metadata, timing, and confidence remain optional until the provider verification gate establishes what is available.

The API contains mock adapters in `providers/prisma`, `providers/timbre`, and `providers/evon`. The STT mock returns only an injected transcript map; the TTS mock returns an empty, explicitly non-playable byte buffer; the reasoner mock emits a draft placeholder. None performs network I/O or represents actual provider behavior.

Before a real adapter is implemented, record the verified API contract, key handling, language/voice behavior, rate limits, credit meter, error mapping, data handling, and a reproducible smoke-test artifact in `docs/evidence/provider/`. Provider secrets belong only in server-side environment variables and must never be logged or bundled into the web client.
