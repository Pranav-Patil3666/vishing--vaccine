export type ApplicationErrorCode =
  | "SESSION_NOT_FOUND" | "CONSENT_REQUIRED" | "INVALID_STATE" | "INVALID_REQUEST"
  | "SCENARIO_NOT_FOUND" | "INVALID_SCENARIO" | "TRANSCRIPTION_FAILED" | "ROUTING_FAILED"
  | "SYNTHESIS_FAILED" | "APPROVED_RESPONSE_UNAVAILABLE" | "CLASSIFIER_FAILED" | "INVALID_TIMING"
  | "CREDIT_LIMIT_REACHED" | "RATE_LIMITED" | "INTERNAL_ERROR";

const statusByCode: Record<ApplicationErrorCode, number> = {
  SESSION_NOT_FOUND: 404, SCENARIO_NOT_FOUND: 404, CONSENT_REQUIRED: 409, INVALID_STATE: 409,
  INVALID_REQUEST: 400, INVALID_SCENARIO: 422, TRANSCRIPTION_FAILED: 502, ROUTING_FAILED: 502,
  SYNTHESIS_FAILED: 502, APPROVED_RESPONSE_UNAVAILABLE: 502, CLASSIFIER_FAILED: 502, INVALID_TIMING: 400,
  CREDIT_LIMIT_REACHED: 429, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
};

export class ApplicationError extends Error {
  readonly status: number;
  constructor(readonly code: ApplicationErrorCode, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "ApplicationError";
    this.status = statusByCode[code];
  }
}

export function errorResponse(error: unknown): { status: number; body: { error: { code: string; message: string; retryAfterSeconds?: number; fallbackMode?: "demo-safe" } } } {
  if (error instanceof ApplicationError) {
    return { status: error.status, body: { error: {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      ...(error.code === "CREDIT_LIMIT_REACHED" ? { fallbackMode: "demo-safe" as const } : {}),
    } } };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, body: { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } } };
}
