import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiServer } from "../../api/src/health.js";
import { fetchApiHealth } from "./healthClient.js";

test("web health client reaches the API /health endpoint using the shared response contract", async (context) => {
  const server = createApiServer({ environment: "test" });
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const health = await fetchApiHealth(`http://127.0.0.1:${address.port}`);
  assert.equal(health.status, "ok");
  assert.equal(health.environment, "test");
});

test("web health client reports HTTP failures without response-body details", async () => {
  await assert.rejects(
    fetchApiHealth("http://localhost", async () => new Response("secret-looking-body", { status: 503 })),
    (error: unknown) => error instanceof Error && error.message.includes("503") && !error.message.includes("secret-looking-body"),
  );
});
