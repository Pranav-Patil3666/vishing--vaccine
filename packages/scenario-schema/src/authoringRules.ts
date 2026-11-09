export type AuthoringSeverity = "ERROR" | "WARNING" | "INFO";
export type AuthoringCategory = "INPUT" | "SCHEMA" | "IDENTITY" | "PROVENANCE" | "SAFETY" | "TACTIC"
  | "PRESSURE" | "RESPONSE" | "GRAPH" | "LANGUAGE" | "BEHAVIOR" | "RED_FLAG" | "GUIDANCE" | "DEBRIEF";

function rule(category: AuthoringCategory, severity: AuthoringSeverity, message: string, remediation: string) {
  return { category, severity, message, remediation };
}

export const authoringRules = {
  INPUT_INVALID: rule("INPUT", "ERROR", "Input is not bounded UTF-8 JSON data.", "Use a local JSON file under 160 KiB with supported depth and array bounds."),
  INPUT_UNSAFE_KEY: rule("INPUT", "ERROR", "Input contains a forbidden object key or non-data property.", "Remove prototype-related keys, accessors and executable values."),
  VALIDATOR_FAILED: rule("INPUT", "ERROR", "Validation could not complete.", "Resolve the technical input or storage failure and validate again."),
  FINDING_LIMIT: rule("INPUT", "ERROR", "The validation finding limit was reached.", "Correct the reported root problems and validate again."),
  SCHEMA_INVALID: rule("SCHEMA", "ERROR", "A required field is absent, unsupported or has an invalid type.", "Use the current candidate contract and recognized fields."),
  SCHEMA_VERSION: rule("SCHEMA", "ERROR", "The candidate schema version is unsupported.", "Use candidate schemaVersion 1."),
  CANDIDATE_CONTRACT: rule("SCHEMA", "ERROR", "The candidate violates an existing draft contract constraint.", "Correct the indicated field and validate through the existing candidate intake."),
  IDENTITY_INVALID: rule("IDENTITY", "ERROR", "Scenario identity, version or ownership is inconsistent.", "Use a valid candidate scenario ID, version and matching package/artifact identities."),
  LIFECYCLE_FORGED: rule("PROVENANCE", "ERROR", "Draft metadata claims review, approval or runtime privileges.", "Keep DRAFT status, pending review, empty reviewer metadata and unchecked checklist."),
  PROVENANCE_INVALID: rule("PROVENANCE", "ERROR", "Saved source, template or import provenance is invalid.", "Retain the verified local ingestion source and unverified imported origin."),
  ORIGIN_UNVERIFIED: rule("PROVENANCE", "WARNING", "Imported model or provider origin is an unverified declaration.", "Have a reviewer inspect the origin evidence without treating it as a provider invocation."),
  RECORD_REQUIRED: rule("PROVENANCE", "WARNING", "This candidate has no verified saved-record context.", "Save through the local authoring workflow before requesting review eligibility."),
  HASH_MISMATCH: rule("PROVENANCE", "ERROR", "Saved candidate content does not match its recorded hash or identity.", "Create a new draft revision through authoring and run fresh validation."),
  LINEAGE_INVALID: rule("PROVENANCE", "ERROR", "The saved revision lineage is missing, cyclic or inconsistent.", "Load the predecessor records and verify identity, hashes and different draft versions."),
  FICTIONAL_ATTESTATION: rule("SAFETY", "ERROR", "The organization lacks the supported fictional training attestation.", "Use a clearly fictional organization with training_only and simulation framing."),
  ENTITY_REVIEW: rule("SAFETY", "WARNING", "The configured reference list cannot establish that this organization is fictional.", "Have a human confirm the fictional organization and any staff identity."),
  REFERENCE_CONFIG: rule("SAFETY", "ERROR", "Required local safety reference configuration is unavailable or invalid.", "Load the bounded organization and forbidden-phrase reference lists."),
  REAL_BRAND: rule("SAFETY", "ERROR", "Text contains a configured real-organization identity.", "Replace the real identity with an attested fictional training entity."),
  DISCLOSURE_MISSING: rule("SAFETY", "ERROR", "The caller opening lacks an explicit supported simulation disclosure.", "Include a clear simulation cue in the caller-facing opening."),
  SENSITIVE_VALUE: rule("SAFETY", "ERROR", "Text contains a credential-like value or unsupported dummy-secret format.", "Remove the sensitive value and use only a standalone DUMMY-four-digit example where appropriate."),
  CONTACT_DATA: rule("SAFETY", "ERROR", "Text contains a contact, payment or long identifier pattern.", "Remove phone, email, URL, payment and real-looking identifier values."),
  SENSITIVE_AMBIGUOUS: rule("SAFETY", "WARNING", "Text contains an ambiguous numeric identifier pattern.", "Confirm the number is harmless fictional context or replace it with a descriptive label."),
  OPERATIONAL_INSTRUCTION: rule("SAFETY", "ERROR", "Text includes an affirmative credential, payment, remote-access or security-bypass instruction.", "Use bounded educational explanation and safe learner actions."),
  CONTENT_REVIEW: rule("SAFETY", "INFO", "Human safety and linguistic review is required after automated validation.", "Review fictional framing, educational purpose and language before any later approval."),
  SAFETY_CONTEXT_REVIEW: rule("SAFETY", "WARNING", "The existing intake matcher found text requiring contextual review.", "Review educational negation and wording against the configured intake rules."),
  CALLER_LENGTH: rule("RESPONSE", "ERROR", "A caller line is empty or exceeds the supported voice length.", "Use one complete caller line of at most 280 characters."),
  CALLER_FORMAT: rule("RESPONSE", "WARNING", "Caller text contains markup, control characters, excessive paragraphs or an unfinished ending.", "Use complete, readable plain speech suited to voice delivery."),
  RESPONSE_ID: rule("RESPONSE", "ERROR", "A response ID is duplicated, invalid or assigned to incompatible roles.", "Use unique local IDs for opening, tactic and terminal roles."),
  RESPONSE_MISSING: rule("RESPONSE", "ERROR", "A required response is missing or a response reference is unresolved.", "Provide every opening, continuation, ending and fallback reference."),
  RESPONSE_METADATA: rule("RESPONSE", "ERROR", "Response text or language disagrees between canonical and candidate records.", "Make package references and text match the canonical draft scenario."),
  TACTIC_COVERAGE: rule("TACTIC", "ERROR", "The full-template tactic/intensity coverage is incomplete or duplicated.", "Provide each canonical tactic once at low, medium and high intensity."),
  TACTIC_METADATA: rule("TACTIC", "ERROR", "Tactic category, response or educational metadata disagrees.", "Match tactic, pool, variant, response and red-flag metadata."),
  TACTIC_SIMILAR: rule("TACTIC", "WARNING", "Caller variants differ only superficially.", "Have a reviewer author meaningfully distinct examples of the tactic."),
  TOPIC_REVIEW: rule("TACTIC", "WARNING", "Caller text may not match the declared fictional context or topic.", "Review the wording against the organization, premise and learning objective."),
  PRESSURE_RANGE: rule("PRESSURE", "ERROR", "Authored pressure is outside the declared scenario range.", "Keep authored values within 0–5 and at or below this draft's ceiling."),
  PRESSURE_METADATA: rule("PRESSURE", "ERROR", "Variant, tactic pool or branch pressure metadata disagrees.", "Align pressure references with the scenario's authored configuration."),
  PRESSURE_TRANSITION: rule("PRESSURE", "ERROR", "A branch references an unsupported pressure transition.", "Use an authored response under this scenario's ceiling within the turn bound."),
  GRAPH_ID: rule("GRAPH", "ERROR", "A decision/node ID is duplicated or inconsistent.", "Use one unique decision for each declared active node."),
  GRAPH_TARGET: rule("GRAPH", "ERROR", "A branch or node points to a missing or incompatible target.", "Reference an existing next decision and its canonical response."),
  GRAPH_TURN: rule("GRAPH", "ERROR", "Decision turn indices or the maximum-turn configuration disagree.", "Number decisions in bounded order and terminate at the declared maximum."),
  GRAPH_TERMINAL: rule("GRAPH", "ERROR", "A terminal decision permits active continuation or has the wrong outcome.", "Preserve terminal precedence and stop after the ending."),
  GRAPH_CYCLE: rule("GRAPH", "ERROR", "The decision graph cycles or continues beyond the turn cap.", "Remove cycles and ensure every reachable path terminates."),
  GRAPH_UNREACHABLE: rule("GRAPH", "ERROR", "A mandatory decision or natural terminal outcome is unreachable.", "Connect required decisions and endings within the declared bound."),
  ENDING_UNSAFE: rule("GRAPH", "ERROR", "Terminal content introduces a new request or pressure instead of stopping.", "Use a safe stopping response with appropriate verification guidance."),
  ENDING_AMBIGUOUS: rule("GRAPH", "WARNING", "Terminal text does not clearly establish a stopping boundary.", "Have a human review the ending and make the stop explicit."),
  BEHAVIOR_COVERAGE: rule("BEHAVIOR", "ERROR", "Behavior examples have duplicate IDs or incomplete canonical coverage.", "Provide three distinct examples for each full-template behavior and matching metadata."),
  BEHAVIOR_MAPPING: rule("BEHAVIOR", "ERROR", "The example or branch decision contradicts its behavior label.", "Use the canonical verification, disclosure, fallback and bounded-continuation outcomes."),
  BEHAVIOR_REVIEW: rule("BEHAVIOR", "WARNING", "Example wording may contradict its intended behavior.", "Have a human inspect the intended label and meaning without changing the runtime classifier."),
  DUMMY_CONTEXT: rule("BEHAVIOR", "WARNING", "Dummy-disclosure examples lack a clearly established synthetic-token or unsolicited-disclosure context.", "Document the synthetic exercise or the educational meaning of unsolicited disclosure."),
  LANGUAGE_INVALID: rule("LANGUAGE", "ERROR", "Language or script declarations are invalid or inconsistent.", "Use the existing supported candidate language and script metadata."),
  SCRIPT_REVIEW: rule("LANGUAGE", "WARNING", "Declared script content is missing or the text may have encoding damage.", "Review the primary script while retaining legitimate Hindi/Hinglish code-mixing."),
  RED_FLAG_REFERENCE: rule("RED_FLAG", "ERROR", "Red-flag IDs, descriptions or tactic references are inconsistent.", "Use unique canonical flags with existing tactic and debrief references."),
  GUIDANCE_MISSING: rule("GUIDANCE", "ERROR", "Safe actions lack an independent verification or stopping option.", "Explain how to verify through a familiar channel and end the simulation."),
  GUIDANCE_UNSAFE: rule("GUIDANCE", "ERROR", "Recommended actions use caller-supplied proof or encourage an unsafe action.", "Recommend independently known channels and refusal to disclose sensitive values."),
  DEBRIEF_COVERAGE: rule("DEBRIEF", "ERROR", "A required outcome explanation or debrief reference is missing.", "Cover verification, refusal, stalling, disclosure, fallback and the turn cap."),
  COMPLIANCE_REVIEW: rule("DEBRIEF", "WARNING", "Compliance lacks an explicit outcome-neutral educational explanation.", "Have a reviewer confirm how non-disclosure compliance is explained."),
  DEBRIEF_INFERENCE: rule("DEBRIEF", "ERROR", "Debrief or scoring asserts an unobserved emotion, trait or psychological measure.", "Describe only structured observed behavior and measured timing."),
  DEBRIEF_FABRICATION: rule("DEBRIEF", "ERROR", "Debrief claims real follow-through or disclosure beyond the recorded behavior.", "Describe a verification statement or synthetic disclosure within the evidence limits."),
  SCORING_UNOBSERVED: rule("DEBRIEF", "ERROR", "Scoring guidance awards credit without an observable condition.", "Require a matching committed observation before awarding action-specific points."),
} as const;
export type AuthoringRuleId = keyof typeof authoringRules;
export interface AuthoringFinding {
  ruleId: AuthoringRuleId;
  severity: AuthoringSeverity;
  category: AuthoringCategory;
  path: string;
  message: string;
  remediation: string;
}
export type AddAuthoringFinding = (ruleId: AuthoringRuleId, path: (string | number)[]) => void;
