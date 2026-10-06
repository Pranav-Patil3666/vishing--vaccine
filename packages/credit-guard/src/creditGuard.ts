import type { CreditUsageEvent } from "@vaccine/contracts";

export type CreditMode = "development" | "public-demo";
export type FallbackDecision = "none" | "cache" | "demo-safe";

export interface CreditBudget {
  mode: CreditMode;
  developmentCap: number;
  publicDemoCap: number;
  reserveCap: number;
  usedUnits: number;
}

export interface CreditRequestProjection {
  operation: string;
  estimatedUnits: number;
  cacheAvailable: boolean;
  sessionId?: string;
}

export interface CreditDecision {
  allowed: boolean;
  cap: number;
  usableCap: number;
  projectedUsage: number;
  fallback: FallbackDecision;
  event: CreditUsageEvent;
}

export function evaluateCreditRequest(
  budget: CreditBudget,
  request: CreditRequestProjection,
  now: Date = new Date(),
): CreditDecision {
  validateNonNegativeFinite(budget.developmentCap, "developmentCap");
  validateNonNegativeFinite(budget.publicDemoCap, "publicDemoCap");
  validateNonNegativeFinite(budget.reserveCap, "reserveCap");
  validateNonNegativeFinite(budget.usedUnits, "usedUnits");
  validateNonNegativeFinite(request.estimatedUnits, "estimatedUnits");

  const cap = budget.mode === "development" ? budget.developmentCap : budget.publicDemoCap;
  const usableCap = Math.max(0, cap - budget.reserveCap);
  const projectedUsage = budget.usedUnits + request.estimatedUnits;
  const allowed = projectedUsage <= usableCap;
  const fallback: FallbackDecision = allowed ? "none" : request.cacheAvailable ? "cache" : "demo-safe";
  const event: CreditUsageEvent = {
    eventId: makeEventId(request.operation, now, projectedUsage),
    operation: request.operation,
    kind: allowed ? "projected" : "rejected",
    configuredUnits: request.estimatedUnits,
    occurredAt: now.toISOString(),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
  };

  return { allowed, cap, usableCap, projectedUsage, fallback, event };
}

export function createCreditUsageEvent(input: {
  operation: string;
  kind: CreditUsageEvent["kind"];
  configuredUnits: number;
  occurredAt?: Date;
  sessionId?: string;
}): CreditUsageEvent {
  validateNonNegativeFinite(input.configuredUnits, "configuredUnits");
  const occurredAt = input.occurredAt ?? new Date();
  return {
    eventId: makeEventId(input.operation, occurredAt, input.configuredUnits),
    operation: input.operation,
    kind: input.kind,
    configuredUnits: input.configuredUnits,
    occurredAt: occurredAt.toISOString(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

function makeEventId(operation: string, date: Date, units: number): string {
  const safeOperation = operation.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return `usage-${safeOperation || "operation"}-${date.getTime()}-${String(units).replace(/\./g, "-")}`;
}

function validateNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite, non-negative configured value.`);
}
