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
  backgroundLoop: z.enum(["none", "office", "call_centre"]),
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

export interface TelephonyAudioTransformer {
  transform(input: Uint8Array, plan: TelephonyTransformPlan): Promise<Uint8Array>;
}

/** Small deterministic PCM transform for tests; it is not a production telephony codec or quality claim. */
export class DeterministicTelephonyAudioTransformer implements TelephonyAudioTransformer {
  async transform(input: Uint8Array, rawPlan: TelephonyTransformPlan): Promise<Uint8Array> {
    const plan = TelephonyTransformPlanSchema.parse(rawPlan);
    if (input.byteLength === 0) throw new RangeError("PCM input must be non-empty.");
    if (input.byteLength % 2 !== 0) throw new RangeError("Signed 16-bit PCM must contain an even number of bytes.");
    const inputSamples = new Int16Array(input.byteLength / 2);
    const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
    for (let i = 0; i < inputSamples.length; i++) inputSamples[i] = inputView.getInt16(i * 2, true);
    const outputLength = Math.max(1, Math.floor(inputSamples.length * plan.outputSampleRateHz / plan.inputSampleRateHz));
    const output = new Uint8Array(outputLength * 2);
    const outputView = new DataView(output.buffer);
    const threshold = 32767 * 10 ** (plan.mildCompression.thresholdDb / 20);
    const random = seededRandom(plan.noise.seed ?? plan.transformVersion);
    const noiseMagnitude = Math.round(plan.noise.level * 32767);
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = Math.min(inputSamples.length - 1, Math.floor(i * plan.inputSampleRateHz / plan.outputSampleRateHz));
      let sample = inputSamples[sourceIndex] ?? 0;
      if (plan.mildCompression.enabled) {
        const magnitude = Math.abs(sample);
        if (magnitude > threshold) sample = Math.sign(sample) * (threshold + (magnitude - threshold) / plan.mildCompression.ratio);
      }
      if (plan.noise.kind !== "none") sample += (random() * 2 - 1) * noiseMagnitude;
      if (plan.backgroundLoop !== "none") {
        const loopPosition = i % Math.max(1, Math.round(plan.outputSampleRateHz * 2));
        const loopLevel = Math.max(noiseMagnitude, 60);
        sample += Math.sin(2 * Math.PI * loopPosition / Math.max(1, plan.outputSampleRateHz * 0.11)) * loopLevel;
      }
      outputView.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(sample))), true);
    }
    return output;
  }
}

export function interruptionDetectionValidated(plan: TelephonyTransformPlan): boolean {
  return plan.echoCancellationRequired && plan.speakerBleedValidated;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
