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
  { label: "VERIFIED_INDEPENDENTLY", id: "behavior.verify_independent", pattern: /\b(?:verify independently|independently verify|known official channel|call back using|contact through an official channel|verify through (?:the )?official channel)\b|(?:आधिकारिक माध्यम से|खुद सत्यापन|पहले से ज्ञात नंबर)|(?:official channel se.*verify|known number par.*call back)/iu },
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
    const independentlyVerifies = /\b(?:verify independently|independently verify|known official channel|call back using|official channel)\b|(?:आधिकारिक माध्यम से|खुद सत्यापन)|(?:official channel se.*verify)/iu.test(text);
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
