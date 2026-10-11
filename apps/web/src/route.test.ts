import assert from "node:assert/strict";
import test from "node:test";
import { parseHashRoute, routeHash } from "./route.js";

test("hash routes round-trip scenario and session identifiers safely", () => {
  const routes = [
    { page: "dashboard" },
    { page: "scenarios" },
    { page: "scenario", scenarioId: "S / 01" },
    { page: "authoring" },
    { page: "sessions" },
    { page: "precall", scenarioId: "S-02" },
    { page: "live", sessionId: "session / local" },
    { page: "debrief", sessionId: "session-02" },
  ] as const;
  for (const route of routes) assert.deepEqual(parseHashRoute(routeHash(route)), route);
});

test("unknown and incomplete routes land on the command center", () => {
  assert.deepEqual(parseHashRoute("#/missing/path"), { page: "dashboard" });
  assert.deepEqual(parseHashRoute("#/debrief"), { page: "dashboard" });
  assert.deepEqual(parseHashRoute(""), { page: "dashboard" });
});
