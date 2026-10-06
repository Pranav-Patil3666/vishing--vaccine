import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer as createViteServer } from "vite";
import { createApiServer } from "../../api/src/health.js";

test("Vite web development proxy reaches the backend health route", async () => {
  const api = createApiServer({ environment: "test" });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress !== "string");

  const previousProxyTarget = process.env.API_PROXY_TARGET;
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiAddress.port}`;
  const vite = await createViteServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 },
  });

  try {
    await vite.listen();
    const webAddress = vite.httpServer?.address();
    assert.ok(webAddress && typeof webAddress !== "string");
    const response = await fetch(`http://127.0.0.1:${webAddress.port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json() as { status?: string; environment?: string };
    assert.equal(body.status, "ok");
    assert.equal(body.environment, "test");
  } finally {
    await vite.close();
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
    if (previousProxyTarget === undefined) delete process.env.API_PROXY_TARGET;
    else process.env.API_PROXY_TARGET = previousProxyTarget;
  }
});
