import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./AppShell.js";
import { PressureTimeline } from "./PressureTimeline.js";
import { VoiceSecurityCore } from "./VoiceSecurityCore.js";
import { routeHash } from "../route.js";
import { scenarioCatalog } from "../scenarioCatalog.js";

test("shell and signal components render simulation labels and responsive navigation", () => {
  const markup = renderToStaticMarkup(<AppShell route={{ page: "dashboard" }} health={null}>
    <VoiceSecurityCore activity="idle" />
    <PressureTimeline points={[]} />
  </AppShell>);
  assert.match(markup, /SIMULATION ONLY/u);
  assert.match(markup, /Scenario library/u);
  assert.match(markup, /VOICE SECURITY LAB/u);
  assert.match(markup, /No call events yet/u);
  assert.match(markup, /Voice security visualization: idle/u);
  assert.match(routeHash({ page: "authoring" }), /authoring/u);
});

test("source content is inspectable without marking draft scenarios as approved", () => {
  const firstScenario = scenarioCatalog[0];
  assert.ok(firstScenario);
  assert.equal(firstScenario.lifecycle_status, "DRAFT");
  assert.equal(firstScenario.review_status, "draft");
  assert.equal(firstScenario.fictional_organization.training_only, true);
});
