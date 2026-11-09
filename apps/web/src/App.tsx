import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import type { ApiHealthResponse, AudioTimingFixture, SafeSession } from "@vaccine/contracts";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { AppShell } from "./components/AppShell.js";
import { parseClientEnvironment } from "./environment.js";
import { fetchApiHealth } from "./healthClient.js";
import { AuthoringPage } from "./pages/AuthoringPage.js";
import { DashboardPage, DebriefPage, SessionHistoryPage } from "./pages/ResultsPages.js";
import { ActiveCall, ScreenMessage, TrainingBriefing, TrainingLibrary, type CatalogState } from "./pages/TrainingPages.js";
import { parseHashRoute, routeHash, type AppRoute } from "./route.js";
import { scenarioCatalog } from "./scenarioCatalog.js";
import { createApiClient, SessionApiError, type ApiClient } from "./sessionApi.js";
import { activeSessionKey, parseSessionIds, sessionHistoryKey, sessionStatus } from "./trainingResults.js";

const publicEnvironment = parseClientEnvironment({
  VITE_PUBLIC_APP_NAME: import.meta.env?.VITE_PUBLIC_APP_NAME,
  VITE_API_BASE_URL: import.meta.env?.VITE_API_BASE_URL,
});

const browserHash = () => typeof window === "undefined" ? "" : window.location.hash;
const defaultHealth = () => fetchApiHealth(publicEnvironment.VITE_API_BASE_URL);

function readStorage(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* The current view still works if storage is unavailable. */ }
}

function savedSessionIds() {
  try { return parseSessionIds(JSON.parse(readStorage(sessionHistoryKey) ?? "[]")); }
  catch { return []; }
}

function safeError(cause: unknown, fallback: string) {
  if (cause instanceof SessionApiError) {
    if (cause.code === "SCENARIO_NOT_FOUND" || cause.code === "INVALID_SCENARIO") return "That scenario version is no longer available. Return to training and choose a current scenario.";
    if (cause.status === 404) return "This session is no longer available. The local API may have restarted.";
    if (!cause.status) return "The local API did not respond. Check the connection and try again.";
    if (cause.code === "RATE_LIMITED") return "There have been too many requests. Wait a moment before trying again.";
    if (cause.code === "CREDIT_LIMIT_REACHED") return "The local practice allowance was reached. Use the offline demo server for typed practice.";
    if (cause.code === "CONSENT_REQUIRED") return "Consent is required. Return to training and start again.";
  }
  return fallback;
}

export function App({ client, loadHealth = defaultHealth, development = import.meta.env?.DEV === true }: {
  client?: ApiClient; loadHealth?: () => Promise<ApiHealthResponse>; development?: boolean;
} = {}) {
  const api = useMemo(() => client ?? createApiClient(publicEnvironment.VITE_API_BASE_URL), [client]);
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute(browserHash()));
  const [health, setHealth] = useState<ApiHealthResponse | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [initialActive] = useState(() => parseSessionIds([readStorage(activeSessionKey)])[0] ?? null);
  const [restoring, setRestoring] = useState(Boolean(initialActive));
  const [recovery, setRecovery] = useState<{ id: string; state: "interrupted" | "expired" } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyIssue, setHistoryIssue] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ id: string; issue: string | null } | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [records, setRecords] = useState(() => new Map<string, SafeSession>());
  const [initialIds] = useState(savedSessionIds);

  const seen = useRef(records);
  const ids = useRef(initialIds);
  const active = useRef<string | null>(initialActive);
  const stopMedia = useRef<(() => void) | null>(null);
  const routeEpoch = useRef(0);
  const begin = useRef(false);
  const typed = useRef<{ id: string; work: Promise<unknown> } | null>(null);
  const pendingEnds = useRef(new Map<string, Promise<SafeSession>>());
  const pendingReads = useRef(new Map<string, Promise<SafeSession>>());
  const catalogRequest = useRef<Promise<readonly ScenarioDocument[]> | null>(null);
  const historyRequest = useRef<Promise<void> | null>(null);
  const booted = useRef(false);

  const navigate = (next: AppRoute) => { window.location.hash = routeHash(next); };
  const isOnCall = (id: string) => {
    const current = parseHashRoute(browserHash());
    return current.page === "live" && current.sessionId === id;
  };

  function put(session: SafeSession, loaded = false) {
    const prior = seen.current.get(session.sessionId);
    if (loaded && prior && (active.current === session.sessionId || prior.turnNumber > session.turnNumber
      || (sessionStatus(prior) !== "In progress" && sessionStatus(session) === "In progress"))) return;
    seen.current = new Map(seen.current).set(session.sessionId, session);
    // Keep the tab index, the active call, and the currently viewed deep link.
    for (const id of seen.current.keys()) {
      if (id !== session.sessionId && id !== active.current && !ids.current.includes(id)) seen.current.delete(id);
    }
    setRecords(seen.current);
  }

  function saveIds(next: string[]) {
    ids.current = next;
    writeStorage(sessionHistoryKey, JSON.stringify(next));
  }

  function setActive(id: string | null) {
    active.current = id;
    writeStorage(activeSessionKey, id);
  }

  function expireSession(id: string) {
    setActive(null);
    saveIds(ids.current.filter((saved) => saved !== id));
    seen.current = new Map(seen.current);
    seen.current.delete(id);
    setRecords(seen.current);
    setRecovery({ id, state: "expired" });
  }

  function readSession(id: string) {
    const pending = pendingReads.current.get(id);
    if (pending) return pending;
    const request = api.getSession(id).then((record) => {
      if (record.sessionId !== id) throw new Error("The session identity did not match.");
      return record;
    }).finally(() => pendingReads.current.delete(id));
    pendingReads.current.set(id, request);
    return request;
  }

  function endSession(id: string) {
    const pending = pendingEnds.current.get(id);
    if (pending) return pending;
    if (active.current === id) stopMedia.current?.();
    const request = (async () => {
      // Typed work has no live media. Settle its single request before closing the record.
      if (typed.current?.id === id) await typed.current.work.catch(() => undefined);
      const current = seen.current.get(id);
      const ended = current && sessionStatus(current) !== "In progress" ? current : await api.endSession(id);
      if (ended.sessionId !== id) throw new Error("The session identity did not match.");
      if (active.current === id) {
        setActive(null);
        setRecovery(null);
      }
      put(ended);
      return ended;
    })().catch((cause: unknown) => {
      if (active.current === id) {
        if (cause instanceof SessionApiError && cause.status === 404) expireSession(id);
        else setRecovery({ id, state: "interrupted" });
      }
      throw cause;
    }).finally(() => pendingEnds.current.delete(id));
    pendingEnds.current.set(id, request);
    return request;
  }

  async function refreshHealth() {
    try { setHealth(await loadHealth()); }
    catch { setHealth(null); }
    finally { setHealthChecked(true); }
  }

  function refreshCatalog(announce = true) {
    if (catalogRequest.current) return catalogRequest.current;
    if (announce) setCatalog({ status: "loading" });
    const request = (async () => {
      try {
        if (!api.listRuntimeScenarios) throw new Error("Missing catalog endpoint.");
        const scenarios = await api.listRuntimeScenarios();
        setCatalog({ status: "ready", scenarios });
        return scenarios;
      } catch (cause) { setCatalog({ status: "unavailable" }); throw cause; }
    })().finally(() => { catalogRequest.current = null; });
    catalogRequest.current = request;
    return request;
  }

  function refreshConnection() {
    void refreshHealth();
    void refreshCatalog().catch(() => undefined);
  }

  function refreshHistory() {
    if (historyRequest.current) return historyRequest.current;
    setHistoryLoading(true); setHistoryIssue(null);
    const saved = ids.current;
    const request = Promise.allSettled(saved.map(readSession)).then((results) => {
      const expired = new Set<string>();
      let missing = false;
      for (const [index, result] of results.entries()) {
        const id = saved[index]!;
        if (result.status === "fulfilled") { if (ids.current.includes(id)) put(result.value, true); }
        else if (result.reason instanceof SessionApiError && result.reason.status === 404) expired.add(id);
        else missing = true;
      }
      if (expired.size) {
        saveIds(ids.current.filter((id) => !expired.has(id)));
        seen.current = new Map([...seen.current].filter(([id]) => !expired.has(id)));
        setRecords(seen.current);
      }
      if (missing) setHistoryIssue("Some session results could not be loaded.");
      else if (expired.size) setHistoryIssue("Some prior sessions expired when the local API restarted.");
    }).finally(() => { historyRequest.current = null; setHistoryLoading(false); });
    historyRequest.current = request;
    return request;
  }

  useEffect(() => {
    let lastHash = browserHash();
    const onHashChange = () => {
      const nextHash = browserHash();
      if (lastHash === nextHash) return;
      const previous = parseHashRoute(lastHash);
      const next = parseHashRoute(nextHash);
      lastHash = nextHash;
      routeEpoch.current++;
      if (previous.page === "live" && (next.page !== "live" || next.sessionId !== previous.sessionId)
        && active.current === previous.sessionId) void endSession(previous.sessionId).catch(() => undefined);
      setError(null);
      setRoute(next);
    };
    const onPageHide = () => {
      const id = active.current;
      if (!id) return;
      stopMedia.current?.();
      if (!pendingEnds.current.has(id)) void api.endSession(id, true).catch(() => undefined);
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("pagehide", onPageHide);
    if (!booted.current) {
      booted.current = true;
      refreshConnection();
      void (async () => {
        if (initialActive) {
          try {
            const past = await readSession(initialActive);
            if (past.consent.status !== "not-requested") saveIds(parseSessionIds([initialActive, ...ids.current]));
            put(past, true);
            await endSession(initialActive);
          } catch (cause) {
            if (active.current === initialActive) {
              if (cause instanceof SessionApiError && cause.status === 404) expireSession(initialActive);
              else setRecovery({ id: initialActive, state: "interrupted" });
            }
          } finally { setRestoring(false); }
        }
        await refreshHistory();
      })();
    }
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [api]);

  const routeSessionId = route.page === "live" || route.page === "debrief" ? route.sessionId : undefined;
  const session = routeSessionId ? records.get(routeSessionId) : undefined;
  useEffect(() => {
    if (!routeSessionId || restoring || recovery?.id === routeSessionId || seen.current.has(routeSessionId)) return;
    let interested = true;
    setLookup({ id: routeSessionId, issue: null });
    void readSession(routeSessionId).then((record) => { if (interested) put(record, true); })
      .catch((cause: unknown) => {
        if (interested) setLookup({ id: routeSessionId, issue: safeError(cause, "The session could not be loaded.") });
      });
    return () => { interested = false; };
  }, [api, routeSessionId, restoring, recovery, lookupAttempt]);

  function updateCall(record: SafeSession) {
    if (active.current === record.sessionId && !pendingEnds.current.has(record.sessionId) && isOnCall(record.sessionId)) put(record);
  }

  function finishCall(record: SafeSession) {
    if (active.current !== record.sessionId || pendingEnds.current.has(record.sessionId) || !isOnCall(record.sessionId)) return;
    put(record);
    setActive(null);
    navigate({ page: "debrief", sessionId: record.sessionId });
  }

  async function startSimulation(scenario: ScenarioDocument, mode: SafeSession["runtimeMode"]) {
    if (begin.current || restoring || !scenario.language) return;
    const origin = browserHash(), epoch = routeEpoch.current;
    const stillHere = () => browserHash() === origin && routeEpoch.current === epoch;
    begin.current = true; setStarting(true); setError(null);
    let id: string | undefined;
    try {
      if (active.current) {
        try { await endSession(active.current); }
        catch (cause) {
          if (!(cause instanceof SessionApiError && cause.status === 404)) throw cause;
        }
      }
      const current = await refreshCatalog(false);
      if (!stillHere()) return;
      if (!current.some((entry) => entry.scenario_id === scenario.scenario_id && entry.version === scenario.version)) {
        setError("That scenario version has changed or been withdrawn. Return to training and choose a current scenario.");
        return;
      }
      const created = await api.createDemoSession({ scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
        language: scenario.language, demoMode: false, ...(mode === "MOCK" ? {} : { runtimeMode: mode }) });
      id = created.sessionId;
      setActive(id);
      if (!stillHere()) { await endSession(id); return; }
      const consented = await api.grantConsent(id);
      if (consented.sessionId !== id || consented.consent.status !== "granted") throw new Error("Consent did not apply to this session.");
      saveIds(parseSessionIds([id, ...ids.current]));
      put(consented);
      if (!stillHere()) { await endSession(id); return; }
      navigate({ page: "live", sessionId: id });
    } catch (cause) {
      if (id && active.current === id) await endSession(id).catch(() => undefined);
      if (stillHere()) setError(safeError(cause, "The simulation could not start. Check the connection and try again."));
    } finally { begin.current = false; setStarting(false); }
  }

  async function submitTurn(text: string, timing?: AudioTimingFixture) {
    if (!session || recovery?.id === session.sessionId || typed.current || pendingEnds.current.has(session.sessionId) || active.current !== session.sessionId
      || session.consent.status !== "granted" || sessionStatus(session) !== "In progress") return false;
    const id = session.sessionId;
    setProcessing(true); setError(null);
    const work = api.submitMockTurn(id, text, timing);
    typed.current = { id, work };
    try {
      const result = await work;
      if (result.session.sessionId !== id || result.session.turnNumber !== session.turnNumber + 1) throw new Error("The turn did not match the session.");
      if (pendingEnds.current.has(id) || !isOnCall(id)) return false;
      if (sessionStatus(result.session) !== "In progress") finishCall(result.session);
      else updateCall(result.session);
      return true;
    } catch (cause) {
      if (isOnCall(id) && !pendingEnds.current.has(id)) {
        // A response may have committed before the connection failed. Reload once and never resend the input.
        const latest = await readSession(id).catch(() => null);
        if (!isOnCall(id) || pendingEnds.current.has(id)) return false;
        if (latest && (latest.turnNumber > session.turnNumber || sessionStatus(latest) !== "In progress")) {
          if (sessionStatus(latest) !== "In progress") finishCall(latest);
          else updateCall(latest);
          return true;
        }
        if (latest) {
          updateCall(latest);
          setError(safeError(cause, "The response could not be processed. You can retry or end the simulation."));
        } else {
          setRecovery({ id, state: "interrupted" });
          void endCall(id);
        }
      }
      return false;
    } finally { typed.current = null; setProcessing(false); }
  }

  async function endCall(id: string) {
    if (pendingEnds.current.has(id)) return;
    setEnding(true); setError(null);
    try {
      await endSession(id);
      if (recovery?.id === id) void refreshHealth();
      if (isOnCall(id)) navigate({ page: "debrief", sessionId: id });
    } catch (cause) {
      if (!(cause instanceof SessionApiError && cause.status === 404) && isOnCall(id)) {
        setError("The local API did not confirm the end of this call.");
      }
      void refreshHealth();
    } finally { setEnding(false); }
  }

  const available = catalog.status === "ready" ? catalog.scenarios : [];
  const lookupScenario = (record: SafeSession) => [...available, ...scenarioCatalog]
    .find((scenario) => scenario.scenario_id === record.scenarioId && scenario.version === record.scenarioVersion);
  const training = () => navigate({ page: "scenarios" });
  const historyProps = { sessions: ids.current.flatMap((id) => records.get(id) ?? []), loading: historyLoading,
    issue: historyIssue, navigate, lookup: lookupScenario, refresh: () => void refreshHistory() };

  function renderPage() {
    switch (route.page) {
      case "dashboard": return <DashboardPage {...historyProps} />;
      case "sessions": return <SessionHistoryPage {...historyProps} />;
      case "scenarios": return <TrainingLibrary catalog={catalog} navigate={navigate} refresh={refreshConnection} />;
      case "authoring": return <AuthoringPage />;
      case "scenario":
      case "precall": {
        if (catalog.status === "loading") return <ScreenMessage title="Checking scenario availability" loading>Looking up the current approved release.</ScreenMessage>;
        if (catalog.status === "unavailable") return <ScreenMessage title="Training catalog unavailable" action="Retry connection" onAction={refreshConnection}>Check the local API connection before starting.</ScreenMessage>;
        const scenario = [...available].reverse().find((entry) => entry.scenario_id === route.scenarioId);
        if (!scenario) return <ScreenMessage title="Scenario unavailable" action="Back to training" onAction={training}>This scenario is not in the current playable catalog.</ScreenMessage>;
        return <TrainingBriefing key={`${scenario.scenario_id}@${scenario.version}`} scenario={scenario} busy={starting || restoring} navigate={navigate}
          voiceAvailable={development && health?.environment === "development" && scenario.scenario_id === "S-01" && scenario.language === "hi-IN"}
          start={(selected, mode) => void startSimulation(selected, mode)} />;
      }
      case "live":
      case "debrief": {
        if (restoring) return <ScreenMessage title="Closing the interrupted call" loading>Reloading never restarts the microphone or caller audio.</ScreenMessage>;
        if (recovery?.id === route.sessionId) {
          if (recovery.state === "expired") return <ScreenMessage title="Session no longer available" action="Back to training" onAction={training}>
            The local API may have restarted. Choose a scenario and review consent to start a new call.</ScreenMessage>;
          return <ScreenMessage title="Call interrupted" action={ending ? "Ending simulation…" : "Retry End simulation"} busy={ending}
            onAction={() => void endCall(route.sessionId)}>Practice is paused. Reconnect to the local API, then end the call to recover any committed turns.</ScreenMessage>;
        }
        if (!ending && pendingEnds.current.has(route.sessionId)) return <ScreenMessage title="Closing the interrupted call" loading>
          Waiting for the local API to finish the session.</ScreenMessage>;
        if (!session) {
          const issue = lookup?.id === route.sessionId ? lookup.issue : null;
          return issue ? <ScreenMessage title="Session unavailable" action="Retry lookup" onAction={() => setLookupAttempt((attempt) => attempt + 1)}>{issue}</ScreenMessage>
            : <ScreenMessage title="Loading the session" loading>Retrieving recorded session facts.</ScreenMessage>;
        }
        const finished = sessionStatus(session) !== "In progress";
        if (route.page === "debrief" && finished) return <DebriefPage session={session} lookup={lookupScenario} navigate={navigate}
          canPractice={available.some((entry) => entry.scenario_id === session.scenarioId)} />;
        if (route.page === "debrief" && active.current === session.sessionId) return <ScreenMessage title="The call is still active"
          action="Return to call" onAction={() => navigate({ page: "live", sessionId: session.sessionId })}>The debrief opens after the simulation finishes.</ScreenMessage>;
        if (route.page === "live" && active.current === session.sessionId) {
          const scenario = available.find((entry) => entry.scenario_id === session.scenarioId && entry.version === session.scenarioVersion);
          return <ActiveCall key={session.sessionId} session={session} {...(scenario ? { scenario } : {})} api={api}
            health={health} busy={processing} ending={ending} stopControl={stopMedia} onEnd={() => void endCall(session.sessionId)}
            onSession={updateCall} onFinished={finishCall} onSubmit={submitTurn} />;
        }
        if (finished) return <ScreenMessage title="This call has ended" action="Open debrief"
          onAction={() => navigate({ page: "debrief", sessionId: session.sessionId })}>Review the outcome and any committed turns.</ScreenMessage>;
        return <ScreenMessage title="This call cannot resume here" action="Back to training" onAction={training}>Start from the current catalog and review consent for a new session.</ScreenMessage>;
      }
    }
  }

  return <AppShell route={route} health={health} healthChecked={healthChecked}>
    <div className="global-disclosure"><span className="disclosure-pulse" /><strong>SIMULATION</strong><i /> FICTIONAL CONTENT <i /> USE DUMMY INFORMATION ONLY</div>
    {error && <div className="global-error" role="alert"><AlertCircle size={17} /><span>{error}</span>
      <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}
    {renderPage()}
  </AppShell>;
}
