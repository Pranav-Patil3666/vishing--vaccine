import { z } from "zod";
import { ConversationCallerSignalSchema, ConversationFailureSchema, TechnicalFailureSchema, type SessionState } from "@vaccine/contracts";
import { ApplicationError } from "./errors.js";
import { transitionSession } from "./session.js";

/** Provider-neutral lifecycle acknowledgements. Actual browser callbacks supply local instants. */
export function applyConversationAction(session: SessionState, action: string, body: unknown): SessionState {
  if (session.runtimeMode !== "REAL_CONVERSATION" || !session.conversation) throw new ApplicationError("INVALID_STATE", "Automatic conversation mode is required.");
  const conversation = session.conversation;
  if (action === "fail") {
    const parsed = z.object({ code: ConversationFailureSchema, technical: TechnicalFailureSchema.optional() }).strict().safeParse(body);
    if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "A typed conversation failure is required.");
    if (["COMPLETED", "STOPPED", "ERROR"].includes(conversation.phase)) return session;
    return { ...session, state: "ERROR", recordingEnabled: false, conversation: { ...conversation, phase: "ERROR", failureCode: parsed.data.code,
      ...(parsed.data.technical ? { failure: parsed.data.technical } : {}) } };
  }
  if (session.consent.status !== "granted" || ["COMPLETED", "STOPPED", "ERROR"].includes(conversation.phase)) throw new ApplicationError("INVALID_STATE", "Conversation is stopped or unavailable.");
  if (action === "start") {
    const parsed = z.object({ audioClockId: z.string().uuid() }).strict().safeParse(body);
    if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "A browser clock identity is required.");
    if (conversation.phase === "CALLER_PREPARING" && conversation.audioClockId === parsed.data.audioClockId && session.turnNumber === 0) return session;
    if (conversation.phase !== "IDLE" || session.state !== "READY" || session.turnNumber !== 0) throw new ApplicationError("INVALID_STATE", "Conversation was already started.");
    return { ...transitionSession(session, "CALLER_SPEAKING"), recordingEnabled: false,
      conversation: { phase: "CALLER_PREPARING", audioClockId: parsed.data.audioClockId } };
  }
  const parsed = ConversationCallerSignalSchema.safeParse(body);
  if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "A local caller playback observation is required.");
  const signal = parsed.data;
  if (signal.turnNumber !== session.turnNumber || signal.responseId !== session.currentResponseId || signal.audioClockId !== conversation.audioClockId) throw new ApplicationError("INVALID_STATE", "Stale caller playback observation.");
  const previousEnd = session.timelineEvents.at(-1)?.learnerSpeechEndedAt?.monotonicMs ?? 0;
  if (signal.atMs < previousEnd) throw new ApplicationError("INVALID_TIMING", "Caller playback cannot precede its committed learner event.");
  const terminal = session.terminalState !== null;
  if (action === "caller-start") {
    if (conversation.caller?.startedAtMs === signal.atMs && ["CALLER_PLAYING", "TERMINAL_CALLER_PLAYING"].includes(conversation.phase)) return session;
    if (conversation.phase !== (terminal ? "TERMINAL_CALLER_PREPARING" : "CALLER_PREPARING")) throw new ApplicationError("INVALID_STATE", "Caller playback is not ready.");
    return { ...session, conversation: { ...conversation, phase: terminal ? "TERMINAL_CALLER_PLAYING" : "CALLER_PLAYING",
      caller: { turnNumber: signal.turnNumber, responseId: signal.responseId, startedAtMs: signal.atMs } } };
  }
  if (action === "caller-ended") {
    if (conversation.caller?.endedAtMs === signal.atMs && conversation.phase === "LEARNER_LISTENING") return session;
    if (!conversation.caller || signal.atMs < conversation.caller.startedAtMs || conversation.phase !== (terminal ? "TERMINAL_CALLER_PLAYING" : "CALLER_PLAYING")) throw new ApplicationError("INVALID_STATE", "Caller playback did not start or already ended.");
    const next = transitionSession(session, terminal ? "COMPLETED" : "LISTENING");
    return { ...next, conversation: { ...conversation, phase: terminal ? "COMPLETED" : "LEARNER_LISTENING", caller: { ...conversation.caller, endedAtMs: signal.atMs } } };
  }
  throw new ApplicationError("INVALID_REQUEST", "Unknown conversation action.");
}
