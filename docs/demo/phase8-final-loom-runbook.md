# Vishing Vaccine Loom runbook

## A. Environment

Use the existing checkout and lockfile. From PowerShell, confirm `node --version` and `npm --version`. Run `npm ci` once if dependencies are missing. Start the offline API in one terminal.

```powershell
Set-Location 'D:\vishing--vaccine'
npm run dev:api:offline
```

Wait for `Offline practice API listening on 127.0.0.1:3186`. In a second PowerShell terminal, start Vite.

```powershell
Set-Location 'D:\vishing--vaccine'
$env:API_PROXY_TARGET = 'http://127.0.0.1:3186'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:5186'
npm run dev --workspace @vaccine/web -- --port 5186 --strictPort
```

Open [Overview at port 5186](http://127.0.0.1:5186/#/dashboard). Start with a fresh tab for an empty history.

## B. Preflight

| # | Check before recording |
| --- | --- |
| 1 | Both terminals are at `D:\vishing--vaccine`. |
| 2 | Node, npm and the locked dependencies are available. |
| 3 | The offline API listens on port 3186. |
| 4 | Vite listens on port 5186 with `--strictPort`. |
| 5 | The browser opens the Overview at port 5186. |
| 6 | The header reports **API ONLINE** and Training loads. |
| 7 | Training offers S-01 v0.2.0. |
| 8 | A direct visit to `/#/training/precall/S-92` shows **Scenario unavailable**. |
| 9 | **Start simulation** activates only after consent. Decline returns to Training. |
| 10 | The call shows **Offline demonstration · Typed practice** and starts at 0 / 3 turns. |
| 11 | The two sample replies produce independent verification in two turns. |
| 12 | The debrief shows both decisions, claimed authority and safer next action. |
| 13 | **Scenario authoring** loads its file selectors and workflow description. |
| 14 | The existing S-92 workflow export opens with current validation and zero errors and warnings. |
| 15 | **Approved**, **PUBLICATION_BLOCKED** and **Not playable** appear separately. |
| 16 | Overview counts the actual offline run. |
| 17 | Session history lists the run and **Open debrief** returns to it. |
| 18 | The browser console shows no uncaught frontend errors during the healthy walkthrough. |
| 19 | Critical local API requests succeed during the healthy walkthrough. |
| 20 | Both provider-attempt counters are zero. |

Resolve any failed item before recording. Check the offline counters in PowerShell.

```powershell
$phase8Usage = Invoke-RestMethod 'http://127.0.0.1:3186/api/runtime/credit'
$phase8Usage.stt.providerAttempts
$phase8Usage.tts.providerAttempts
```

## C. Primary walkthrough

1. In **Overview**, choose **Start training**, then **Choose scenario** on **Urgent account verification**. Show S-01 v0.2.0 and the fictional organization.
2. Pause on **Before you begin**. Point out dummy information only, typed practice, the safe word and **End simulation**. Check the consent box and choose **Start simulation**.
3. Show the approved opening text. Select **Ask for time**, which fills `I need more time.`, and select **Submit response**. Expect **1 / 3** and the approved authority line containing `demo verification team se hoon`.
4. Select **Verify independently**, which fills `Main official number par call karke check karunga.`, then **Submit response**. Expect **Independent verification** (`SAFE_VERIFIED`) and **2 committed turns** in the debrief.
5. Show **Asked for time**, **Chose independent verification**, **Claimed authority**, and the recommendation to use an independently known official channel. The recorded decision describes what the learner said. The debrief makes no claim about an external check. Expand **Turn evidence and pressure timeline** to show two points with latency **Not captured**.

For a separate stop rehearsal, type `stop simulation` and submit. The debrief shows **Safe word used**.

## D. Trainer demonstration

Open **Scenario authoring**. In **Saved draft JSON**, open the following examples from `D:\vishing--vaccine\.cache\authoring`.

| Example | Filename | Expected source |
| --- | --- | --- |
| S-90 v0.1.0 | `mock-80843162b78c5540dc3701cc770c1b2e7bc5544b2fafa1c93979c7bfc8d46235.json` | Deterministic mock generation |
| S-91 v0.1.0 | `import-fd46d669704caa567f76cba4d9c6db0dc9728c6a6c88b96d7b121455bae7d3b2.json` | Manual import |

Both examples are drafts with zero errors and two warnings. Use **Workflow export JSON** for `D:\vishing--vaccine\.cache\authoring\S-92-v0.1.1-approved.workflow.json`. Show **Revalidated PASS**, zero errors and warnings, **Submitted validation current**, **Approved**, **20/20 mandatory checks passed**, **PUBLICATION_BLOCKED**, and **Not playable**. Expand **Approval and publication record** for runtime eligibility false, approval `e2f279e3-820e-49b3-b66f-bd227bc48699`, and blocked attempt `381164a8-076f-46ab-b397-efe57285d63a`.

If rehearsing the standalone revision, load `import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337.json` as a saved draft. Its missing-lineage finding clears after choosing `mock-c5ab4e92ac5f0062efae8f774c2c4bba02ad86236b5dbaa3586c91efaddca3b5.json` in **Saved ancestor JSON files**. Opening the workflow export replaces that standalone preview.

## E. Dashboard

Return to **Overview** and point to the **Offline demonstration** group. Show only outcomes created by your rehearsals in that tab. Open **Session history** and use **Open debrief** on the current run. Results are newest first. An empty history is expected in a fresh tab or after an API restart.

## F. Recovery and shutdown

- **API unavailable or wrong target.** Check the API terminal and both Vite environment assignments in A. Use **Retry connection** in Training. If the web process exited or the old bundle is visible, restart Vite with the same command and reload the port 5186 tab.
- **Occupied ports.** Identify the listener before touching a process. Close only your obsolete demo terminal with Ctrl+C and retry. Leave unrelated listeners and the regular development server alone.

  ```powershell
  Get-NetTCPConnection -LocalPort 3186,5186 -State Listen |
    Select-Object LocalAddress, LocalPort, OwningProcess
  # Substitute the listener PID shown above.
  Get-Process -Id <PID>
  ```

- **Interrupted call.** Use **Retry End simulation** after the API returns. This recovers any committed turns if the same process still owns the session. If the process restarted, choose **Back to training** and start a fresh consented call. Refreshing an active call closes it. Use **Open debrief** to inspect any preserved turns.
- **Failed response or unexpected ending.** Retry a typed response only when the app explicitly offers it after checking the session. For an unexpected terminal result, inspect the debrief and start over via **Practice again**. Use the exact sample buttons in C.
- **Missing history.** Keep the same tab and API process for the recording. Use **Retry session lookup** after a disconnect. To clear the view, use a fresh tab. For a full reset, end any active call, stop only the two offline terminals with Ctrl+C, and rerun A.
- **Invalid preview or stale export.** Choose the saved draft or verified workflow export in the corresponding field. If needed, export the same candidate to a separate local file with the read-only CLI.

  ```powershell
  $phase8Export = npm run --silent authoring:review -- export import-7d2806433a6b9641c5eaacca23570fa73c8973ca736d90b23d2e88140a360337
  if ($LASTEXITCODE -eq 0) {
    $phase8Path = Join-Path (Get-Location).Path '.cache\authoring\S-92-v0.1.1-loom.workflow.json'
    [IO.File]::WriteAllText($phase8Path, ($phase8Export -join "`n"), [Text.UTF8Encoding]::new($false))
  }
  ```

## G. Prototype limits

The verified recording uses typed inputs and approved caller text through the existing offline mock adapters. Browser microphone capture, caller playback, and paid provider execution were outside the Phase 8 browser run. Real Evon is absent. The real workspace has one playable release, S-01 v0.2.0. S-92 is approved and unpublished. Results are local to one browser tab and one API process.

## H. Recording notes

Use 100% zoom at 1920×1080 when available. Pause on consent, the authority continuation, the two-turn debrief and the three separate S-92 status cards. Scroll once to the publication reasons, then return to the live results count in Overview. Use a normal recording-window size and keep the port 5186 tab visible throughout. [Phase 8 acceptance evidence](../evidence/phase8-final-stabilization.md)
