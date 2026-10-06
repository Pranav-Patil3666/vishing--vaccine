# Behavior classification

Runtime behavior classification is a deterministic, replaceable interface. The current rule implementation produces only one of `REFUSED`, `STALLED`, `VERIFIED_INDEPENDENTLY`, `COMPLIED`, `DISCLOSED_DUMMY_SECRET`, or `UNKNOWN`, plus rule IDs. It has no confidence or emotional-state fields.

Rules use direct observable language. Hesitation, silence, filler words, speech rate, and interruption are logged as separate signals and never become fear, anxiety, intimidation, panic, or other emotion labels. A `DISCLOSED_DUMMY_SECRET` result is permitted only when a configured synthetic matcher has actually matched; ordinary credential-looking input is not enough.

`BehaviorTrainingExample` is an offline authoring/evaluation contract with an utterance, reviewed redaction, source (`synthetic` or `consented_redacted`), behavior label, and train/validation/held-out split. It is not used as live inference input. Candidate data must not contain real credentials or raw audio.

Evon can later propose candidate utterances and labels for human review. No model training, online inference, classifier confidence, or data collection service is included in this amendment.
