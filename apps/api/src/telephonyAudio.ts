import { z } from "zod";

export const TelephonyTransformPlanSchema = z.object({
  direction: z.enum(["caller_playback", "learner_to_stt"]),
  transformVersion: z.string().min(1),
  inputSampleRateHz: z.number().int().positive(),
  outputSampleRateHz: z.literal(8_000),
  mildCompression: z.object({
    enabled: z.boolean(),
    ratio: z.number().min(1).max(4),
    thresholdDb: z.number().min(-40).max(0),
  }).strict(),
  noise: z.object({
    kind: z.enum(["none", "hiss", "room", "call_centre"]),
    level: z.number().min(0).max(0.05),
    seed: z.string().min(1).nullable(),
  }).strict(),
  reproducible: z.literal(true),
  echoCancellationRequired: z.literal(true),
  speakerBleedValidated: z.boolean(),
}).strict().superRefine((plan, context) => {
  if (plan.noise.kind === "none" && plan.noise.level !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["noise", "level"], message: "Disabled noise must have a zero level." });
  }
  if (plan.noise.kind !== "none" && (plan.noise.level === 0 || plan.noise.seed === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["noise"], message: "Enabled noise requires a non-zero level and deterministic seed." });
  }
});
export type TelephonyTransformPlan = z.infer<typeof TelephonyTransformPlanSchema>;

/** Contract and deterministic configuration only; the audio signal transform is not implemented in this phase. */
export interface TelephonyAudioTransformer {
  transform(input: Uint8Array, plan: TelephonyTransformPlan): Promise<Uint8Array>;
}

export function interruptionDetectionValidated(plan: TelephonyTransformPlan): boolean {
  return plan.echoCancellationRequired && plan.speakerBleedValidated;
}
