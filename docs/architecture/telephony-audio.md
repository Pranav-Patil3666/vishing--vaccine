# Telephony audio foundation

`TelephonyTransformPlan` describes deterministic caller playback and learner-to-STT test paths. Both target 8 kHz call-like audio in this foundation. The plan includes a versioned mild-compression setting, optional noise or call-centre background, a fixed seed whenever noise is enabled, and reproducibility metadata. This is a configuration/interface only; no signal processing algorithm or speaker/microphone echo correction is implemented.

Lower-rate or degraded learner-audio tests must be configured and recorded as test conditions before they are sent to a future recognizer adapter. A successful transform does not establish real-world telephony equivalence.

The live voice path requires a headset or strong browser echo cancellation. `echoCancellationRequired` is part of the plan. Interruption detection must not be described as reliable until speaker bleed has been validated; `speakerBleedValidated` is false by default. There is no feedback-correction algorithm in this phase.

The future audio adapter receives bytes and the validated plan. It must use deterministic transform parameters, avoid writing raw learner audio, and pass the resulting PCM to the backend recognizer boundary.
