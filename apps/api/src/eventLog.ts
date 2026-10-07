import { LearnerTurnEventSchema, type LearnerTurnEvent, type SessionState } from "@vaccine/contracts";

/** Append a fact-only event while enforcing session identity, order, and first-disclosure-only semantics. */
export function appendLearnerTurnEvent(session: SessionState, input: LearnerTurnEvent): SessionState {
  const event = LearnerTurnEventSchema.parse(input);
  if (event.sessionId !== session.sessionId) throw new Error("Learner event belongs to another session.");
  if (session.timelineEvents.some((prior) => prior.turnId === event.turnId)) throw new Error("Duplicate learner turn event.");
  if (event.callerPressureLevel > session.maxPressureLevel) throw new Error("Event pressure exceeds this session's configured maximum.");
  if (event.nextPressureLevel > session.maxPressureLevel) throw new Error("Next pressure exceeds this session's configured maximum.");
  const firstMomentAlreadyLogged = session.timelineEvents.some((prior) => prior.complianceMoment !== null);
  if (event.behavior.label === "DISCLOSED_DUMMY_SECRET" && !event.complianceMoment && !firstMomentAlreadyLogged) {
    throw new Error("The first dummy-secret disclosure requires its segment-level timing moment.");
  }
  if (event.complianceMoment && firstMomentAlreadyLogged) {
    throw new Error("Only the first observed dummy-secret disclosure is retained in the timeline.");
  }
  if (event.complianceMoment && event.complianceMoment.turnId !== event.turnId) {
    throw new Error("Compliance moment must identify its learner turn.");
  }
  return { ...session, timelineEvents: [...session.timelineEvents, event] };
}
