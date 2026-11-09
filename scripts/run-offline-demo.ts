import { createApiServer } from "../apps/api/src/health.js";

const server = createApiServer({ environment: "test" });
server.on("error", () => {
  console.error("The offline practice API could not bind to 127.0.0.1:3186. Close any previous offline demo and retry.");
  process.exitCode = 1;
});
server.listen(3186, "127.0.0.1", () => {
  console.log("Offline practice API listening on 127.0.0.1:3186. Typed practice uses local mock adapters.");
});
