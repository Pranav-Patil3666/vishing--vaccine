# Evon authoring boundary

Evon remains offline authoring only. The live learner path never calls Evon. A mock may create draft placeholders, and generated files may be imported without a hosted authoring service. Potential later targets are an authorized hosted/contest route, rented GPU, or experimental local GPU; no target is assumed available and no 8 GB RTX 4060 unquantized-runtime claim is made.

`MockEvonAuthoringAdapter` returns a `DraftScenarioPackage` containing a scenario brief, draft tactic pool, candidate approved-response records, multilingual synthetic behavior examples, debrief template variants, and candidate utterances. Every result is `DRAFT` and runtime-ineligible. A separate explicit safety-review transition and human approval record are required before an approved package can be produced; approval requires reviewer identity, timestamp, checklist evidence, and matching scenario ID/version. Only a subsequent runtime-eligibility transition can enable adaptive runtime behavior.

`BehaviorTrainingExample` records a scrubbed utterance, one behavior label, synthetic or consented-redacted source, and a train/validation/held-out split. Examples are authoring/evaluation data, not runtime inference. No learner audio or actual credentials belong in a package.

Approval remains human and separate from generation. The review checks fictional identity, synthetic-only data, no security-bypass instruction, safe ending, visible simulation label, AI-voice disclosure, consent before recording, and no audio retention by default. Import does not imply approval.
