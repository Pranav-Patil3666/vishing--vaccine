# Vishing Vaccine · Phase 7 walkthrough

Use the offline setup for the recording. It runs the real S-01 authorization, classifier, caller policy and debrief with typed input and local mock adapters. The browser shows approved caller text. S-92 appears later as a separate trainer approval example.

## Start the offline app

In PowerShell terminal 1:

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:api:offline
```

In PowerShell terminal 2:

```powershell
Set-Location 'D:\vishing--vaccine'
$env:API_PROXY_TARGET = 'http://127.0.0.1:3186'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:5186'
npm run dev --workspace @vaccine/web -- --port 5186 --strictPort
```

Open [Overview](http://127.0.0.1:5186/#/dashboard). The offline API runs at 127.0.0.1:3186 without credentials or provider adapters. The overrides in terminal 2 only point the browser at that local API. The normal live configuration uses a separate port.

## Record the walkthrough

1. On **Overview**, introduce Vishing Vaccine as fictional voice security training with feedback based on the learner's recorded choices. Select **Start training**.
2. On [Training](http://127.0.0.1:5186/#/scenarios), show the sole playable release, **Urgent account verification**, S-01 v0.2.0. Its fictional caller is Northstar Cooperative Bank. Select **Choose scenario** to open [the briefing](http://127.0.0.1:5186/#/training/precall/S-01).
3. Show the simulation framing, dummy-data rules and the disabled **Start simulation** button. Explain that live voice practice uses an AI-synthesized caller and microphone consent. In this offline run the approved caller lines are displayed as text and the microphone stays off. Accept consent and select **Start simulation**.
4. On `#/training/<session-id>`, show the caller and the **Offline demonstration** label. Select **Ask for time** and **Submit response**, or enter `I need more time.`. Wait for **1 / 3** and the approved caller line claiming authority. Select **Verify independently** and **Submit response**, or enter `Main official number par call karke check karunga.`.
5. The app opens `#/debrief/<session-id>`. Show **Independent verification**, two committed turns and **Claimed authority** under tactics encountered. The result credits an expressed verification choice and cannot establish that an external check happened. Point out the coaching and **Turn evidence and pressure timeline**.
6. Open [Scenario authoring](http://127.0.0.1:5186/#/authoring). Use **Saved draft JSON** with the local S-90 mock or S-91 import file below. Show the generated/imported provenance, fictional opening, tactics and validation findings. Both saved examples have zero errors and two review warnings.
7. Use **Workflow export JSON** to select `D:\vishing--vaccine\.cache\authoring\S-92-v0.1.1-approved.workflow.json`. Show **Approved**, **20/20 mandatory checks passed**, **PUBLICATION_BLOCKED** and **Not playable** together. Expand **Approval and publication record** for the recorded compatibility reasons. The approved content hash begins `7d280643`. The approval ID is `e2f279e3-820e-49b3-b66f-bd227bc48699`. The blocked publication ID is `381164a8-076f-46ab-b397-efe57285d63a`. Identify S-92 as trainer evidence. S-01 was the learner's call.
8. Return to **Overview** to show the actual **Offline demonstration** outcome count. Open [Session history](http://127.0.0.1:5186/#/sessions) and use **Open debrief** to return to the recorded result. Finish by connecting controlled scenarios, learner practice and evidence-based coaching.

Saved draft files for step 6:

| Example | Saved file under `.cache/authoring` |
| --- | --- |
| S-90 generated mock | `mock-80843162b78c5540dc3701cc770c1b2e7bc5544b2fafa1c93979c7bfc8d46235.json` |
| S-91 manual import | `import-fd46d669704caa567f76cba4d9c6db0dc9728c6a6c88b96d7b121455bae7d3b2.json` |

Use **Local commands to create or import** on the authoring page to show the real CLI workflow. `npm run authoring:draft -- list` prints saved paths. For a new generation use an unused fictional candidate identity in a copy of `content/authoring/examples/benefits-brief.json` and run `npm run authoring:draft -- generate <brief.json>`. For a new manual import run `npm run authoring:draft -- import <candidate.json>` with a complete valid candidate and an unused identity/version. A duplicate of a saved example is rejected by the existing store. The browser reads and validates saved files. Privileged decisions use the existing local CLI.

To show revision validation, open `import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337.json` as a saved draft. The missing-ancestor finding is expected. Open `mock-c5ab4e92ac5f0062efae8f774c2c4bba02ad86236b5dbaa3586c91efaddca3b5.json` with **Saved ancestor JSON files**. Validation now has zero errors and warnings. Loading the verified workflow export replaces the standalone preview. Inspect the current registry with `npm run --silent authoring:review -- status`.

## Optional live practice

Run the regular local development setup in separate terminals, with the existing server-side `.env` configured from `.env.example`.

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open [the live briefing](http://127.0.0.1:5173/#/training/precall/S-01). The API defaults to port 3001. Use the existing verified local configuration for `PRISMA_RUNTIME_ENABLED=true`, `TIMBRE_RUNTIME_ENABLED=true`, the server-only `GNANI_API_KEY`, positive `STT_COST_UNITS` and `TTS_COST_UNITS`, and sufficient configured `CREDIT_CAP` after `RESERVE_CAP` and prior usage. Values are local guard units. Keep the participant credentials server-side.

Select **Live voice · automatic conversation**, read the actual microphone consent, then select **Start simulation**. On the call page select **Start automatic conversation** and grant permission. Wait for **LEARNER LISTENING** before responding. Use **End simulation** for an immediate stop, or say `stop simulation` while listening. Local capture and playback are released by the existing controller. The offline walkthrough and fake-provider regression are the Phase 7 acceptance paths.

## Recovery and reset

- If the catalog is unavailable, confirm the corresponding API terminal is running and use **Retry connection**. A missing or withdrawn scenario cannot start.
- If the microphone is denied or disconnected, end the call or open its partial debrief. Reconnect the microphone or grant browser permission and start a new session with consent, or use the offline setup. A page reload closes an unfinished call and does not begin another.
- If transcription, playback or the local allowance fails, use **End simulation** or **Open debrief** to review committed turns. Switch to the offline setup for the recording. Check the application message before trying live voice again.
- Select **Practice again** for a fresh consent flow. Keep the same tab for recent results. For an empty view, open a fresh tab without duplicating the current tab. For a full reset, end active calls and stop the offline API and web terminals with Ctrl+C, then restart them. API restart clears process-local results. The authoring registry and export are local files and need no reset.
- To check offline usage, use the offline API address from terminal 1:

```powershell
$usage = Invoke-RestMethod 'http://127.0.0.1:3186/api/runtime/credit'
$usage.stt.providerAttempts
$usage.tts.providerAttempts
```

Both counters should be zero. The offline launcher uses the existing API factory with local fake adapters, and there is no Evon or other LLM call in the flow.

Run `npm run test:phase7`, `npm run test:phase6e`, `npm run check` and `git diff --check` from the repository root. See the [Phase 7 evidence](../evidence/phase7-product-experience.md).
