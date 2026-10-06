import type { SessionState } from "@vaccine/contracts";
import { ApplicationError } from "./errors.js";

export class InMemorySessionStore {
  private readonly sessions = new Map<string, SessionState>();
  create(state: SessionState): void {
    if (this.sessions.has(state.sessionId)) throw new ApplicationError("INVALID_STATE", "Session ID already exists.");
    this.sessions.set(state.sessionId, state);
  }
  get(sessionId: string): SessionState {
    const state = this.sessions.get(sessionId);
    if (!state) throw new ApplicationError("SESSION_NOT_FOUND", "Session was not found.");
    return state;
  }
  update(state: SessionState): void {
    if (!this.sessions.has(state.sessionId)) throw new ApplicationError("SESSION_NOT_FOUND", "Session was not found.");
    this.sessions.set(state.sessionId, state);
  }
  values(): readonly SessionState[] { return [...this.sessions.values()]; }
}
