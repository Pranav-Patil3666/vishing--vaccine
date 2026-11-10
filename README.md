# Vishing Vaccine

Vishing Vaccine is a local training prototype for practicing how to respond to voice-based social engineering. It provides a consent-based scenario experience, deterministic turn classification and policy, bounded caller responses, and an evidence-based debrief. It is a training simulation, not a fraud-detection service or an autonomous calling system.

## The problem

Voice phishing (vishing) exploits human trust, urgency, authority, and fear. Employees may be pressured into sharing information or following instructions before independently verifying a caller's identity.

Traditional awareness training often explains these risks without allowing employees to practise responding under realistic conversational pressure.

Vishing Vaccine addresses this gap through interactive, simulated voice-security exercises.

## How it works

1. **Scenario selection:** A learner enters a fictional, controlled training scenario.
2. **Disclosure and consent:** The simulation is clearly identified as training and uses dummy information only.
3. **Simulated conversation:** The learner interacts with a fictional caller and makes decisions during the exercise.
4. **Speech processing:** In live voice mode, the backend uses speech-to-text to interpret learner responses. Offline typed practice does not use speech recognition.
5. **Behaviour classification:** A deterministic classifier maps the learner's response to an observable behavior category.
6. **Bounded dialogue:** Policy rules and an approved response resolver select a permitted next caller response.
7. **Evidence-based debrief:** The learner receives a summary of recorded decisions, the tactic involved, and a safer response to practise. The debrief does not infer emotion or personality.

## Key features

- Interactive voice-security training scenarios.
- Fictional caller identities and organizations.
- An approved Hindi/Hinglish-focused S-01 scenario for the current `hi-IN` live profile.
- Deterministic behavior classification and bounded dialogue.
- Scenario validation, human approval, and controlled publication workflow.
- Session-level event tracking and learner debriefs.
- Trainer-facing scenario authoring and review experience.
- Offline typed-practice mode for demonstrations and testing.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, TypeScript |
| Backend | Node.js built-in HTTP server, TypeScript |
| Speech-to-text | Gnani Prisma adapter, opt-in for the approved live voice path |
| Text-to-speech | Gnani Timbre adapter, opt-in for approved caller audio |
| Dialogue and classification | Deterministic behavior classifier, policy rules, approved response resolver |
| Shared application logic | TypeScript contracts and scenario schemas |

## Behaviour classification

Learner responses are mapped to a bounded set of categories:

- `REFUSED` — The learner refuses the requested action.
- `STALLED` — The learner pauses or requests more time.
- `VERIFIED_INDEPENDENTLY` — The learner indicates that they will verify through an independent official channel.
- `COMPLIED` — The learner agrees to the caller's request.
- `DISCLOSED_DUMMY_SECRET` — The learner discloses a designated synthetic training secret.
- `UNKNOWN` — The response cannot be reliably classified.

These labels describe observed responses within the simulation. In particular, `COMPLIED` does not by itself mean that a credential or secret was disclosed.

## Current scope

- **S-01 v0.2.0** is the only scenario in the current runtime catalog. Its Hindi/Hinglish content is approved for the existing `hi-IN` voice path, with a maximum of three learner turns. A safe terminal outcome can end a session earlier.
- **S-02 and S-03** are drafts and are not eligible for runtime sessions.
- **S-92 v0.1.1** has an approval record, but its publication attempt was blocked by the current compatibility gate. It is not runtime eligible or playable.
- The offline demonstration is **typed practice** using local mock adapters. It does not request a microphone or contact Prisma, Timbre, Evon, or another model provider.
- The optional S-01 live voice path uses browser microphone capture and sends audio to the backend. The backend can use the configured Gnani Prisma STT and Timbre TTS adapters when explicitly enabled and when the local credit guard permits the operation. Credentials stay server-side. Starting the API or opening the app does not itself make a provider request.
- The event/debrief model records structured behavior and timing evidence, not raw audio or transcript text. Sessions are held in process memory and are lost when the API restarts. Authoring review and publication records are a separate local workflow.

Language and provider support is deliberately narrow. The current live profile is Hindi/Hinglish scenario content through the `hi-IN` provider configuration. This does not establish general Hindi, English, Hinglish, or other-language accuracy. See the provider evidence before making language or quality claims.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run the offline demonstration

Install the locked dependencies from the repository root:

```sh
npm ci
```

In the first terminal, start the mock-only API:

```sh
npm run dev:api:offline
```

It listens on `127.0.0.1:3186` and uses deterministic mock adapters. In a second terminal, start the web app and proxy it to that API:

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:3186'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:5186'
npm run dev --workspace @vaccine/web -- --port 5186 --strictPort
```

Open `http://127.0.0.1:5186/#/dashboard`. The repeatable typed S-01 walkthrough is in the [Phase 8 recording runbook](docs/demo/phase8-final-loom-runbook.md). It demonstrates approved caller text, typed learner responses, a bounded two-turn safe-verification path, and the debrief. It is not a live voice demonstration.

## Run the development application

The normal development API loads the root `.env` when present. Without live-provider flags, it uses the mock paths. Start the API and web app in separate terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

By default, the API binds to `127.0.0.1:3001` and Vite to `127.0.0.1:5173`; Vite proxies `/api` and `/health` to the API. Copy `.env.example` to `.env` only when local configuration is needed. Provider credentials and other server values must never use `VITE_*` names. The browser environment is limited to public app configuration and the API base URL.

Live voice is opt-in. It requires an explicitly configured server environment, approved runtime content, consent, browser microphone permission, and available project-local credit capacity. Project credit units are application guard units, not a statement of provider billing. Review the [live runtime design](docs/architecture/real-voice-turn.md), [provider verification evidence](docs/evidence/provider/prisma-realtime-verification.md), and [caller voice evidence](docs/evidence/phase4c2-real-caller-voice.md) before enabling it. Do not use live mode for an unreviewed scenario or with real credentials, account data, or secrets in learner speech.

## Validation and authoring commands

```sh
npm run check
npm run validate:scenarios
npm run authoring:draft -- help
npm run authoring:review -- help
```

`npm run check` runs TypeScript checks, lint, the offline test suite, scenario validation, builds, and the repository secret scan. Scenario validation checks structure and safety rules; it does not replace human review, approval, or publication compatibility checks. The authoring and review CLIs maintain a local lifecycle. Approval alone does not make an authored scenario playable.

## Architecture and operating boundaries

- [Trusted runtime content and publication boundary](docs/architecture/runtime-content-boundary.md)
- [Real voice turn flow](docs/architecture/real-voice-turn.md)
- [Browser audio capture and cleanup](docs/architecture/browser-audio.md)
- [Deterministic behavior classification](docs/architecture/behavior-classification.md)
- [Session-local timing model](docs/architecture/timing-model.md)
- [Pressure curve](docs/architecture/pressure-curve.md)
- [Structured event log and debrief](docs/architecture/event-log.md)
- [Phase 8 acceptance evidence](docs/evidence/phase8-final-stabilization.md)
- [Dependency record](DEPENDENCIES.md)

Internal planning notes and the detailed execution roadmap are intentionally excluded from the public repository. For current runtime eligibility and limits, use the code and acceptance evidence linked above.

## Safety and privacy

- Sessions are clearly labeled simulations with fictional organizations and synthetic training data.
- Microphone access is tied to an explicit user action and browser permission. The offline typed demonstration does not open a microphone.
- Runtime selection is enforced by the backend from fingerprint-bound approved content and verified compatible publications; browser-supplied scenario data does not grant approval.
- Raw learner audio is transient and is not written to session records. Structured event records omit transcript text and audio. Live STT/TTS requests can contact external services and may incur provider usage; only enable them intentionally.
- Do not enter actual OTPs, passwords, account identifiers, payment data, or other real secrets. Use only the documented synthetic practice data.

## License and contribution

No license for reuse is currently declared. Unless a license is added, do not assume that the code or scenario content is available for redistribution or reuse. Before publishing this repository, review evidence records, screenshots, scenario content, and local authoring artifacts for information you do not intend to disclose.
