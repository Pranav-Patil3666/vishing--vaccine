import { resolve } from "node:path";
import { ApplicationError } from "../apps/api/src/errors.js";
import { loadRootEnvironment } from "../apps/api/src/loadRootEnvironment.js";
import { loadSyntheticFixture, readVerificationConfig } from "../apps/api/src/providers/prisma/verificationConfig.js";
import { verifyPrisma, verifyPrismaMissingAuth } from "../apps/api/src/providers/prisma/verifyPrisma.js";
import { evaluateCreditRequest } from "@vaccine/credit-guard";

// Explicit closure run. Reviewed composites can establish several capabilities in one session.
try {
  loadRootEnvironment();
  if (process.argv.length < 3 || process.argv.length > 4 || (process.argv.length === 4 && process.argv[3] !== "--combined")) {
    throw new ApplicationError("INVALID_REQUEST", "Supply a reviewed synthetic fixture directory, optionally followed by --combined.");
  }
  const directory = resolve(process.argv[2]!);
  const base = readVerificationConfig(process.env);
  if (new URL(base.endpoint).pathname !== "/stt/v3/stream" || base.authHeaderName !== "x-api-key-id"
    || process.env.PRISMA_VERIFY_CREDENTIAL_ENV !== "GNANI_API_KEY" || base.sampleRateHz !== 16000 || base.frameBytes !== 1024
    || base.trailingPartial || base.headers.lang_code !== "hi-IN" || base.headers["x-sample-rate"] !== "16000" || Object.keys(base.headers).some((name) =>
      !["x-api-key-id", "lang_code", "x-sample-rate", "x-format"].includes(name))) {
    throw new ApplicationError("INVALID_REQUEST", "Closure probes require the preserved verified baseline transport settings.");
  }
  const cases = process.argv[3] === "--combined" ? ["COMBINED"] as const : ["SHORT", "SEGMENTATION", "HINGLISH"] as const;
  const plannedAttempts = cases.length + 1;
  const prepared = [];
  for (const probe of cases) {
    const config = { ...base, fixtureManifest: resolve(directory, probe.toLowerCase(), "manifest.json") };
    const fixture = await loadSyntheticFixture(config);
    if (fixture.probe !== probe || !fixture.parts) throw new ApplicationError("INVALID_REQUEST", "Closure fixture mode or reviewed speech ranges are missing.");
    prepared.push({ probe, config, fixture });
    console.log(JSON.stringify({ eventType: "fixture-reviewed", probe, durationMs: fixture.bytes.length / 32,
      parts: fixture.parts.map((part) => ({ phrase: part.phrase, startMs: part.startSample / 16, endMs: part.endSample / 16 })),
      voiceName: fixture.voiceName, voiceCulture: fixture.voiceCulture }));
  }
  const preflight = evaluateCreditRequest({ mode: "development", developmentCap: base.credit.cap, publicDemoCap: 0,
    reserveCap: base.credit.reserve, usedUnits: base.credit.used },
  { operation: "prisma-closure-probes", estimatedUnits: base.credit.estimated * plannedAttempts, cacheAvailable: false });
  if (!preflight.allowed) throw new ApplicationError("CREDIT_LIMIT_REACHED", "Configured credit budget cannot cover the selected closure attempts.");
  let attempts = 0;
  let failures = 0;
  for (const item of [...prepared, { probe: "ERROR" as const, config: base, fixture: prepared[0]!.fixture }]) {
    const config = { ...item.config, credit: { ...base.credit, used: base.credit.used + attempts * base.credit.estimated } };
    attempts++;
    console.log(JSON.stringify({ eventType: "probe-start", probe: item.probe, attempt: attempts,
      projectUsedUnitsBefore: config.credit.used, projectReservedUnits: config.credit.estimated }));
    try {
      const dependencies = { loadFixture: async () => item.fixture,
        emit: (diagnostic: unknown) => console.log(JSON.stringify({ probe: item.probe, diagnostic })) };
      const result = item.probe === "ERROR" ? await verifyPrismaMissingAuth(config, dependencies) : await verifyPrisma(config, dependencies);
      console.log(JSON.stringify({ eventType: "probe-result", probe: item.probe, result }));
    } catch (error) {
      failures++;
      const safe = error instanceof ApplicationError ? { code: error.code, message: error.message }
        : { code: "TRANSCRIPTION_FAILED", message: "Closure probe could not be completed." };
      console.error(JSON.stringify({ eventType: "probe-failed", probe: item.probe, ...safe }));
      // Unknown events require evidence review before a later probe. No automatic retries.
      if (safe.message.includes("unsupported verification event")) break;
    }
  }
  console.log(JSON.stringify({ eventType: "closure-run-summary", attempts, failures,
    projectUsedUnitsBefore: base.credit.used, projectReservedUnitsAfter: base.credit.used + attempts * base.credit.estimated,
    billing: "UNVERIFIED; local configured units only" }));
  if (failures || attempts !== plannedAttempts) process.exitCode = 1;
} catch (error) {
  const safe = error instanceof ApplicationError ? { code: error.code, message: error.message }
    : { code: "INVALID_REQUEST", message: "Closure verification preflight failed." };
  console.error(JSON.stringify({ eventType: "closure-preflight-failed", ...safe }));
  process.exitCode = 1;
}
