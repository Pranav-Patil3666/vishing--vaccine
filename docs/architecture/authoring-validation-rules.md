# Automated authoring validation rules

Validator version 1.0.0. Errors block review eligibility. Warnings require human attention. Info records review guidance. PASS and WARN retain DRAFT lifecycle. The central review gate recomputes validation and binds it to the exact candidate hash, validator version and configured safety-policy hash.

Paths are JSON pointers rooted at the input record. Saved candidate fields appear under /candidate. Unrecognized response-map keys are redacted to *. Messages and remediation use static text. Maximum output is 80 findings plus a blocking truncation finding.

The current candidate schema represents the full 15-variant profile. Coverage checks apply to that contract. The scenario-wide schema remains the authority for other existing scenario documents.

| Rule | Category | Severity | Condition and correction |
| --- | --- | --- | --- |
| INPUT_INVALID | INPUT | ERROR | Input is not bounded UTF-8 JSON data. Use a local JSON file under 160 KiB with supported depth and array bounds. |
| INPUT_UNSAFE_KEY | INPUT | ERROR | Input contains a forbidden object key or non-data property. Remove prototype-related keys, accessors and executable values. |
| VALIDATOR_FAILED | INPUT | ERROR | Validation could not complete. Resolve the technical input or storage failure and validate again. |
| FINDING_LIMIT | INPUT | ERROR | The validation finding limit was reached. Correct the reported root problems and validate again. |
| SCHEMA_INVALID | SCHEMA | ERROR | A required field is absent, unsupported or has an invalid type. Use the current candidate contract and recognized fields. |
| SCHEMA_VERSION | SCHEMA | ERROR | The candidate schema version is unsupported. Use candidate schemaVersion 1. |
| CANDIDATE_CONTRACT | SCHEMA | ERROR | The candidate violates an existing draft contract constraint. Correct the indicated field and validate through the existing candidate intake. |
| IDENTITY_INVALID | IDENTITY | ERROR | Scenario identity, version or ownership is inconsistent. Use a valid candidate scenario ID, version and matching package/artifact identities. |
| LIFECYCLE_FORGED | PROVENANCE | ERROR | Draft metadata claims review, approval or runtime privileges. Keep DRAFT status, pending review, empty reviewer metadata and unchecked checklist. |
| PROVENANCE_INVALID | PROVENANCE | ERROR | Saved source, template or import provenance is invalid. Retain the verified local ingestion source and unverified imported origin. |
| ORIGIN_UNVERIFIED | PROVENANCE | WARNING | Imported model or provider origin is an unverified declaration. Have a reviewer inspect the origin evidence without treating it as a provider invocation. |
| RECORD_REQUIRED | PROVENANCE | WARNING | This candidate has no verified saved-record context. Save through the local authoring workflow before requesting review eligibility. |
| HASH_MISMATCH | PROVENANCE | ERROR | Saved candidate content does not match its recorded hash or identity. Create a new draft revision through authoring and run fresh validation. |
| LINEAGE_INVALID | PROVENANCE | ERROR | The saved revision lineage is missing, cyclic or inconsistent. Load the predecessor records and verify identity, hashes and different draft versions. |
| FICTIONAL_ATTESTATION | SAFETY | ERROR | The organization lacks the supported fictional training attestation. Use a clearly fictional organization with training_only and simulation framing. |
| ENTITY_REVIEW | SAFETY | WARNING | The configured reference list cannot establish that this organization is fictional. Have a human confirm the fictional organization and any staff identity. |
| REFERENCE_CONFIG | SAFETY | ERROR | Required local safety reference configuration is unavailable or invalid. Load the bounded organization and forbidden-phrase reference lists. |
| REAL_BRAND | SAFETY | ERROR | Text contains a configured real-organization identity. Replace the real identity with an attested fictional training entity. |
| DISCLOSURE_MISSING | SAFETY | ERROR | The caller opening lacks an explicit supported simulation disclosure. Include a clear simulation cue in the caller-facing opening. |
| SENSITIVE_VALUE | SAFETY | ERROR | Text contains a credential-like value or unsupported dummy-secret format. Remove the sensitive value and use only a standalone DUMMY-four-digit example where appropriate. |
| CONTACT_DATA | SAFETY | ERROR | Text contains a contact, payment or long identifier pattern. Remove phone, email, URL, payment and real-looking identifier values. |
| SENSITIVE_AMBIGUOUS | SAFETY | WARNING | Text contains an ambiguous numeric identifier pattern. Confirm the number is harmless fictional context or replace it with a descriptive label. |
| OPERATIONAL_INSTRUCTION | SAFETY | ERROR | Text includes an affirmative credential, payment, remote-access or security-bypass instruction. Use bounded educational explanation and safe learner actions. |
| CONTENT_REVIEW | SAFETY | INFO | Human safety and linguistic review is required after automated validation. Review fictional framing, educational purpose and language before any later approval. |
| SAFETY_CONTEXT_REVIEW | SAFETY | WARNING | The existing intake matcher found text requiring contextual review. Review educational negation and wording against the configured intake rules. |
| CALLER_LENGTH | RESPONSE | ERROR | A caller line is empty or exceeds the supported voice length. Use one complete caller line of at most 280 characters. |
| CALLER_FORMAT | RESPONSE | WARNING | Caller text contains markup, control characters, excessive paragraphs or an unfinished ending. Use complete, readable plain speech suited to voice delivery. |
| RESPONSE_ID | RESPONSE | ERROR | A response ID is duplicated, invalid or assigned to incompatible roles. Use unique local IDs for opening, tactic and terminal roles. |
| RESPONSE_MISSING | RESPONSE | ERROR | A required response is missing or a response reference is unresolved. Provide every opening, continuation, ending and fallback reference. |
| RESPONSE_METADATA | RESPONSE | ERROR | Response text or language disagrees between canonical and candidate records. Make package references and text match the canonical draft scenario. |
| TACTIC_COVERAGE | TACTIC | ERROR | The full-template tactic/intensity coverage is incomplete or duplicated. Provide each canonical tactic once at low, medium and high intensity. |
| TACTIC_METADATA | TACTIC | ERROR | Tactic category, response or educational metadata disagrees. Match tactic, pool, variant, response and red-flag metadata. |
| TACTIC_SIMILAR | TACTIC | WARNING | Caller variants differ only superficially. Have a reviewer author meaningfully distinct examples of the tactic. |
| TOPIC_REVIEW | TACTIC | WARNING | Caller text may not match the declared fictional context or topic. Review the wording against the organization, premise and learning objective. |
| PRESSURE_RANGE | PRESSURE | ERROR | Authored pressure is outside the declared scenario range. Keep authored values within 0–5 and at or below this draft's ceiling. |
| PRESSURE_METADATA | PRESSURE | ERROR | Variant, tactic pool or branch pressure metadata disagrees. Align pressure references with the scenario's authored configuration. |
| PRESSURE_TRANSITION | PRESSURE | ERROR | A branch references an unsupported pressure transition. Use an authored response under this scenario's ceiling within the turn bound. |
| GRAPH_ID | GRAPH | ERROR | A decision/node ID is duplicated or inconsistent. Use one unique decision for each declared active node. |
| GRAPH_TARGET | GRAPH | ERROR | A branch or node points to a missing or incompatible target. Reference an existing next decision and its canonical response. |
| GRAPH_TURN | GRAPH | ERROR | Decision turn indices or the maximum-turn configuration disagree. Number decisions in bounded order and terminate at the declared maximum. |
| GRAPH_TERMINAL | GRAPH | ERROR | A terminal decision permits active continuation or has the wrong outcome. Preserve terminal precedence and stop after the ending. |
| GRAPH_CYCLE | GRAPH | ERROR | The decision graph cycles or continues beyond the turn cap. Remove cycles and ensure every reachable path terminates. |
| GRAPH_UNREACHABLE | GRAPH | ERROR | A mandatory decision or natural terminal outcome is unreachable. Connect required decisions and endings within the declared bound. |
| ENDING_UNSAFE | GRAPH | ERROR | Terminal content introduces a new request or pressure instead of stopping. Use a safe stopping response with appropriate verification guidance. |
| ENDING_AMBIGUOUS | GRAPH | WARNING | Terminal text does not clearly establish a stopping boundary. Have a human review the ending and make the stop explicit. |
| BEHAVIOR_COVERAGE | BEHAVIOR | ERROR | Behavior examples have duplicate IDs or incomplete canonical coverage. Provide three distinct examples for each full-template behavior and matching metadata. |
| BEHAVIOR_MAPPING | BEHAVIOR | ERROR | The example or branch decision contradicts its behavior label. Use the canonical verification, disclosure, fallback and bounded-continuation outcomes. |
| BEHAVIOR_REVIEW | BEHAVIOR | WARNING | Example wording may contradict its intended behavior. Have a human inspect the intended label and meaning without changing the runtime classifier. |
| DUMMY_CONTEXT | BEHAVIOR | WARNING | Dummy-disclosure examples lack a clearly established synthetic-token or unsolicited-disclosure context. Document the synthetic exercise or the educational meaning of unsolicited disclosure. |
| LANGUAGE_INVALID | LANGUAGE | ERROR | Language or script declarations are invalid or inconsistent. Use the existing supported candidate language and script metadata. |
| SCRIPT_REVIEW | LANGUAGE | WARNING | Declared script content is missing or the text may have encoding damage. Review the primary script while retaining legitimate Hindi/Hinglish code-mixing. |
| RED_FLAG_REFERENCE | RED_FLAG | ERROR | Red-flag IDs, descriptions or tactic references are inconsistent. Use unique canonical flags with existing tactic and debrief references. |
| GUIDANCE_MISSING | GUIDANCE | ERROR | Safe actions lack an independent verification or stopping option. Explain how to verify through a familiar channel and end the simulation. |
| GUIDANCE_UNSAFE | GUIDANCE | ERROR | Recommended actions use caller-supplied proof or encourage an unsafe action. Recommend independently known channels and refusal to disclose sensitive values. |
| DEBRIEF_COVERAGE | DEBRIEF | ERROR | A required outcome explanation or debrief reference is missing. Cover verification, refusal, stalling, disclosure, fallback and the turn cap. |
| COMPLIANCE_REVIEW | DEBRIEF | WARNING | Compliance lacks an explicit outcome-neutral educational explanation. Have a reviewer confirm how non-disclosure compliance is explained. |
| DEBRIEF_INFERENCE | DEBRIEF | ERROR | Debrief or scoring asserts an unobserved emotion, trait or psychological measure. Describe only structured observed behavior and measured timing. |
| DEBRIEF_FABRICATION | DEBRIEF | ERROR | Debrief claims real follow-through or disclosure beyond the recorded behavior. Describe a verification statement or synthetic disclosure within the evidence limits. |
| SCORING_UNOBSERVED | DEBRIEF | ERROR | Scoring guidance awards credit without an observable condition. Require a matching committed observation before awarding action-specific points. |
