import { loadRootEnvironment } from "./loadRootEnvironment.js";
import { parseServerEnvironment } from "./environment.js";
import { createApiServer } from "./health.js";

loadRootEnvironment();

const environment = parseServerEnvironment(process.env);
const server = createApiServer({
  environment: environment.nodeEnvironment,
  budget: {
    mode: "development",
    developmentCap: environment.developmentCreditCap,
    publicDemoCap: environment.publicDemoCreditCap,
    reserveCap: environment.reserveCap,
    usedUnits: 0,
  },
  sttUnits: environment.configuredSpeechRecognitionCostUnits ?? 0,
  ttsUnits: environment.configuredSpeechSynthesisCostUnits ?? 0,
  ...(environment.appVersion ? { version: environment.appVersion } : {}),
});

server.listen(environment.port, "127.0.0.1", () => {
  process.stdout.write(`Vishing Vaccine API listening on 127.0.0.1:${environment.port}\n`);
});
