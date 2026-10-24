import { TechnicalCauseSchema, TechnicalFailureSchema, type TechnicalFailure, type TechnicalStage } from "@vaccine/contracts";

/** Extract enum/numeric facts only; never preserve raw server/provider messages, headers, stacks or payloads. */
export function readTechnicalFailure(payload: unknown, stage: TechnicalStage): TechnicalFailure {
  const error = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
  if (typeof error === "object" && error !== null) {
    if ("technical" in error) { const parsed = TechnicalFailureSchema.safeParse(error.technical); if (parsed.success) return parsed.data; }
    if ("code" in error) { const code = TechnicalCauseSchema.safeParse(error.code); if (code.success) return { stage, causeCode: code.data, providerAttempted: null }; }
  }
  return { stage, causeCode: "INTERNAL_ERROR", providerAttempted: null };
}
