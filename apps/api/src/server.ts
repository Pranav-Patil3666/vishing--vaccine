import { loadRootEnvironment } from "./loadRootEnvironment.js";
import { parseServerEnvironment } from "./environment.js";
import { createApiServer } from "./health.js";
import { readPrismaRuntimeConfig } from "./providers/prisma/runtimeConfig.js";
import { PrismaRealtimeSpeechRecognizer } from "./providers/prisma/prismaRealtimeRecognizer.js";
import { TIMBRE_PROFILE, readTimbreRuntimeConfig } from "./providers/timbre/runtimeConfig.js";
import { TimbreSpeechSynthesizer } from "./providers/timbre/timbreSpeechSynthesizer.js";
import { ApprovedCallerCatalog } from "./callerAudio/catalog.js";
import { CallerAudioService } from "./callerAudio/service.js";
import { FileCallerAudioCache } from "./callerAudio/cache.js";
import { fileURLToPath } from "node:url";

loadRootEnvironment();

const environment = parseServerEnvironment(process.env);
const runtimePrisma = readPrismaRuntimeConfig(process.env);
const runtimeTimbre = readTimbreRuntimeConfig(process.env);
const server = createApiServer({
  environment: environment.nodeEnvironment,
  onRuntimeDenial: (event) => process.stderr.write(JSON.stringify({ type: "RUNTIME_SESSION_DENIED", ...event }) + "\n"),
  budget: {
    mode: "development",
    developmentCap: environment.developmentCreditCap,
    publicDemoCap: environment.publicDemoCreditCap,
    reserveCap: environment.reserveCap,
    usedUnits: 0,
  },
  sttUnits: environment.configuredSpeechRecognitionCostUnits ?? 0,
  ttsUnits: environment.configuredSpeechSynthesisCostUnits ?? 0,
  ...(runtimePrisma ? { runtimeRecognizer: new PrismaRealtimeSpeechRecognizer(runtimePrisma) } : {}),
  ...(runtimeTimbre ? { initialTtsUsedUnits: runtimeTimbre.usedUnits,
    callerAudio: (scenarios, reserve) => {
      const catalog = new ApprovedCallerCatalog(scenarios, TIMBRE_PROFILE.voice);
      return new CallerAudioService(catalog, TIMBRE_PROFILE, new FileCallerAudioCache(fileURLToPath(new URL("../../../.cache/tts", import.meta.url))),
        new TimbreSpeechSynthesizer(catalog, runtimeTimbre), reserve);
    } } : {}),
  ...(environment.appVersion ? { version: environment.appVersion } : {}),
});

server.listen(environment.port, "127.0.0.1", () => {
  process.stdout.write(`Vishing Vaccine API listening on 127.0.0.1:${environment.port}\n`);
});
