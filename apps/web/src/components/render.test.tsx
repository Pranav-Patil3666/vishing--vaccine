import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./AppShell.js";
import { PressureTimeline } from "./PressureTimeline.js";
import { VoiceSecurityCore } from "./VoiceSecurityCore.js";
import { routeHash } from "../route.js";
import { scenarioCatalog } from "../scenarioCatalog.js";
import { PressureTimelinePointSchema } from "@vaccine/contracts";

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
  const firstScenario = scenarioCatalog.find((scenario) => scenario.scenario_id === "S-02");
  assert.ok(firstScenario);
  assert.equal(firstScenario.lifecycle_status, "DRAFT");
  assert.equal(firstScenario.review_status, "draft");
  assert.equal(firstScenario.fictional_organization.training_only, true);
});

for (const [behavior, decision, precedingTactic, nextTactic, expected] of [
  ["STALLED", "SELECTED_TACTIC", null, "authority", "NEXT: AUTHORITY"],
  ["REFUSED", "SELECTED_TACTIC", "authority", "fear", "NEXT: FEAR"],
  ["COMPLIED", "SELECTED_TACTIC", null, "urgency", "NEXT: URGENCY"],
  ["STALLED", "SELECTED_TACTIC", null, null, "CONTINUE"],
  ["UNKNOWN", "NO_APPROVED_TACTIC", "authority", null, "SAFE FALLBACK"],
  ["UNKNOWN", "DRAFT_SAFE_FALLBACK", null, null, "SAFE FALLBACK"],
  ["VERIFIED_INDEPENDENTLY", "SAFE_VERIFIED", "authority", null, "SAFE VERIFIED"],
  ["DISCLOSED_DUMMY_SECRET", "DUMMY_SECRET_DISCLOSED", "authority", null, "DUMMY SECRET DISCLOSED"],
  ["UNKNOWN", "SAFE_WORD", null, null, "SAFE WORD"],
  ["REFUSED", "LEARNER_ENDED", "authority", null, "LEARNER ENDED"],
  ["COMPLIED", "MAX_TURNS", "urgency", null, "MAX TURNS"],
] as const) test(`${behavior}/${decision} card heading is ${expected} in full and compact timelines`, () => {
  const point = PressureTimelinePointSchema.parse({ turnId: "s:turn-1", callerTacticId: precedingTactic, callerPressureLevel: 0,
    selectedNextTacticId: nextTactic, learnerBehavior: { label: behavior, evidenceRuleIds: [], source: "deterministic_rules" },
    policyDecisionCode: decision, responseLatency: null, interruptedCaller: "unknown", complianceMoment: null,
    approximateTiming: true, timeReference: "session-local monotonic milliseconds", observedEvidence: [] });
  const original = JSON.stringify(point);
  for (const compact of [false, true]) {
    const markup = renderToStaticMarkup(<PressureTimeline points={[point]} compact={compact} />);
    assert.equal(/class="timeline-event-label">([^<]*)</u.exec(markup)?.[1], expected);
    if (expected !== "SAFE FALLBACK") assert.doesNotMatch(markup, /SAFE FALLBACK/u);
    assert.equal((markup.match(/data-pressure-point="true"/gu) ?? []).length, 1);
    assert.equal(JSON.stringify(point), original, "rendering must not change event/pressure facts");
  }
});
