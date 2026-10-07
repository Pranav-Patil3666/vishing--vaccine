import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicBehaviorClassifier } from "./behaviorClassifier.js";

const classifier = new DeterministicBehaviorClassifier();

test("classifier returns only deterministic observable labels and rule IDs", () => {
  assert.equal(classifier.classify({ transcriptText: "I refuse to share that." }).label, "REFUSED");
  assert.equal(classifier.classify({ transcriptText: "Wait a moment, I need more time." }).label, "STALLED");
  assert.equal(classifier.classify({ transcriptText: "I will verify independently." }).label, "VERIFIED_INDEPENDENTLY");
  assert.equal(classifier.classify({ transcriptText: "I will share the requested token." }).label, "COMPLIED");
  assert.equal(classifier.classify({ transcriptText: "", dummySecretDisclosureObserved: true }).label, "DISCLOSED_DUMMY_SECRET");
  assert.equal(classifier.classify({ transcriptText: "A sentence with no mapped behavior." }).label, "UNKNOWN");
});

test("emotion words do not create emotional labels or emotion fields", () => {
  const result = classifier.classify({ transcriptText: "I am nervous and scared." });
  assert.equal(result.label, "UNKNOWN");
  assert.deepEqual(Object.keys(result).sort(), ["context", "evidenceRuleIds", "label", "safetySignals", "source"]);
  assert.equal("emotionalState" in result, false);
});

test("classifier uses scenario, tactic, and red-flag context while labeling multilingual observable behavior", () => {
  const result = classifier.classify({
    transcriptText: "Main OTP share nahi karunga; official channel se verify karunga.",
    activeTactic: { tacticId: "authority-check", category: "AUTHORITY" },
    scenario: { red_flag_ids: ["RF-05"] },
    relevantRedFlagIds: ["RF-01"],
  });
  assert.equal(result.label, "VERIFIED_INDEPENDENTLY");
  assert.equal(result.context.activeTacticId, "authority-check");
  assert.deepEqual(result.context.relevantRedFlagIds, ["RF-01", "RF-05"]);
  assert.ok(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"));
  assert.ok(result.safetySignals.includes("REFUSED_PAYMENT_CREDENTIAL"));
  assert.equal(classifier.classify({ transcriptText: "मुझे थोड़ा समय चाहिए।" }).label, "STALLED");
});
