import assert from "node:assert/strict";
import test from "node:test";
import { scenarioById, scenarioCatalog, scenarioFocus, scenarioTacticCount, scenarioTitle } from "./scenarioCatalog.js";

test("scenario catalog validates source packages and keeps their draft boundary visible", () => {
  assert.equal(scenarioCatalog.length, 3);
  for (const scenario of scenarioCatalog) {
    assert.equal(scenario.simulation, true);
    assert.equal(scenario.fictional_organization.training_only, true);
    assert.equal(scenario.lifecycle_status, "DRAFT");
    assert.equal(scenario.review_status, "draft");
    assert.ok(scenarioTitle(scenario).length > 0);
    assert.ok(scenarioFocus(scenario).length > 0);
    assert.equal(scenarioTacticCount(scenario), scenario.adaptive_policy?.tactics.length ?? 0);
  }
});

test("scenario lookup handles known and unknown identifiers", () => {
  assert.equal(scenarioById("S-01")?.scenario_id, "S-01");
  assert.equal(scenarioById("missing"), undefined);
  assert.equal(scenarioById(undefined), undefined);
});
