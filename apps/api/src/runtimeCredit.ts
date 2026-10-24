import { randomUUID } from "node:crypto";
import { evaluateCreditRequest, type CreditBudget } from "@vaccine/credit-guard";
import { RuntimeCreditSnapshotSchema, type CreditDecisionFact, type RuntimeCreditReservation, type RuntimeCreditSnapshot } from "@vaccine/contracts";
import { ApplicationError } from "./errors.js";

/** Existing per-operation process budget, with a bounded audit and a refundable pre-transport boundary. */
export class RuntimeCreditLedger {
  private readonly used = new Map<string, number>();
  private readonly simulatedUsed = new Map<string, number>();
  private readonly attempts = { stt: 0, tts: 0 };
  private readonly events: RuntimeCreditSnapshot["events"] = [];
  private readonly bootId = randomUUID();
  private readonly loadedAt: string;
  constructor(private readonly budget: CreditBudget, private readonly costs: { stt: number; tts: number },
    private readonly initialTtsUsedUnits: number | undefined, private readonly now: () => Date) {
    this.loadedAt = now().toISOString();
    if (initialTtsUsedUnits !== undefined) this.used.set("tts", initialTtsUsedUnits);
  }
  usedUnits(operation: string): number { return this.used.get(operation) ?? this.budget.usedUnits; }
  simulatedUsedUnits(operation: string): number { return this.simulatedUsed.get(operation) ?? this.budget.usedUnits; }
  chargeSimulated(operation: string, units: number, sessionId: string, cacheAvailable = false): void {
    const before = this.simulatedUsedUnits(operation);
    const decision = evaluateCreditRequest({ ...this.budget, usedUnits: before }, { operation, estimatedUnits: units, cacheAvailable, sessionId }, this.now());
    if (!decision.allowed) throw new ApplicationError("CREDIT_LIMIT_REACHED", `Configured ${operation} project-unit cap reached.`);
    if (units > 0) this.simulatedUsed.set(operation, before + units);
  }
  reserve(operation: "stt" | "tts", sessionId: string): RuntimeCreditReservation {
    const before = this.usedUnits(operation), units = this.costs[operation];
    const decision = evaluateCreditRequest({ ...this.budget, usedUnits: before }, { operation, estimatedUnits: units, cacheAvailable: false, sessionId }, this.now());
    const event: RuntimeCreditSnapshot["events"][number] = { id: randomUUID(), operation, sessionId,
      state: decision.allowed ? "RESERVED" : "DENIED", guardAllowed: decision.allowed, providerAttempted: false, units,
      usedBefore: before, usedAfter: decision.allowed ? before + units : before };
    this.events.push(event); if (this.events.length > 64) this.events.shift();
    if (!decision.allowed) {
      const credit: CreditDecisionFact = { operation, cap: decision.cap, reserveCap: this.budget.reserveCap, usableCap: decision.usableCap,
        usedUnits: before, costUnits: units, projectedUnits: decision.projectedUsage, remainingUnits: Math.max(0, decision.usableCap - before), allowed: false };
      throw new ApplicationError("CREDIT_LIMIT_REACHED", `Configured ${operation} project-unit cap reached.`, undefined,
        { stage: operation === "stt" ? "STT_START" : "TTS_CREDIT_GUARD", causeCode: "CREDIT_LIMIT_REACHED", providerAttempted: false,
          ...(operation === "tts" ? { cacheResult: "MISS" } : {}), credit });
    }
    this.used.set(operation, before + units);
    return {
      attempted: () => { if (event.state !== "RESERVED") return; event.state = "ATTEMPTED"; event.providerAttempted = true; this.attempts[operation]++; },
      releaseBeforeAttempt: () => { if (event.state !== "RESERVED") return;
        this.used.set(operation, this.usedUnits(operation) - units); event.state = "RELEASED"; event.usedAfter = this.usedUnits(operation); },
    };
  }
  snapshot(): RuntimeCreditSnapshot {
    const cap = this.budget.mode === "development" ? this.budget.developmentCap : this.budget.publicDemoCap;
    const usableCap = Math.max(0, cap - this.budget.reserveCap);
    const counter = (operation: "stt" | "tts") => ({ usedUnits: this.usedUnits(operation), remainingUnits: Math.max(0, usableCap - this.usedUnits(operation)), providerAttempts: this.attempts[operation] });
    return RuntimeCreditSnapshotSchema.parse({ processId: process.pid, bootId: this.bootId, loadedAt: this.loadedAt,
      mode: this.budget.mode, cap, reserveCap: this.budget.reserveCap, usableCap, sttCostUnits: this.costs.stt, ttsCostUnits: this.costs.tts,
      initialTtsUsedUnits: this.initialTtsUsedUnits ?? this.budget.usedUnits,
      scope: "per-operation runtime process memory; used includes pending reservations; mock simulations separate",
      simulation: { sttUsedUnits: this.simulatedUsedUnits("stt"), ttsUsedUnits: this.simulatedUsedUnits("tts") },
      stt: counter("stt"), tts: counter("tts"), events: this.events });
  }
}
