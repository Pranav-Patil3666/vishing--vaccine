import type { ScenarioSafetyOptions } from "./safety.js";
import type { AddAuthoringFinding } from "./authoringRules.js";

export function authoringText(value: string) {
  return value.normalize("NFKC").replace(/[०-९]/gu, (digit) => String(digit.codePointAt(0)! - 0x966));
}

export const independentCue = /(?:known|familiar|independen|trusted|saved|bookmark|jaana.pehchana|स्वतंत्र|परिचित|जानती हुई|पहले से)/iu;
export const stopCue = /\b(?:end|stop|khatam|rokte|rokna|terminate)\b|खत्म|रोक|समाप्त/iu;
export const simulationCue = /\b(?:this is (?:a |an )?(?:training )?simulation|yeh simulation hai|this is (?:a )?practice|practice call)\b|यह.{0,10}(?:सिमुलेशन|अभ्यास)/iu;

export function affirmativeMatch(value: string, pattern: RegExp) {
  return value.split(/[.;!?।\n]/u).some((clause) => {
    const match = pattern.exec(clause);
    if (!match) return false;
    const prefix = clause.slice(Math.max(0, match.index - 80), match.index);
    return !/(?:do not|don't|never|avoid|refuse to|decline to|cannot|does not|no claim of|mat|nahi)\s+(?:[\p{L}-]+\s+){0,3}$/iu.test(prefix)
      && !/(?:नहीं|मत)\s*$/u.test(prefix);
  });
}

function phrasePattern(phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

export function scanAuthoringText(
  strings: { path: (string | number)[]; text: string }[],
  safety: ScenarioSafetyOptions,
  add: AddAuthoringFinding,
) {
  const brands = safety.knownRealOrganizations.map(phrasePattern);
  const phrases = safety.forbiddenOperationalPhrases.map(phrasePattern);
  const seen = new Set<string>();
  for (const { text: original, path } of strings) {
    // Canonical scenarios and importable artifacts repeat text. Report its first stable location once.
    if (seen.has(original)) continue;
    seen.add(original);
    const text = authoringText(original);
    if (brands.some((pattern) => pattern.test(text))) add("REAL_BRAND", path);
    if (phrases.some((pattern) => affirmativeMatch(text, pattern))) add("OPERATIONAL_INSTRUCTION", path);

    const dummyMatches = [...text.matchAll(/DUMMY-[\p{L}\p{N}_-]*/giu)];
    if (dummyMatches.some((match) => !/^DUMMY-[0-9]{4}$/u.test(match[0])
      || /[\p{L}\p{N}_-]/u.test(text[(match.index ?? 0) - 1] ?? "")
      || /[\p{L}\p{N}_-]/u.test(text[(match.index ?? 0) + match[0].length] ?? ""))) {
      add("SENSITIVE_VALUE", path);
    }
    const masked = text.replace(/(?<![\p{L}\p{N}_-])DUMMY-[0-9]{4}(?![\p{L}\p{N}_-])/gu, "SYNTHETICVALUE")
      .replace(/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/gu, "DATE");
    const hasSecret = /\b(?:otp|pin|cvv|cvc|password|passcode|api[ _-]?key|auth(?:entication)?[ _-]?token|recovery[ _-]?code|secret)\s*(?:(?:is|hai)\s+|[:=#-]\s*)[\p{L}\p{N}+/_=-]{3,}\b/iu.test(masked)
      || /(?:ओटीपी|पासवर्ड|पिन|सीवीवी)\s*[:=#-]?\s*[0-9]{3,}/u.test(masked)
      || /\b(?:sk-[a-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|eyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]+)\b/u.test(masked)
      || /\b[0-9]{6,19}\b/u.test(masked);
    if (hasSecret) add("SENSITIVE_VALUE", path);
    if (/https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b[\w.-]+@(?:upi|ybl|paytm|ok[a-z]+)\b|\b[A-Z]{5}[0-9]{4}[A-Z]\b|(?<![0-9])(?:[0-9][ -]?){9,18}[0-9](?![0-9])/iu.test(masked)) {
      add("CONTACT_DATA", path);
    } else if (/\b[0-9]{5}\b/u.test(masked) && !hasSecret) add("SENSITIVE_AMBIGUOUS", path);

    const operational = /\b(?:send|share|read out|tell me|provide|enter)\b.{0,30}\b(?:your |the |real |actual )?(?:otp|pin|password|cvv|bank details)\b|\b(?:transfer|send)\s+(?:the |your )?(?:money|payment)|\binstall\s+(?:anydesk|teamviewer|remote.access)|\b(?:disable|bypass|evade)\b.{0,30}\b(?:verification|fraud|security|detection)\b|(?:ओटीपी|पासवर्ड|पिन).{0,12}(?:भेजो|बताइए|बताओ)|(?:पैसे|रुपये).{0,12}भेज/iu;
    if (affirmativeMatch(text, operational)) add("OPERATIONAL_INSTRUCTION", path);
  }
}

export function inspectDebriefClaim(text: string, path: (string | number)[], add: AddAuthoringFinding) {
  const normalized = authoringText(text);
  if (affirmativeMatch(normalized,
    /\b(?:stress|honesty|personality|fear|confidence)\s+(?:score|rating)|\b(?:you|the learner|learner)\s+(?:are|were|was|felt|is|became)\s+(?:afraid|stressed|panicked|dishonest|fearful|anxious|overconfident)|आप(?:ने)?\s+(?:डर|घबरा)|learner\s+(?:dara hua|ghabra)/iu)) {
    add("DEBRIEF_INFERENCE", path);
  }
  if (affirmativeMatch(normalized,
    /\b(?:you|the learner|learner)\s+(?:(?:have|has)\s+)?(?:actually verified|completed (?:the )?(?:external )?verification|successfully contacted|confirmed externally)|\b(?:you|the learner|learner)\s+(?:shared|revealed|exposed)\s+(?:a |the |your )?(?:real|actual)\s+(?:password|credential|secret|otp)|आपने.{0,12}(?:वास्तव में सत्यापन|असली पासवर्ड बताया)/iu)) {
    add("DEBRIEF_FABRICATION", path);
  }
}

