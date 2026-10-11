import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockEvonAuthoringAdapter } from "../../api/src/providers/evon/mockEvon.js";
import { ScenarioBriefSchema } from "@vaccine/contracts";
import { LocalDraftReview } from "./components/LocalDraftReview.js";
import { ScenarioCard } from "./components/ScenarioCard.js";
import { normalizeMockDraft, canonicalTacticIds, redFlagLabels, renderDebriefPreview, selectPressureLevels } from "./authoringDraft.js";
import { getScenarioCatalog, scenarioCatalog } from "./scenarioCatalog.js";

const brief = ScenarioBriefSchema.parse({
  scenarioId: "S-90",
  learningObjective: "Practice pausing and checking a request through a known channel.",
  redFlags: ["RF-01", "RF-02", "RF-08"],
  language: "hi-en",
});

async function generatedLocalDraft(knownRealOrganizations: readonly string[] = []) {
  const packageValue = await new MockEvonAuthoringAdapter().generateDraftScenarioPackage(brief);
  return normalizeMockDraft(packageValue, knownRealOrganizations);
}

test("normalization creates five canonical tactics and fifteen pressure lines from the API maximum", async () => {
  const draft = await generatedLocalDraft();
  assert.deepEqual(draft.tactics.map((tactic) => tactic.id), canonicalTacticIds);
  assert.equal(draft.tactics.length, 5);
  assert.equal(draft.tactics.flatMap((tactic) => tactic.lines).length, 15);
  assert.equal(draft.scenario.adaptive_policy?.max_pressure_level, 2);
  for (const tactic of draft.tactics) {
    assert.equal(tactic.response.id, tactic.id);
    assert.deepEqual(tactic.lines.map((line) => line.pressureLevel), [0, 1, 2]);
    assert.equal(draft.scenario.responses[tactic.id]?.text, tactic.response.text);
    const policyTactic: NonNullable<typeof draft.scenario.adaptive_policy>["tactics"][number] | undefined = draft.scenario.adaptive_policy?.tactics.find((item) => item.tactic_id === tactic.id);
    assert.deepEqual(policyTactic?.response_ids, [tactic.id]);
  }
  assert.deepEqual(Object.keys(draft.scenario.responses).sort(), [...canonicalTacticIds, "system.safe-fallback"].sort());
  assert.equal(draft.scenario.lifecycle_status, "DRAFT");
  assert.equal(draft.scenario.review_status, "draft");
  assert.deepEqual(selectPressureLevels(2), [0, 1, 2]);
  assert.throws(() => selectPressureLevels(1), /three distinct integer pressure levels/u);
});

test("training examples and debrief variants have the required fixed counts and safe dummy format", async () => {
  const draft = await generatedLocalDraft();
  assert.equal(draft.trainingExamples.length, 15);
  for (const behavior of ["REFUSED", "STALLED", "VERIFIED_INDEPENDENTLY", "COMPLIED", "DISCLOSED_DUMMY_SECRET"]) {
    assert.equal(draft.trainingExamples.filter((example) => example.label === behavior).length, 3);
  }
  const dummyExamples = draft.trainingExamples.filter((example) => example.label === "DISCLOSED_DUMMY_SECRET");
  assert.equal(dummyExamples.length, 3);
  for (const example of dummyExamples) {
    assert.match(example.utterance, /DUMMY-\d{4}/u);
    assert.doesNotMatch(example.utterance, /DUMMY-(?!\d{4}\b)\d+/u);
  }
  assert.equal(draft.debriefVariants.length, 5);
  assert.deepEqual(draft.debriefVariants.map((variant) => variant.id), ["refused", "stalled", "verified_independently", "complied", "disclosed_dummy_secret"]);
  for (const variant of draft.debriefVariants) {
    for (const placeholder of ["{latency}", "{timestamp}", "{behavior}"]) assert.ok(variant.text.includes(placeholder));
  }
  assert.match(renderDebriefPreview(draft.debriefVariants[1]!), /612 ms/u);
  assert.match(renderDebriefPreview(draft.debriefVariants[1]!), /around 00:18/u);
  assert.match(renderDebriefPreview(draft.debriefVariants[1]!), /stalled/u);
});

test("preflight separates missing brand coverage from configured matches and keeps selected red flags canonical", async () => {
  const draft = await generatedLocalDraft();
  assert.equal(draft.safetyPreflight.localOnly, true);
  assert.equal(draft.safetyPreflight.checks.find((check) => check.id === "real-brand-scan")?.status, "WARNING");
  assert.equal(draft.safetyPreflight.checks.find((check) => check.id === "credential-scan")?.status, "PASS");
  assert.equal(draft.safetyPreflight.checks.find((check) => check.id === "simulation-disclosure")?.status, "PASS");
  assert.deepEqual(draft.scenario.red_flag_ids, ["RF-01", "RF-02", "RF-08"]);
  assert.deepEqual(redFlagLabels, {
    "RF-01": "Urgency",
    "RF-02": "Authority impersonation",
    "RF-03": "Secrecy",
    "RF-04": "Remote access",
    "RF-05": "OTP/PIN request",
    "RF-06": "UPI/payment credential",
    "RF-07": "Lock/penalty threat",
    "RF-08": "Payment/refund bait",
  });

  const configuredMatch = await generatedLocalDraft(["Fictional Practice Desk"]);
  assert.equal(configuredMatch.safetyPreflight.checks.find((check) => check.id === "real-brand-scan")?.status, "FAIL");
  assert.equal(configuredMatch.safetyPreflight.status, "FAIL");
});

test("local drafts appear as one catalog record alongside unchanged source scenarios", async () => {
  const draft = await generatedLocalDraft();
  const catalog = getScenarioCatalog([draft]);
  assert.equal(scenarioCatalog.length, 3);
  assert.equal(catalog.length, 4);
  assert.equal(catalog.filter((scenario) => scenario.scenario_id === "S-90").length, 1);
  assert.equal(catalog.find((scenario) => scenario.scenario_id === "S-90")?.review_status, "draft");
});

test("local draft review renders all authored content and keeps backend actions unavailable", async () => {
  const draft = await generatedLocalDraft();
  const review = renderToStaticMarkup(createElement(LocalDraftReview, { draft, onBack: () => undefined }));
  assert.match(review, /S-90/u);
  assert.match(review, /NOT SUBMITTED/u);
  assert.match(review, /FRONTEND SAFETY PREFLIGHT · LOCAL ONLY/u);
  assert.equal((review.match(/class="local-tactic"/gu) ?? []).length, 5);
  assert.equal((review.match(/class="local-example"/gu) ?? []).length, 15);
  assert.equal((review.match(/class="local-debrief"/gu) ?? []).length, 5);
  assert.match(review, /around 00:18/u);
  assert.match(review, /Available after backend workflow integration\./u);

  const card = renderToStaticMarkup(createElement(ScenarioCard, {
    scenario: draft.scenario,
    isLocalDraft: true,
    onOpen: () => undefined,
    onStart: () => undefined,
  }));
  assert.match(card, /Draft \(local\)/u);
  assert.match(card, /NOT SUBMITTED/u);
  assert.match(card, /button-outline button-small" type="button" disabled=""/u);
  assert.match(card, /Preview demo/u);
  assert.match(card, /Open in authoring/u);
  assert.match(card, /aria-disabled="true"/u);
});
