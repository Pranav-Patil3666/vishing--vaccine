import type { BehaviorClassification, BehaviorLabel } from "@vaccine/contracts";

export interface BehaviorClassifierInput {
  transcriptText: string;
  /** Set only when a test-only synthetic dummy-secret matcher observed a match. */
  dummySecretDisclosureObserved?: boolean;
}

export interface BehaviorClassifier {
  classify(input: BehaviorClassifierInput): BehaviorClassification;
}

const patterns: ReadonlyArray<{ label: BehaviorLabel; id: string; pattern: RegExp }> = [
  { label: "VERIFIED_INDEPENDENTLY", id: "behavior.verify_independent", pattern: /\b(?:verify independently|independently verify|known official channel|call back using|contact through an official channel)\b/i },
  { label: "REFUSED", id: "behavior.refusal", pattern: /\b(?:i refuse|i will not|i won't|not sharing|do not share|i am ending the call|i'm ending the call)\b/i },
  { label: "COMPLIED", id: "behavior.explicit_agreement", pattern: /\b(?:i agree to|i will share|i'll share|i will install|i'll install|i will read out)\b/i },
  { label: "STALLED", id: "behavior.explicit_delay", pattern: /\b(?:i need more time|wait a moment|i'm not sure|i am not sure|let me think)\b/i },
];

/** Deterministic, observable text cues only; this classifier has no emotion or confidence output. */
export class DeterministicBehaviorClassifier implements BehaviorClassifier {
  classify(input: BehaviorClassifierInput): BehaviorClassification {
    if (input.dummySecretDisclosureObserved) {
      return { label: "DISCLOSED_DUMMY_SECRET", evidenceRuleIds: ["behavior.synthetic_dummy_secret_match"], source: "deterministic_rules" };
    }
    const text = input.transcriptText.normalize("NFKC");
    for (const rule of patterns) {
      if (rule.pattern.test(text)) return { label: rule.label, evidenceRuleIds: [rule.id], source: "deterministic_rules" };
    }
    return { label: "UNKNOWN", evidenceRuleIds: [], source: "unknown" };
  }
}
