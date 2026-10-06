import assert from "node:assert/strict";
import test from "node:test";
import { parseClientEnvironment } from "./environment.js";

test("client environment exposes only documented public variables", () => {
  assert.deepEqual(parseClientEnvironment({}), {
    VITE_PUBLIC_APP_NAME: "Vishing Vaccine — development shell",
    VITE_API_BASE_URL: "",
  });
});

test("client environment rejects provider credentials", () => {
  assert.throws(() => parseClientEnvironment({ GNANI_API_KEY: "placeholder" }));
});
