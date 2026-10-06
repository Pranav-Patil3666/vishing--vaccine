import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiServer } from "./health.js";

test("GET /health returns structured status without exposing configuration", async (context) => {
  const server = createApiServer({
    environment: "test",
    version: "0.1.0",
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    environment: "test",
    timestamp: "2026-10-06T00:00:00.000Z",
    version: "0.1.0",
  });
});

test("health version is omitted when unavailable and non-health paths are not exposed", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  const body = await health.json() as Record<string, unknown>;
  assert.equal("version" in body, false);
  const unknown = await fetch(`http://127.0.0.1:${address.port}/secret`);
  assert.equal(unknown.status, 404);
});
