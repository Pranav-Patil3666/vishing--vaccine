# Evon authoring boundary

Evon remains offline authoring only. The live learner path never calls Evon. A mock may create draft placeholders, and generated files may be imported without a hosted authoring service. Potential later targets are an authorized hosted/contest route, rented GPU, or experimental local GPU; no target is assumed available and no 8 GB RTX 4060 unquantized-runtime claim is made.

`DraftScenarioPackage` contains a draft scenario, candidate behavior examples, importable scenario JSON artifacts, authoring target, and pending/rejected review. It is always `runtimeEligible: false`. `ApprovedScenarioPackage` requires an approved scenario, human reviewer and timestamp, every safety checklist item, and artifacts matching the reviewed scenario ID/version. Only this package can mark runtime eligibility true.

`BehaviorTrainingExample` records a scrubbed utterance, one behavior label, synthetic or consented-redacted source, and a train/validation/held-out split. Examples are authoring/evaluation data, not runtime inference. No learner audio or actual credentials belong in a package.

Approval remains human and separate from generation. The review checks fictional identity, synthetic-only data, no security-bypass instruction, safe ending, visible simulation label, AI-voice disclosure, consent before recording, and no audio retention by default. Import does not imply approval.
