import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicBehaviorClassifier, normalizeBehaviorClauses, normalizeTranscript } from "./behaviorClassifier.js";

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

test("observed live Devanagari loanwords express independent verification without changing transcript text", () => {
  const transcriptText = "मैं पहले इंडिपेंडेंटली वेरिफाई करूंगा।";
  const input = { transcriptText, scenario: { red_flag_ids: ["RF-01", "RF-02"] } };
  const result = classifier.classify(input);
  assert.equal(result.label, "VERIFIED_INDEPENDENTLY"); assert.equal(result.source, "deterministic_rules");
  assert.ok(result.evidenceRuleIds.includes("behavior.concept.independent_action"));
  assert.ok(result.evidenceRuleIds.includes("behavior.concept.verify_action"));
  assert.ok(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"));
  assert.equal(input.transcriptText, transcriptText); assert.equal(normalizeTranscript(transcriptText), transcriptText);
});

const verificationVariants = [
  "Main independently verify karunga.",
  "Main pehle official app se verify karunga.",
  "Main khud check karunga.",
  "Main official number par call karunga.",
  "मैं खुद वेरिफाई करूंगा।",
  "मैं official app से verify करूंगा।",
  "Main official app से verify karunga.",
  "मैं official number par call karke check करूंगा।",
  "Main official number par call karke check karunga.",
  "Main apne aap confirm karunga.",
  "मैं आधिकारिक वेबसाइट से जांच करूंगी।",
  "मैं ऑफिशियल नंबर पर कॉल करूँगा।",
  "मैं इन्डिपेन्डेन्टली वेरीफाई करूँगी।",
  "मैं इंडिपेंडेंटली वेरिफ़ाई करूँगा।",
  "I will independently check using the official website.",
  "I will call back using a number I already know.",
  "Main pehle verify karunga.",
  "I will verify on my own.",
  "I will not share a code; I will verify independently.",
  "Main caller ke diye hue number par wapas call nahi karunga; known contact se confirm karunga.",
];
for (const [index, transcriptText] of verificationVariants.entries()) test(`independent verification concept variant ${index + 1}`, () => {
  const result = classifier.classify({ transcriptText });
  assert.equal(result.label, "VERIFIED_INDEPENDENTLY"); assert.equal(result.evidenceRuleIds[0], "behavior.verify_independent");
  assert.ok(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"));
});

const nonVerificationVariants = [
  "Verification continue karte hain.",
  "Main aapki instructions follow karunga.",
  "Token dekar verify karunga.",
  "Caller verify kar dega.",
  "Verification pending hai.",
  "Main agree karta hoon.",
  "आप verify कर दो.",
  "Verification complete kar do.",
  "Main aapke kehne par verify kar raha hoon.",
  "Caller ke saath verification continue karo.",
  "Main token dekar verify karunga.",
  "Main independently verify nahi karunga.",
  "Main khud check nahi karunga.",
  "I will not independently verify.",
  "मैं खुद वेरिफाई नहीं करूंगा।",
  "Main caller ke saath independently verify karunga.",
  "Main caller ke diye hue official number par verify karunga.",
  "Main aapke official app se verify karunga.",
  "I will independently verify following your instructions.",
  "Main khud token dekar verify karunga.",
  "Should I independently verify?",
  "Main unofficial app se verify karunga.",
  "Main khud preverify karunga.",
  "Main independentlyverify karunga.",
  "Main official app.",
  "Caller asks me to independently verify.",
  "I refuse to independently verify.",
  "Main independently verify karne se mana karta hoon.",
  "I can’t independently verify.",
  "Main independently verify, nahi karunga.",
  "मैं खुद वेरिफाई, नहीं करूंगा।",
  "Main official app verification pending hai.",
];
for (const [index, transcriptText] of nonVerificationVariants.entries()) test(`caller compliance, negation or insufficient verification evidence ${index + 1}`, () => {
  const result = classifier.classify({ transcriptText });
  assert.notEqual(result.label, "VERIFIED_INDEPENDENTLY");
  assert.equal(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"), false);
});

test("concept normalization preserves Devanagari marks, token boundaries, negation and exact dummy syntax", () => {
  const clauses = normalizeBehaviorClauses("मैं ख़ुद वेरीफाई नहीं करूँगा; DUMMY-4821 preverify unofficial.");
  assert.deepEqual(clauses[0], ["self", "independent", "verify", "negation", "intend"]);
  assert.deepEqual(clauses[1], ["DUMMY-4821", "preverify", "unofficial"]);
  assert.equal(normalizeTranscript("DUMMY-4821"), "DUMMY-4821");
  assert.deepEqual(normalizeBehaviorClauses("Ｉ will independently verify."), [["self", "future", "independent", "verify"]]);
  assert.deepEqual(normalizeBehaviorClauses("preverify unofficial पूर्वलेकिनपर"), [["preverify", "unofficial", "पूर्वलेकिनपर"]]);
});

test("existing disclosure and behavior precedence remains explicit", () => {
  const disclosed = classifier.classify({ transcriptText: "Main independently verify karunga, DUMMY-4821.", dummySecretDisclosureObserved: true });
  assert.equal(disclosed.label, "DISCLOSED_DUMMY_SECRET"); assert.deepEqual(disclosed.evidenceRuleIds, ["behavior.synthetic_dummy_secret_match"]);
  assert.equal(classifier.classify({ transcriptText: "I refuse to independently verify." }).label, "REFUSED");
  assert.equal(classifier.classify({ transcriptText: "I refuse to share; I will independently verify." }).label, "VERIFIED_INDEPENDENTLY");
  assert.equal(classifier.classify({ transcriptText: "Main agree karta hoon; mujhe sochne do." }).label, "COMPLIED");
  assert.equal(classifier.classify({ transcriptText: "Mujhe sochne do; abhi sure nahi." }).label, "STALLED");
  assert.equal(classifier.classify({ transcriptText: "DUMMY-4821" }).label, "UNKNOWN"); // Disclosure remains an upstream confirmed signal.
});

test("verification safety signal uses the same match and retains red-flag context scope", () => {
  const result = classifier.classify({ transcriptText: "मैं खुद वेरिफाई करूंगा।", scenario: { red_flag_ids: ["RF-05"] } });
  assert.equal(result.label, "VERIFIED_INDEPENDENTLY");
  assert.equal(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"), false);
});

// Synthetic compositional STT variants, not assertions of unprovided exact live transcripts.
for (const [prefix, suffix] of [["Main", "karunga"], ["I will", ""], ["आई विल", ""]]) {
  for (const independent of ["independently", "independent", "इंडिपेंडेंटली", "इन्डिपेंडेंटली"]) {
    for (const action of ["verify", "verification", "check", "वेरिफाई", "वेरिफाय"]) {
      const transcriptText = `${prefix} ${independent} ${action} ${suffix}`.trim();
      test(`synthetic compositional concepts: ${transcriptText}`, () => {
        const input = { transcriptText }; const result = classifier.classify(input);
        assert.equal(result.label, "VERIFIED_INDEPENDENTLY");
        assert.ok(result.evidenceRuleIds.includes("behavior.concept.independent_action"));
        assert.ok(result.evidenceRuleIds.includes("behavior.concept.verify_action"));
        assert.ok(result.evidenceRuleIds.includes("behavior.scope.action_not_negated"));
        assert.equal(input.transcriptText, transcriptText);
      });
    }
  }
}

for (const transcriptText of [
  "Nahi, main independently verify karunga.",
  "नहीं, मैं खुद verify करूंगा।",
  "No, I will verify through the official number.",
  "Nahi, main official app se check karunga.",
  "Nahi, main official number pe call karunga.",
  "Nahi main independently verify karunga.", // Missing STT punctuation must not change the role.
  "Nope, I will independently verify.",
  "नहीं, आई विल इंडिपेंडेंटली वेरिफाय।",
]) test(`leading rejection outside positive learner action: ${transcriptText}`, () => {
  const result = classifier.classify({ transcriptText });
  assert.equal(result.label, "VERIFIED_INDEPENDENTLY");
  assert.ok(result.evidenceRuleIds.includes("behavior.scope.leading_rejection"));
  assert.ok(result.evidenceRuleIds.includes("behavior.scope.action_not_negated"));
  assert.ok(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"));
});

for (const transcriptText of [
  "मैं खुद वेरिफाय करूंगा।",
  "आई विल इंडिपेंडेंटली वेरिफाय करूंगा।", // Synthetic completion of the approximate English-speech report.
  "मैं स्वतः चेक करूंगा।",
  "Main apne aap कन्फर्म karunga.",
  "Main official website pe check karunga.",
  "Main khud official app khol kar request dekhunga.", // Existing Phase3A authoring example.
  "Main apne known channel se status check karke bataunga.",
]) test(`bounded native and mixed-script action: ${transcriptText}`, () => {
  assert.equal(classifier.classify({ transcriptText }).label, "VERIFIED_INDEPENDENTLY");
});

for (const transcriptText of [
  "Main official number pe call nahi karunga.",
  "Main official number pe call, nahi karunga.",
  "मैं आधिकारिक नंबर पर कॉल नहीं करूंगा।",
  "मैं इंडिपेंडेंटली वेरिफाई नहीं करूंगा।",
  "I will never independently verify.",
  "I won't call the official number.",
  "Not I will independently verify.",
  "Mat main independently verify karunga.",
  "Nahi, main independently verify nahi karunga.",
  "नहीं, मैं खुद वेरिफाय नहीं करूंगा।",
  "No, I will not independently verify.",
  "No, I refuse to independently verify.",
  "आई विल नॉट इंडिपेंडेंटली वेरिफाय।",
  "Nahi independently verify karunga.", // No explicit new learner clause: retain negation.
  "Nahi, caller independently verify karunga.",
]) test(`action negation must not create verification evidence: ${transcriptText}`, () => {
  const result = classifier.classify({ transcriptText });
  assert.notEqual(result.label, "VERIFIED_INDEPENDENTLY");
  assert.equal(result.safetySignals.includes("CHALLENGED_URGENCY_OR_VERIFIED"), false);
  assert.equal(result.evidenceRuleIds.includes("behavior.scope.action_not_negated"), false);
});

for (const transcriptText of [
  "Aap verify kar do.",
  "Main aapke saath verification continue karunga.",
  "Main aapke kehne par verify karunga.",
  "Main yahin call par verification complete karunga.",
  "Nahi, main aapke saath independently verify karunga.",
  "Nahi, main khud token dekar verify karunga.",
  "No, I will independently verify using your official app.",
  "आई विल वेरिफाय।", // Agency/action without independent or official-channel evidence.
  "आई विल verification pending hai.",
]) test(`canonical aliases do not imply independent control: ${transcriptText}`, () => {
  assert.notEqual(classifier.classify({ transcriptText }).label, "VERIFIED_INDEPENDENTLY");
});

test("leading rejection retains existing refusal, compliance, stalling and dummy precedence", () => {
  assert.equal(classifier.classify({ transcriptText: "Nahi, main details share nahi karunga." }).label, "REFUSED");
  assert.equal(classifier.classify({ transcriptText: "Main kuch nahi bataunga." }).label, "UNKNOWN"); // Existing unsupported refusal wording.
  assert.equal(classifier.classify({ transcriptText: "No, I won't share anything." }).label, "REFUSED");
  assert.equal(classifier.classify({ transcriptText: "Main aapki instructions follow karunga." }).label, "COMPLIED");
  assert.equal(classifier.classify({ transcriptText: "Nahi, mujhe sochne do." }).label, "STALLED");
  const result = classifier.classify({ transcriptText: "Nahi, main independently verify karunga, DUMMY-4821.", dummySecretDisclosureObserved: true });
  assert.equal(result.label, "DISCLOSED_DUMMY_SECRET");
  assert.deepEqual(result.evidenceRuleIds, ["behavior.synthetic_dummy_secret_match"]);
});

test("scope normalization retains action negatives, exact dummy spelling and script marks", () => {
  assert.deepEqual(normalizeBehaviorClauses("नहीं, आई विल इंडिपेंडेंटली वेरिफाय।"), [["rejection", "self", "future", "independent", "verify"]]);
  assert.deepEqual(normalizeBehaviorClauses("Nahi, main independently verify, nahi karunga."), [["rejection", "self", "independent", "verify", "negation", "intend"]]);
  assert.deepEqual(normalizeBehaviorClauses("DUMMY-4821; mat मैं स्वतः चेक करूंगा।"), [["DUMMY-4821"], ["negation", "self", "independent", "check", "intend"]]);
});
