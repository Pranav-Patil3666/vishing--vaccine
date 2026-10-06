import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseServerEnvironment } from "./environment.js";
import { createApiServer } from "./health.js";

const envFilePath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFilePath)) process.loadEnvFile(envFilePath);

const environment = parseServerEnvironment(process.env);
const server = createApiServer({
  environment: environment.nodeEnvironment,
  ...(environment.appVersion ? { version: environment.appVersion } : {}),
});

server.listen(environment.port, "127.0.0.1", () => {
  process.stdout.write(`Vishing Vaccine API listening on 127.0.0.1:${environment.port}\n`);
});
