// Reuse only the saved, participant-verified approved opening. This script has no provider transport.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateScenarioDocument } from "@vaccine/scenario-schema";
import { ApprovedCallerCatalog } from "../apps/api/src/callerAudio/catalog.js";
import { FileCallerAudioCache } from "../apps/api/src/callerAudio/cache.js";
import { callerAudioKey } from "../apps/api/src/callerAudio/service.js";
import { TIMBRE_PROFILE } from "../apps/api/src/providers/timbre/runtimeConfig.js";

const recordPath = "docs/evidence/provider/timbre-verification.json";
const evidence = JSON.parse(await readFile(recordPath, "utf8"));
const bytes = await readFile(".cache/tts/verified-opening.wav");
const scenario = validateScenarioDocument(JSON.parse(await readFile("content/scenarios/S-01-urgent-account-verification.json", "utf8")));
const approved = new ApprovedCallerCatalog(new Map([["S-01", scenario]]), TIMBRE_PROFILE.voice).resolveId("S-01", "0.2.0", "system.opening");
if (!["VERIFIED_STREAMING_WAV", "VERIFIED_BINARY_WAV"].includes(evidence.status)
  || createHash("sha256").update(bytes).digest("hex") !== evidence.sha256 || approved.text !== evidence.approvedText
  || evidence.request.model !== TIMBRE_PROFILE.model || evidence.request.voice !== TIMBRE_PROFILE.voice || evidence.request.language !== TIMBRE_PROFILE.language
  || evidence.request.speed !== TIMBRE_PROFILE.speed || JSON.stringify(evidence.request.audio_config) !== JSON.stringify(TIMBRE_PROFILE.audioConfig)) throw new Error("Saved verification does not match the current approved synthesis profile.");
const cache = new FileCallerAudioCache(".cache/tts"), key = callerAudioKey(approved, TIMBRE_PROFILE);
await cache.set(key, bytes); const hit = await cache.get(key);
if (!hit) throw new Error("Seeded caller audio did not validate.");
const observation = { cacheKey: key, hit: true, byteLength: hit.length, providerCalls: 0, finalizedSha256: createHash("sha256").update(hit).digest("hex") };
evidence.offlineCacheSeed = observation; await writeFile(recordPath, JSON.stringify(evidence, null, 2) + "\n");
process.stdout.write(JSON.stringify(observation, null, 2) + "\n");
