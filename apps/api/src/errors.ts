import { TechnicalFailureSchema, type TechnicalFailure, type TechnicalStage } from "@vaccine/contracts";

export type ApplicationErrorCode =
  | "SESSION_NOT_FOUND" | "CONSENT_REQUIRED" | "INVALID_STATE" | "INVALID_REQUEST"
  | "SCENARIO_NOT_FOUND" | "INVALID_SCENARIO" | "TRANSCRIPTION_FAILED" | "ROUTING_FAILED"
  | "SYNTHESIS_FAILED" | "APPROVED_RESPONSE_UNAVAILABLE" | "CLASSIFIER_FAILED" | "INVALID_TIMING"
  | "CREDIT_LIMIT_REACHED" | "RATE_LIMITED" | "INTERNAL_ERROR"
  | "STT_UNAVAILABLE" | "NO_SPEECH" | "STT_EMPTY" | "STT_TIMEOUT" | "STT_CONNECTION_FAILED"
  | "STT_PROTOCOL_ERROR" | "STT_CANCELLED"
  | "TTS_UNAVAILABLE" | "TTS_PROVIDER_FAILED" | "TTS_TIMEOUT" | "TTS_CANCELLED";

const statusByCode: Record<ApplicationErrorCode, number> = {
  SESSION_NOT_FOUND: 404, SCENARIO_NOT_FOUND: 404, CONSENT_REQUIRED: 409, INVALID_STATE: 409,
  INVALID_REQUEST: 400, INVALID_SCENARIO: 422, TRANSCRIPTION_FAILED: 502, ROUTING_FAILED: 502,
  SYNTHESIS_FAILED: 502, APPROVED_RESPONSE_UNAVAILABLE: 502, CLASSIFIER_FAILED: 502, INVALID_TIMING: 400,
  CREDIT_LIMIT_REACHED: 429, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
  STT_UNAVAILABLE: 503, NO_SPEECH: 422, STT_EMPTY: 422, STT_TIMEOUT: 504,
  STT_CONNECTION_FAILED: 502, STT_PROTOCOL_ERROR: 502, STT_CANCELLED: 409,
  TTS_UNAVAILABLE: 503, TTS_PROVIDER_FAILED: 502, TTS_TIMEOUT: 504, TTS_CANCELLED: 409,
};

export class ApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: ApplicationErrorCode, message: string, readonly retryAfterSeconds?: number, readonly technical?: TechnicalFailure) {
    super(message);
    this.name = "ApplicationError";
    this.status = statusByCode[code];
  }
}

export function withTechnical(error: unknown, stage: TechnicalStage, providerAttempted: boolean, cacheResult?: TechnicalFailure["cacheResult"]): ApplicationError {
  const typed = error instanceof ApplicationError ? error : new ApplicationError("INTERNAL_ERROR", "The local operation could not complete.");
  if (typed.technical) return typed;
  return new ApplicationError(typed.code, typed.message, typed.retryAfterSeconds, { stage, causeCode: typed.code, providerAttempted, ...(cacheResult ? { cacheResult } : {}) });
}

export function errorResponse(error: unknown): { status: number; body: { error: { code: string; message: string; retryAfterSeconds?: number; fallbackMode?: "demo-safe"; technical?: TechnicalFailure } } } {
  if (error instanceof ApplicationError) {
    return { status: error.status, body: { error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      ...(error.code === "CREDIT_LIMIT_REACHED" ? { fallbackMode: "demo-safe" as const } : {}),
      ...(error.technical ? { technical: TechnicalFailureSchema.parse(error.technical) } : {}),
    } } };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, body: { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } } };
}
