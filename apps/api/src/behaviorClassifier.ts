import type { BehaviorClassification, BehaviorLabel, TacticCategory } from "@vaccine/contracts";

export interface BehaviorClassifierInput {
  transcriptText: string;
  /** Set only after a configured synthetic-only detector confirms a fixture token. */
  dummySecretDisclosureObserved?: boolean;
  activeTactic?: { tacticId: string | null; category: TacticCategory | null };
  scenario?: { red_flag_ids: readonly string[] };
  relevantRedFlagIds?: readonly string[];
}

export interface BehaviorClassifier {
  classify(input: BehaviorClassifierInput): BehaviorClassification;
}

const behaviorPatterns: ReadonlyArray<{ label: BehaviorLabel; id: string; pattern: RegExp }> = [
  { label: "REFUSED", id: "behavior.refusal", pattern: /\b(?:i refuse|i will not|i won't|not sharing|do not share|i am ending the call|i'm ending the call)\b|(?:नहीं साझा करूंगा|नहीं बताऊंगा|मैं मना करता हूं)|(?:share nahi karunga|details nahi dunga|main nahi bataunga)/iu },
  { label: "COMPLIED", id: "behavior.explicit_agreement", pattern: /\b(?:i agree to|i will share|i'll share|i will install|i'll install|i will read out)\b|(?:मैं सहमत हूं|मैं पालन करूंगा|मैं बता दूंगा)|(?:main agree karta hoon|main share karunga|instructions follow karunga)/iu },
  { label: "STALLED", id: "behavior.explicit_delay", pattern: /\b(?:i need more time|wait a moment|i'm not sure|i am not sure|let me think)\b|(?:थोड़ा समय चाहिए|सोचने के लिए समय)|(?:thoda time chahiye|mujhe sochne do|abhi sure nahi)/iu },
];

const redFlagsForVerification = new Set(["RF-01", "RF-02", "RF-07", "RF-08"]);

/** Deterministic, replaceable rules. Context narrows observable safety evidence; no emotion fields or scores are inferred. */
export class LearnerBehaviorClassifier implements BehaviorClassifier {
  classify(input: BehaviorClassifierInput): BehaviorClassification {
    const text = normalizeTranscript(input.transcriptText);
    const contextFlags = new Set([
      ...(input.scenario?.red_flag_ids ?? []),
      ...(input.relevantRedFlagIds ?? []),
    ]);
    const context: BehaviorClassification["context"] = {
      activeTacticId: input.activeTactic?.tacticId ?? null,
      activeTacticCategory: input.activeTactic?.category ?? null,
      relevantRedFlagIds: [...contextFlags].sort(),
    };
    const signals: BehaviorClassification["safetySignals"] = [];
    const verificationEvidence = independentVerificationEvidence(text);
    const independentlyVerifies = verificationEvidence !== null;
    if (independentlyVerifies && (contextFlags.size === 0 || [...contextFlags].some((flag) => redFlagsForVerification.has(flag)))) {
      signals.push("CHALLENGED_URGENCY_OR_VERIFIED");
    }
    if (/(?:won't|will not|refuse|not going to).{0,60}(?:remote access|screen control|remote app)|(?:remote access|screen control).{0,60}(?:refuse|won't|will not)|(?:remote access nahi|install nahi karunga)/iu.test(text)) {
      signals.push("REFUSED_REMOTE_ACCESS");
    }
    if (/(?:won't|will not|refuse|not going to).{0,60}(?:payment credential|payment details|otp|pin|password|code)|(?:otp|pin|password|payment details).{0,40}(?:share nahi|nahi dunga|nahi bataunga)/iu.test(text)) {
      signals.push("REFUSED_PAYMENT_CREDENTIAL");
    }
    if (/(?:end the call|hang up|terminate).{0,80}(?:official|report|escalate|support)|(?:official|report|escalate|support).{0,80}(?:end the call|hang up|terminate)|(?:कॉल समाप्त|call end).{0,80}(?:आधिकारिक|support)/iu.test(text)) {
      signals.push("TERMINATED_OR_ESCALATED_SAFELY");
    }

    if (input.dummySecretDisclosureObserved) {
      return { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules", context, safetySignals: signals };
    }
    if (verificationEvidence) {
      return { label: "VERIFIED_INDEPENDENTLY", evidenceRuleIds: ["behavior.verify_independent", ...verificationEvidence], source: "deterministic_rules", context, safetySignals: signals };
    }
    for (const rule of behaviorPatterns) {
      if (rule.pattern.test(text)) {
        return { label: rule.label, evidenceRuleIds: [rule.id], source: "deterministic_rules", context, safetySignals: signals };
      }
    }
    return { label: "UNKNOWN", evidenceRuleIds: [], source: "unknown", context, safetySignals: signals };
  }
}

/** Backwards-compatible name retained for callers from the preceding amendment. */
export class DeterministicBehaviorClassifier extends LearnerBehaviorClassifier {}

export function normalizeTranscript(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

// Internal bounded vocabulary, not translation or a replacement for the provider transcript.
const verificationAliases: Readonly<Record<string, readonly string[]>> = {
  independent: ["independently", "independent", "khud", "खुद", "ख़ुद", "स्वयं", "स्वतः", "स्वतंत्र", "इंडिपेंडेंटली", "इन्डिपेंडेंटली", "इन्डिपेन्डेन्टली"],
  verify: ["verify", "verifying", "validate", "वेरिफाई", "वेरिफाय", "वेरीफाई", "वेरिफ़ाई"],
  verification: ["verification", "सत्यापन"],
  check: ["check", "checking", "confirm", "confirming", "चेक", "कन्फर्म", "जांच", "जाँच", "पुष्टि", "dekhunga", "देखूंगा", "देखूँगा"],
  official: ["official", "आधिकारिक", "ऑफिशियल"],
  known: ["known", "know", "ज्ञात"],
  channel: ["channel", "माध्यम", "चैनल"],
  app: ["app", "ऐप", "एप"], website: ["website", "वेबसाइट"],
  number: ["number", "नंबर", "नम्बर"], contact: ["contact", "संपर्क"],
  call: ["call", "calling", "कॉल", "फोन"],
  self: ["i", "main", "mein", "mai", "मैं", "आई"],
  future: ["will", "विल"],
  intend: ["i'll", "karunga", "karungi", "karoonga", "करूंगा", "करूँगा", "करूंगी", "करूँगी"],
  own: ["own", "my", "apne", "अपने"], first: ["first", "pehle", "पहले"],
  negation: ["not", "नॉट", "no", "nope", "never", "don't", "won't", "cannot", "can't", "refuse", "refused", "refusing", "nahi", "nahin", "mana", "mat", "नहीं", "नही", "मत", "मना"],
  question: ["should", "whether", "kya", "क्या", "kaise", "कैसे"],
  caller: ["caller", "caller's", "कॉलर"],
  directed: ["your", "aapke", "aapki", "आपके", "आपकी"],
  instruction: ["instructions", "instruction", "kehne", "कहने", "निर्देश"],
  with: ["with", "saath", "साथ"], provided: ["provided", "given", "supplied", "diye", "दिए", "दिये"],
  secret: ["token", "code", "otp", "pin", "password", "secret", "टोकन", "कोड", "ओटीपी", "पिन"],
  handover: ["share", "sharing", "give", "giving", "tell", "dekar", "देकर", "bataunga", "बताऊंगा"],
};
const verificationTokens = new Map(Object.entries(verificationAliases).flatMap(([concept, aliases]) =>
  aliases.map((alias) => [alias.normalize("NFKC").toLowerCase(), concept] as const)));
// Only a standalone rejection before a new, explicit first-person clause can change role.
// Action negatives (not/never/refuse/mat, or any later nahi) always retain negation.
const leadingRejectionAliases = new Set(["no", "nope", "nahi", "nahin", "नहीं", "नही", "mana", "मना"]);

function canonicalizeBehaviorClause(clause: string): string[] {
  const surface = (clause.match(/[\p{L}\p{M}\p{N}]+(?:[-'][\p{L}\p{M}\p{N}]+)*/gu) ?? []);
  const tokens = surface.map((token) => /^DUMMY-\d{4}$/u.test(token) ? token : verificationTokens.get(token.toLowerCase()) ?? token.toLowerCase());
  // Commas are otherwise retained in the action scope: "verify, nahi karunga" stays negative.
  // STT may omit the comma after a leading rejection; explicit learner restart is required.
  if (leadingRejectionAliases.has(surface[0]?.toLowerCase() ?? "") && tokens[1] === "self") tokens[0] = "rejection";
  return tokens;
}

/** Classifier-only tokens: preserve Devanagari marks, whole words, negation and dummy-token spelling. */
export function normalizeBehaviorClauses(text: string): string[][] {
  return normalizeTranscript(text).replace(/[’‘]/gu, "'")
    .split(/[.!?;।]+|(?<![\p{L}\p{M}\p{N}])(?:but|lekin|लेकिन)(?![\p{L}\p{M}\p{N}])/iu)
    .map(canonicalizeBehaviorClause)
    .filter((tokens) => tokens.length > 0);
}

function nearby(tokens: readonly string[], left: readonly string[], right: readonly string[]): boolean {
  return tokens.some((token, index) => left.includes(token) && tokens.slice(index + 1, index + 5).some((next) => right.includes(next)));
}

function independentVerificationEvidence(text: string): string[] | null {
  const channels = ["channel", "app", "website", "number", "contact"];
  for (const tokens of normalizeBehaviorClauses(text)) {
    // Negation in the action scope still vetoes verification; a leading rejection has its own role.
    if (tokens.includes("negation") || tokens.includes("question")) continue;
    if (nearby(tokens, ["directed"], ["instruction", "with", ...channels]) || nearby(tokens, ["instruction"], ["directed"])
      || nearby(tokens, ["caller"], ["with", "provided"]) || nearby(tokens, ["with", "provided"], ["caller"])
      || nearby(tokens, ["secret"], ["handover"]) || nearby(tokens, ["handover"], ["secret"])) continue;
    const learner = tokens.includes("self") || tokens.includes("intend");
    const channel = nearby(tokens, ["official", "known"], channels) || nearby(tokens, channels, ["known"]);
    const independent = tokens.includes("independent") || nearby(tokens, ["own"], ["aap", "आप", "own"])
      || (learner && tokens.includes("first"));
    const action = tokens.includes("verify") || tokens.includes("check")
      || (tokens.includes("verification") && (tokens.includes("intend") || (tokens.includes("self") && tokens.includes("future"))))
      || (channel && tokens.includes("call"));
    if (learner && action && (independent || channel)) {
      return ["behavior.concept.learner_action", "behavior.concept.verify_action",
        ...(independent ? ["behavior.concept.independent_action"] : []), ...(channel ? ["behavior.concept.official_or_known_channel"] : []),
        ...(tokens.includes("rejection") ? ["behavior.scope.leading_rejection"] : []), "behavior.scope.action_not_negated"];
    }
  }
  return null;
}
