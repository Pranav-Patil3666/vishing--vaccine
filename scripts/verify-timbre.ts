// Intentionally separate from the runtime adapter. One approved line, one HTTP request, no retry.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadRootEnvironment } from "../apps/api/src/loadRootEnvironment.js";
import { validateScenarioDocument, isScenarioRuntimeEligible } from "@vaccine/scenario-schema";
import { evaluateCreditRequest } from "@vaccine/credit-guard";
import { inspectCallerWav } from "../apps/api/src/callerAudio/wav.js";

loadRootEnvironment();
const evidencePath = "docs/evidence/provider/timbre-verification.json";
const endpoint = "https://api.vachana.ai/api/v1/tts/inference";
const parameters = { model: "timbre-v2.5", voice: "Nalini", language: "hi-IN", speed: 1,
  audio_config: { sample_rate: 48000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" } };
async function run() {
  if (!process.argv.includes("--live")) throw new Error("Use --live only for an intentional single approved-line probe.");
  const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
  const response = scenario.responses["system.opening"];
  if (!isScenarioRuntimeEligible(scenario) || scenario.scenario_id !== "S-01" || scenario.language !== "hi-IN" || response?.safety_status !== "reviewed_safe") throw new Error("Approved S-01 opening is required.");
  if (!process.env.GNANI_API_KEY?.trim()) throw new Error("Backend credential unavailable.");
  const units = Number(process.env.TTS_COST_UNITS);
  if (!Number.isFinite(units) || units <= 0) throw new Error("Positive TTS_COST_UNITS is required before a provider attempt.");
  const credit = evaluateCreditRequest({ mode: "development", developmentCap: Number(process.env.CREDIT_CAP ?? 0), publicDemoCap: 0,
    reserveCap: Number(process.env.RESERVE_CAP ?? 0), usedUnits: 0 }, { operation: "timbre-verification", estimatedUnits: units, cacheAvailable: false });
  if (!credit.allowed) throw new Error("Configured TTS project-unit capacity does not allow this probe.");
  // A durable marker prevents accidentally repeating this billable probe after a timeout/failure.
  await mkdir("docs/evidence/provider", { recursive: true });
  const record: Record<string, unknown> = { observedAt: new Date().toISOString(), attemptCount: 1, status: "ATTEMPT_STARTED", endpoint,
    authHeader: "X-API-Key-ID", credentialEnvironment: "GNANI_API_KEY", scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
    responseId: "system.opening", approvedText: response.text, request: parameters, projectUnitsReserved: units, priorTtsProjectUnits: 0 };
  await writeFile(evidencePath, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  const started = performance.now();
  try {
    const result = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", "X-API-Key-ID": process.env.GNANI_API_KEY }, body: JSON.stringify({ text: response.text.normalize("NFKC"), ...parameters }) });
    record.httpStatus = result.status; record.responseMediaType = result.headers.get("content-type")?.split(";")[0];
    if (!result.ok || record.responseMediaType !== "audio/wav") { await result.body?.cancel(); throw new Error("Provider rejected the probe or returned an unsupported media type."); }
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of result.body!) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error("Provider audio exceeds limit."); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks); record.synthesisMs = Math.round(performance.now() - started);
    record.byteLength = bytes.length; record.sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(".cache/tts", { recursive: true }); await writeFile(".cache/tts/verified-opening.wav", bytes);
    record.audio = inspectCallerWav(bytes);
    record.status = "VERIFIED_BINARY_WAV"; record.browserDecode = "PENDING"; record.physicalPlayback = "PENDING";
  } catch {
    record.status = "FAILED_NO_RETRY"; record.elapsedMs = Math.round(performance.now() - started);
    record.error = "Sanitized verification failure; inspect status/media type. No raw provider payload or credential is logged.";
    process.exitCode = 1;
  }
  await writeFile(evidencePath, JSON.stringify(record, null, 2) + "\n");
  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
}
void run().catch(() => { process.stderr.write("Timbre preflight blocked: check approved content, credential/cost/cap, --live and existing attempt evidence. No automatic retry.\n"); process.exitCode = 1; });
