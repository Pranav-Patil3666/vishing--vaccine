import { useEffect, useState } from "react";
import {
  SessionCreateResponseSchema, TurnApiResponseSchema,
  type ApiHealthResponse, type SafeSession, type TurnApiResponse,
} from "@vaccine/contracts";
import { SafetyDisclosures } from "@vaccine/ui";
import { fetchApiHealth } from "./healthClient.js";
import { parseClientEnvironment } from "./environment.js";

const publicEnvironment = parseClientEnvironment({
  VITE_PUBLIC_APP_NAME: import.meta.env.VITE_PUBLIC_APP_NAME,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});

export function App() {
  const [health, setHealth] = useState<ApiHealthResponse | null>(null);
  const [session, setSession] = useState<SafeSession | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnApiResponse | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkHealth(): Promise<void> {
    try { setHealth(await fetchApiHealth(publicEnvironment.VITE_API_BASE_URL)); }
    catch (cause) { setHealth(null); setError(cause instanceof Error ? cause.message : "Health check failed."); }
  }
  async function callApi<T>(path: string, body: unknown, schema: { parse: (input: unknown) => T }): Promise<T> {
    const response = await fetch(`${publicEnvironment.VITE_API_BASE_URL}${path}`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const apiError = payload as { error?: { message?: string } };
      throw new Error(apiError.error?.message ?? `API returned ${response.status}.`);
    }
    return schema.parse(payload);
  }
  async function action(run: () => Promise<void>): Promise<void> {
    setBusy(true); setError(null);
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  }
  async function createSession(): Promise<void> {
    await action(async () => {
      const result = await callApi("/api/sessions", {
        scenarioId: "S-01", scenarioVersion: "0.1.0-draft", language: "pending-verification", demoMode: true,
      }, SessionCreateResponseSchema);
      setSession(result.session); setLastTurn(null);
    });
  }
  async function grantConsent(): Promise<void> {
    if (!session) return;
    await action(async () => {
      const result = await callApi(`/api/sessions/${encodeURIComponent(session.sessionId)}/consent`, { consentVersion: "training-consent-v1" }, SessionCreateResponseSchema.pick({ session: true }).passthrough());
      setSession(result.session);
    });
  }
  async function submitTurn(): Promise<void> {
    if (!session) return;
    await action(async () => {
      const result = await callApi(`/api/sessions/${encodeURIComponent(session.sessionId)}/turn`, { text }, TurnApiResponseSchema);
      setLastTurn(result); setSession(result.session); setText("");
    });
  }
  async function endSession(): Promise<void> {
    if (!session) return;
    await action(async () => {
      const result = await callApi(`/api/sessions/${encodeURIComponent(session.sessionId)}/end`, {}, SessionCreateResponseSchema.pick({ session: true }).passthrough());
      setSession(result.session);
    });
  }
  useEffect(() => { void checkHealth(); }, []);

  return <>
    <SafetyDisclosures />
    <main>
      <h1>{publicEnvironment.VITE_PUBLIC_APP_NAME}</h1>
      <p>Development test UI. Typed mock input only; no microphone or provider API is connected.</p>
      <section aria-labelledby="health-heading">
        <h2 id="health-heading">API connection</h2>
        <button type="button" onClick={() => void checkHealth()}>Check API health</button>
        {health && <p role="status">Connected: {health.status} ({health.environment})</p>}
      </section>
      <section aria-labelledby="session-heading">
        <h2 id="session-heading">Mock session</h2>
        {!session && <button type="button" onClick={() => void createSession()} disabled={busy}>Create draft-safe demo session</button>}
        {session && <>
          <p>State: <strong>{session.state}</strong> · Turn: {session.turnNumber} · Recording: {String(session.recordingEnabled)}</p>
          <p>Scenario: {session.scenarioId} ({session.scenarioVersion}) · Language: {session.language}</p>
          {session.state === "CONSENT_REQUIRED" && <button type="button" onClick={() => void grantConsent()} disabled={busy}>Grant explicit mock consent</button>}
          {(session.state === "READY" || session.state === "LISTENING" || session.state === "FALLBACK") && <>
            <label htmlFor="mock-text">Mock learner text input</label>
            <input id="mock-text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
            <button type="button" onClick={() => void submitTurn()} disabled={busy || !text.trim()}>Submit mock turn</button>
          </>}
          {session.state !== "ENDED_BY_LEARNER" && session.state !== "COMPLETED" && <button type="button" onClick={() => void endSession()} disabled={busy}>End session</button>}
        </>}
      </section>
      {lastTurn && <section aria-labelledby="turn-heading">
        <h2 id="turn-heading">Last turn</h2>
        <p>Transcript: {lastTurn.transcript.text}</p>
        <p>Branch: {lastTurn.branch.id ?? "none"} · Response: {lastTurn.branch.responseId} · Route reason: {lastTurn.branch.reason}</p>
        <p>Caller response metadata: {lastTurn.response.mediaType} · cache {lastTurn.response.cacheHit ? "hit" : "miss"} · fallback: {String(lastTurn.response.fallback)} · playable audio: {String(lastTurn.response.playable)}</p>
        <h3>Debrief events</h3>
        <ul>{session?.debriefEvents.map((event) => <li key={event.eventId}>Turn {event.turnNumber}: {event.observedBehavior}; {event.callerTesting}; flags: {event.redFlagIds.join(", ") || "none"}; observed rubric points: {event.rubricPoints?.join(", ") || "none"}. {event.recommendedAction}{event.evidenceSnippet ? ` Evidence: ${event.evidenceSnippet}` : ""}</li>)}</ul>
      </section>}
      {error && <p role="alert">{error}</p>}
    </main>
  </>;
}
