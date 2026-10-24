import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, ArrowUpRight, AudioLines, BookOpenCheck, Check,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CircleStop, Clock3, FileAudio2,
  Gauge, Headphones, Info, LockKeyhole, Mic2, Play, Radio, RefreshCw, ShieldAlert, ShieldCheck, Sparkles,
  Square, Timer, UserCheck, X, type LucideIcon,
} from "lucide-react";
import {
  type ApiHealthResponse,
  type AudioTimingFixture,
  type SafeSession,
  type TurnApiResponse,
  type RealVoiceTurnResult,
} from "@vaccine/contracts";
import { AppShell } from "./components/AppShell.js";
import { MetricCard } from "./components/MetricCard.js";
import { PressureScale } from "./components/PressureScale.js";
import { PressureTimeline } from "./components/PressureTimeline.js";
import { ScenarioCard } from "./components/ScenarioCard.js";
import { VoiceSecurityCore, type VoiceActivity } from "./components/VoiceSecurityCore.js";
import { AuthoringPage } from "./pages/AuthoringPage.js";
import { LocalDraftReview } from "./components/LocalDraftReview.js";
import type { LocalScenarioDraft } from "./authoringDraft.js";
import { fetchApiHealth } from "./healthClient.js";
import { parseClientEnvironment } from "./environment.js";
import { createApiClient } from "./sessionApi.js";
import { parseHashRoute, routeHash, type AppRoute } from "./route.js";
import { getScenarioCatalog, scenarioById, scenarioCatalog, scenarioFocus, scenarioTitle } from "./scenarioCatalog.js";
import { useBrowserAudio } from "./audio/useBrowserAudio.js";
import { BrowserAudioPanel } from "./components/BrowserAudioPanel.js";
import { RealVoiceTurnPanel } from "./components/RealVoiceTurnPanel.js";
import { ConversationPanel } from "./components/ConversationPanel.js";
import { isScenarioRuntimeEligible } from "@vaccine/scenario-schema";

const publicEnvironment = parseClientEnvironment({
  VITE_PUBLIC_APP_NAME: import.meta.env.VITE_PUBLIC_APP_NAME,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});

type TurnTelemetry = Pick<TurnApiResponse, "branch" | "response">;

function meanLatency(session: SafeSession | null): number | null {
  const values = session?.timelineEvents.flatMap((event) => event.responseLatency ? [event.responseLatency.valueMs] : []) ?? [];
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function terminalState(session: SafeSession | null): boolean {
  if (session?.runtimeMode === "REAL_CONVERSATION") return ["COMPLETED", "STOPPED", "ERROR"].includes(session.conversation?.phase ?? "");
  return Boolean(session && (session.state === "COMPLETED" || session.state === "ENDED_BY_LEARNER"));
}

export function App() {
  const api = useMemo(() => createApiClient(publicEnvironment.VITE_API_BASE_URL), []);
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute(typeof window === "undefined" ? "" : window.location.hash));
  const [health, setHealth] = useState<ApiHealthResponse | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [session, setSession] = useState<SafeSession | null>(null);
  const [localDrafts, setLocalDrafts] = useState<LocalScenarioDraft[]>([]);
  const [lastTurn, setLastTurn] = useState<TurnTelemetry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function navigate(next: AppRoute) {
    window.location.hash = routeHash(next);
  }

  function registerLocalDraft(draft: LocalScenarioDraft) {
    setLocalDrafts((current) => {
      const next = current.filter((item) => item.scenario.scenario_id !== draft.scenario.scenario_id);
      return [...next, draft];
    });
    navigate({ page: "scenarios" });
  }

  async function checkHealth() {
    try { setHealth(await fetchApiHealth(publicEnvironment.VITE_API_BASE_URL)); }
    catch { setHealth(null); }
    finally { setHealthChecked(true); }
  }

  useEffect(() => {
    const onHashChange = () => setRoute(parseHashRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    void checkHealth();
    const sessionId = window.sessionStorage.getItem("vv.active-session-id");
    if (sessionId) void api.getSession(sessionId).then(setSession).catch(() => window.sessionStorage.removeItem("vv.active-session-id"));
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [api]);

  useEffect(() => {
    if ((route.page === "live" || route.page === "debrief") && route.sessionId && session?.sessionId !== route.sessionId) {
      void api.getSession(route.sessionId).then(setSession).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Session could not be loaded."));
    }
  }, [api, route, session?.sessionId]);

  async function startSimulation(scenarioId: string, runtimeMode: "MOCK" | "REAL_STT" | "REAL_CONVERSATION" = "MOCK") {
    const scenario = scenarioById(scenarioId);
    if (!scenario) { setError("That training scenario is not available."); return; }
    setBusy(true); setError(null);
    try {
      const created = await api.createDemoSession({ scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
        language: runtimeMode !== "MOCK" ? "hi-IN" : scenario.language ?? "pending-verification",
        ...(runtimeMode !== "MOCK" ? { runtimeMode } : {}) });
      window.sessionStorage.setItem("vv.active-session-id", created.sessionId);
      const consented = await api.grantConsent(created.sessionId);
      setSession(consented); setLastTurn(null);
      navigate({ page: "live", sessionId: consented.sessionId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The demo session could not be started."); }
    finally { setBusy(false); }
  }

  async function submitTurn(text: string, timingFixture?: AudioTimingFixture) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const result = await api.submitMockTurn(session.sessionId, text, timingFixture);
      // Keep only response metadata in the UI state; the transient transcript is discarded.
      setLastTurn({ branch: result.branch, response: result.response }); setSession(result.session);
      if (result.branch.terminalState) navigate({ page: "debrief", sessionId: result.session.sessionId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The mock turn could not be processed."); }
    finally { setBusy(false); }
  }

  async function endSimulation() {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const ended = terminalState(session) && session.runtimeMode !== "REAL_CONVERSATION" ? session : await api.endSession(session.sessionId);
      setSession(ended);
      navigate({ page: "debrief", sessionId: ended.sessionId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The session could not be ended."); }
    finally { setBusy(false); }
  }

  const page = renderPage({
    route, health, healthChecked, session, localDrafts, lastTurn, busy, error, api,
    onClearError: () => setError(null),
    onNavigate: navigate,
    onRegisterDraft: registerLocalDraft,
    onStart: (scenarioId) => navigate({ page: "precall", scenarioId }),
    onStartConfirmed: startSimulation,
    onSubmitTurn: submitTurn,
    onEnd: endSimulation,
    onRefreshHealth: checkHealth,
    onRealTurn: (result) => { setSession(result.turn.session); setLastTurn({ branch: result.turn.branch, response: result.turn.response }); },
    onSession: setSession,
    onConversationFinished: (ended) => { setSession(ended); navigate({ page: "debrief", sessionId: ended.sessionId }); },
  });

  return <AppShell route={route} health={health}>
    <div className="global-disclosure"><span className="disclosure-pulse" /><strong>SIMULATION</strong><i /> FICTIONAL CONTENT <i /> {session?.runtimeMode === "REAL_CONVERSATION" ? "AI-GENERATED CALLER VOICE" : "CALLER MODE SHOWN IN SESSION"} <span className="disclosure-tail">DEVELOPMENT MODE</span></div>
    {error && <div className="global-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}
    {page}
  </AppShell>;
}

interface PageProps {
  route: AppRoute;
  health: ApiHealthResponse | null;
  healthChecked: boolean;
  session: SafeSession | null;
  localDrafts: LocalScenarioDraft[];
  lastTurn: TurnTelemetry | null;
  busy: boolean;
  error: string | null;
  api: ReturnType<typeof createApiClient>;
  onClearError: () => void;
  onNavigate: (route: AppRoute) => void;
  onRegisterDraft: (draft: LocalScenarioDraft) => void;
  onStart: (scenarioId: string) => void;
  onStartConfirmed: (scenarioId: string, runtimeMode?: "MOCK" | "REAL_STT" | "REAL_CONVERSATION") => Promise<void>;
  onRealTurn: (result: RealVoiceTurnResult) => void;
  onSession: (session: SafeSession) => void;
  onConversationFinished: (session: SafeSession) => void;
  onSubmitTurn: (text: string, timingFixture?: AudioTimingFixture) => Promise<void>;
  onEnd: () => Promise<void>;
  onRefreshHealth: () => Promise<void>;
}

function renderPage(props: PageProps) {
  const { route } = props;
  if (route.page === "dashboard") return <DashboardPage {...props} />;
  if (route.page === "scenarios") return <ScenarioLibraryPage {...props} />;
  if (route.page === "scenario") return <ScenarioReviewPage {...props} scenarioId={route.scenarioId} />;
  if (route.page === "authoring") return <AuthoringPage api={props.api} onRegisterDraft={props.onRegisterDraft} />;
  if (route.page === "sessions") return <SessionHistoryPage {...props} />;
  if (route.page === "precall") return <PreCallPage {...props} scenarioId={route.scenarioId} />;
  if (route.page === "live") return <LiveCallPage {...props} sessionId={route.sessionId} />;
  if (route.page === "debrief") return <DebriefPage {...props} sessionId={route.sessionId} />;
  return null;
}

function DashboardPage(props: PageProps) {
  const { session, health, healthChecked, onNavigate, onStart, onRefreshHealth, busy } = props;
  const latency = meanLatency(session);
  const latestBehavior = session?.behaviorHistory.at(-1)?.label;
  const activeCount = session && !terminalState(session) ? 1 : 0;
  return <div className="page-stack">
    <div className="page-heading dashboard-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SECURITY TRAINING COMMAND CENTER</div><h1>Practice the pause.<br /><em>Build the instinct.</em></h1><p>Simulated calls with observable behavioral feedback. Demo sessions stay inside a draft-safe fallback boundary.</p></div>
      <div className="heading-actions"><button className="button button-outline" onClick={() => onNavigate({ page: "authoring" })}><Sparkles size={16} /> Create scenario</button><button className="button button-primary" onClick={() => onStart("S-01")} disabled={busy}>Start training <ArrowRight size={16} /></button></div></div>
    <section className="hero-panel">
      <div className="hero-copy"><span className="hero-kicker"><span className="pulse-dot" /> VOICE SECURITY · SIMULATED</span><h2>Recognize pressure<br />before it becomes a decision.</h2><p>Practice with fictional scenarios. Review timing, interruption, verification, and behavior signals from each turn.</p>
        <div className="hero-actions"><button className="button button-primary" onClick={() => onStart("S-01")} disabled={busy}><Play size={15} fill="currentColor" /> Begin a simulation</button><button className="text-action" onClick={() => onNavigate({ page: "scenarios" })}>Explore scenarios <ChevronRight size={15} /></button></div>
        <div className="hero-proof"><span><ShieldCheck size={16} /> Dummy data only</span><span><LockKeyhole size={14} /> Recording off in demo</span><span><Activity size={15} /> Observable signals</span></div>
      </div>
      <div className="hero-visual"><VoiceSecurityCore activity="idle" />
        <div className="float-card float-latency"><span className="float-icon"><Timer size={15} /></span><div><small>RESPONSE LATENCY</small><strong>{latency === null ? "—" : `${Math.round(latency)} ms`}</strong></div><i>SESSION</i></div>
        <div className="float-card float-pressure"><span className="float-icon float-icon-gold"><Gauge size={15} /></span><div><small>PRESSURE TRACK</small><strong>{session ? `${session.currentPressureLevel}/${session.maxPressureLevel}` : "Awaiting session"}</strong></div><i>MOCK</i></div>
        <div className="float-card float-behavior"><span className="float-icon float-icon-green"><UserCheck size={15} /></span><div><small>LAST OBSERVED</small><strong>{latestBehavior?.replaceAll("_", " ") ?? "No response yet"}</strong></div></div>
        <div className="visual-index">VV / 01 <span>LOCAL SIGNAL CORE</span></div>
      </div>
    </section>
    <section className="metric-grid" aria-label="Training metrics">
      <MetricCard label="Training scenarios" value={String(scenarioCatalog.length)} detail={`${scenarioCatalog.length} draft source packages`} icon={BookOpenCheck} tone="orange" />
      <MetricCard label="Runtime eligible" value={String(scenarioCatalog.filter((item) => item.lifecycle_status === "RUNTIME_ELIGIBLE" && item.review_status === "approved").length)} detail="Current catalog · shared schema" icon={ShieldCheck} tone="green" />
      <MetricCard label="Active demo session" value={String(activeCount)} detail="In-memory · not persisted" icon={Radio} tone="gold" />
      <MetricCard label="Mean response latency" value={latency === null ? "—" : `${Math.round(latency)} ms`} detail={latency === null ? "No measured session timing" : "Current session · fixture timing"} icon={Clock3} tone="blue" unknown={latency === null} />
    </section>
    <div className="section-heading"><div><span className="eyebrow">TRAINING LIBRARY</span><h2>Scenario tracks</h2><p>Fictional organizations · draft-safe fallback only</p></div><button className="button button-ghost" onClick={() => onNavigate({ page: "scenarios" })}>View library <ArrowRight size={15} /></button></div>
    <div className="scenario-grid scenario-grid-home">{scenarioCatalog.slice(0, 3).map((scenario, index) => <ScenarioCard key={scenario.scenario_id} scenario={scenario} featured={index === 0} onOpen={() => onNavigate({ page: "scenario", scenarioId: scenario.scenario_id })} onStart={() => onStart(scenario.scenario_id)} />)}</div>
    <section className="process-panel"><div className="section-heading"><div><span className="eyebrow">HOW THE SIMULATION WORKS</span><h2>A bounded practice loop</h2></div><span className="process-label"><Radio size={14} /> DETERMINISTIC · MOCK</span></div>
      <div className="process-track">{[
        { number: "01", title: "Select scenario", detail: "Fictional training content", Icon: BookOpenCheck },
        { number: "02", title: "Respond", detail: "Typed mock input", Icon: Mic2 },
        { number: "03", title: "Review signals", detail: "Timing + behavior facts", Icon: Activity },
        { number: "04", title: "Verify safely", detail: "End or use a known channel", Icon: ShieldCheck },
      ].map(({ number, title, detail, Icon }) => <div className="process-step" key={number}><div className="process-node"><span>{number}</span><Icon size={16} /></div><strong>{title}</strong><small>{detail}</small></div>)}</div>
    </section>
    <div className="dashboard-footnotes"><span><Info size={14} /> This workspace uses mock providers; there is no live voice stream.</span><button type="button" onClick={() => void onRefreshHealth()} disabled={busy || !healthChecked}>{health ? `API ${health.status.toUpperCase()} · ${health.environment.toUpperCase()}` : "Retry API connection"}<RefreshCw size={13} /></button></div>
  </div>;
}

function ScenarioLibraryPage({ onNavigate, onStart, localDrafts }: PageProps) {
  const allScenarios = getScenarioCatalog(localDrafts);
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow"><BookOpenCheck size={14} /> SCENARIO LIBRARY</div><h1>Training scenarios</h1><p>Inspect the structured source content and its review state before starting a metadata-only demo.</p></div><button className="button button-primary" onClick={() => onNavigate({ page: "authoring" })}><Sparkles size={16} /> Create scenario</button></div>
    <div className="library-toolbar"><span><span className="tiny-dot" /> {allScenarios.length} scenario records · {localDrafts.length} local draft{localDrafts.length === 1 ? "" : "s"}</span><span>Local drafts are in-memory only</span></div>
    <div className="scenario-grid">{allScenarios.map((scenario) => <ScenarioCard key={scenario.scenario_id} scenario={scenario} isLocalDraft={localDrafts.some((draft) => draft.scenario.scenario_id === scenario.scenario_id)} onOpen={() => onNavigate({ page: "scenario", scenarioId: scenario.scenario_id })} onStart={() => onStart(scenario.scenario_id)} />)}</div>
    <div className="note-banner"><ShieldAlert size={17} /><div><strong>Draft content is not caller dialogue</strong><span>These source packages are not runtime eligible. Demo sessions use the system-safe fallback and do not play caller audio.</span></div></div>
  </div>;
}

function ScenarioReviewPage({ scenarioId, onNavigate, onStart, localDrafts }: PageProps & { scenarioId: string }) {
  const localDraft = localDrafts.find((draft) => draft.scenario.scenario_id === scenarioId);
  const scenario = localDraft?.scenario ?? scenarioById(scenarioId);
  const [selectedNodeId, setSelectedNodeId] = useState(scenario?.nodes[0]?.id ?? "");
  if (localDraft) return <LocalDraftReview draft={localDraft} onBack={() => onNavigate({ page: "scenarios" })} />;
  if (!scenario) return <EmptyState icon={CircleHelp} title="Scenario not found" text="Choose a scenario from the library." action="Back to library" onAction={() => onNavigate({ page: "scenarios" })} />;
  const selectedNode = scenario.nodes.find((node) => node.id === selectedNodeId) ?? scenario.nodes[0];
  const selectedResponse = selectedNode ? scenario.responses[selectedNode.response_id] : undefined;
  return <div className="page-stack">
    <button className="back-link" onClick={() => onNavigate({ page: "scenarios" })}><ChevronLeft size={16} /> Scenario library</button>
    <div className="page-heading scenario-detail-heading"><div><div className="eyebrow">{scenario.scenario_id} <i>·</i> VERSION {scenario.version}</div><h1>{scenarioTitle(scenario)}</h1><p>{scenarioFocus(scenario)}</p></div><span className="status-badge status-draft">DRAFT · FALLBACK ONLY</span></div>
    <div className="review-overview"><div className="review-overview-main"><div className="review-meta-line"><span>FICTIONAL ORGANIZATION</span><strong>{scenario.fictional_organization.name}</strong><span className="fictional-chip"><ShieldCheck size={13} /> TRAINING ONLY</span></div><p>{scenario.safety_constraints[0]}</p><div className="scenario-tags">{scenario.red_flag_ids.map((flag) => <span key={flag}>{flag}</span>)}</div></div>
      <div className="review-status-card"><span className="eyebrow">RUNTIME GATE</span><LockKeyhole size={21} /><strong>NOT ELIGIBLE</strong><small>Human review and provider language/voice checks are incomplete.</small></div></div>
    <div className="review-layout">
      <section className="panel tree-panel"><div className="panel-heading"><div><span className="eyebrow">SCENARIO TREE</span><h2>Conversation steps</h2></div><span className="panel-count">{scenario.nodes.length} nodes</span></div>
        <div className="scenario-tree">{scenario.nodes.map((node, index) => <button type="button" className={`tree-node ${selectedNode?.id === node.id ? "tree-node-selected" : ""}`} key={node.id} onClick={() => setSelectedNodeId(node.id)}>
          <span className="tree-node-index">{String(index + 1).padStart(2, "0")}</span><span className="tree-node-copy"><strong>{node.id}</strong><small>{node.parent_node_id ? `Follows ${node.parent_node_id}` : "Entry node"}</small></span><span className="status-badge status-draft">{node.branch_status.toUpperCase()}</span>
        </button>)}</div>
        <div className="tree-legend"><span><i className="legend-dot legend-draft" /> Draft node</span><span><i className="legend-dot legend-safe" /> System-safe fallback</span></div>
      </section>
      <section className="panel node-inspector"><div className="panel-heading"><div><span className="eyebrow">NODE INSPECTOR</span><h2>{selectedNode?.id ?? "No node"}</h2></div><span className="status-badge status-draft">NOT APPROVED</span></div>
        {selectedNode && <><div className="pressure-unset"><div><span className="eyebrow">PRESSURE LEVEL</span><strong>Not configured</strong><small>This source tree has no approved adaptive pressure pool.</small></div><PressureScale level={0} label="Unconfigured pressure placeholder" /></div>
          <div className="inspector-field"><span>CALLER RESPONSE REFERENCE</span><strong>{selectedNode.response_id}</strong><p>{selectedResponse?.text ?? "Response content is unavailable."}</p><span className={`status-badge ${selectedResponse?.safety_status === "system_safe_template" ? "status-safe" : "status-draft"}`}>{selectedResponse?.safety_status === "system_safe_template" ? "SYSTEM SAFE TEMPLATE" : "DRAFT PLACEHOLDER"}</span></div>
          <div className="inspector-field"><span>EXPECTED LEARNER BEHAVIOR</span>{selectedNode.learner_expected_behavior.map((behavior) => <p key={behavior}>{behavior}</p>)}</div>
          <div className="inspector-field"><span>SAFE FALLBACK</span><strong>{selectedNode.safe_fallback_response_id}</strong></div>
          <div className="inspector-field"><span>SAFETY CONSTRAINTS</span>{selectedNode.safety_constraints.map((constraint) => <p key={constraint}>{constraint}</p>)}</div>
          <div className="inspector-actions"><button className="button button-primary" onClick={() => onStart(scenario.scenario_id)}>Preview safe demo <Play size={14} /></button><span>Text input only · no caller audio</span></div></>}
      </section>
      <aside className="panel safety-inspector"><div className="panel-heading"><div><span className="eyebrow">REVIEW INSPECTOR</span><h2>Safety & metadata</h2></div><ShieldAlert size={18} /></div>
        <div className="safety-inspector-list"><div><span>CONTENT STATUS</span><strong><span className="status-dot dot-draft" /> {scenario.lifecycle_status}</strong></div><div><span>REVIEW STATUS</span><strong>{scenario.review_status.toUpperCase()}</strong></div><div><span>LANGUAGE</span><strong>{scenario.language ?? "Pending verification"}</strong></div><div><span>VOICE</span><strong>{scenario.voice_id ?? "Not configured"}</strong></div><div><span>ADAPTIVE TACTICS</span><strong>{scenario.adaptive_policy?.tactics.length ?? 0} configured</strong></div><div><span>SIMULATION LABEL</span><strong className="text-safe">{scenario.safety_metadata?.visible_simulation_label ? "Required" : "Not specified"}</strong></div></div>
        <div className="safety-lock-note"><LockKeyhole size={15} /><span>Draft nodes cannot enter normal runtime. Only the system-safe fallback is available in demo sessions.</span></div>
      </aside>
    </div>
  </div>;
}

function PreCallPage({ scenarioId, onNavigate, onStartConfirmed, busy }: PageProps & { scenarioId: string }) {
  const scenario = scenarioById(scenarioId);
  const [consented, setConsented] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState<"MOCK" | "REAL_STT" | "REAL_CONVERSATION">("MOCK");
  if (!scenario) return <EmptyState icon={CircleHelp} title="Scenario not found" text="Choose a current training scenario first." action="Open library" onAction={() => onNavigate({ page: "scenarios" })} />;
  return <div className="precall-wrap">
    <button className="back-link" onClick={() => onNavigate({ page: "scenarios" })}><ChevronLeft size={16} /> Back to scenarios</button>
    <div className="precall-header"><div className="eyebrow"><span className="pulse-dot" /> REQUIRED BEFORE SESSION</div><h1>Know what this<br /><em>simulation is.</em></h1><p>Review the safety details before entering a training session.</p></div>
    <div className="precall-layout"><section className="panel scenario-brief-card"><div className="precall-disclosure-visual"><VoiceSecurityCore compact activity="idle" /><div className="precall-badges"><span className="status-badge status-draft">{runtimeMode === "REAL_CONVERSATION" ? "AUTOMATIC · MAXIMUM 3 TURNS" : runtimeMode === "REAL_STT" ? "REAL STT · ONE TURN" : "MOCK PRACTICE"}</span><span className="status-badge status-ai">AI-GENERATED VOICE · SIMULATION</span></div></div>
      <div className="scenario-brief-content"><span className="eyebrow">{scenario.scenario_id} · {scenario.version}</span><h2>{scenarioTitle(scenario)}</h2><p>{scenarioFocus(scenario)}</p><div className="brief-details"><span><small>ORGANIZATION</small><strong>Fictional training content</strong></span><span><small>LANGUAGE</small><strong>{scenario.language ?? "Pending verification"}</strong></span><span><small>SESSION LENGTH</small><strong>Not measured</strong></span></div></div>
    </section><section className="panel consent-panel"><div className="panel-heading"><div><span className="eyebrow">SAFETY BRIEFING</span><h2>Before you begin</h2></div><ShieldCheck size={20} /></div>
      {import.meta.env.DEV && scenario.scenario_id === "S-01" && <div className="fixture-controls">
        <label><input type="radio" name="runtime-mode" checked={runtimeMode === "MOCK"} onChange={() => { setRuntimeMode("MOCK"); setConsented(false); }} /> Mock typing</label>
        <label><input type="radio" name="runtime-mode" checked={runtimeMode === "REAL_STT"} onChange={() => { setRuntimeMode("REAL_STT"); setConsented(false); }} /> REAL STT · one hi-IN voice turn</label>
        <label><input type="radio" name="runtime-mode" checked={runtimeMode === "REAL_CONVERSATION"} onChange={() => { setRuntimeMode("REAL_CONVERSATION"); setConsented(false); }} /> Automatic S-01 conversation · maximum 3 learner turns</label>
        {runtimeMode === "REAL_CONVERSATION" && <p>Approved AI-generated caller audio plays automatically. Your microphone streams learner turns transiently to Prisma. A safe ending finishes playback before the debrief opens.</p>}
        {runtimeMode === "REAL_STT" && <p>{isScenarioRuntimeEligible(scenario) && scenario.language === "hi-IN" && scenario.adaptive_policy
          ? "Audio will stream transiently to Prisma after separate microphone consent. Caller playback remains a mock cue."
          : "Blocked: approved S-01 Hindi/Hinglish runtime content is required. The current draft remains unavailable for real turns."}</p>}
      </div>}
      <ul className="disclosure-list"><li><span><CheckCircle2 size={17} /></span><div><strong>Simulated security-awareness call</strong><small>{runtimeMode === "REAL_CONVERSATION" ? "Automatic approved caller playback and up to three real learner turns." : runtimeMode === "REAL_STT" ? "One real learner transcription turn. Choose approved AI-generated caller audio or the labeled mock cue on the next screen." : "This session is a mock practice flow. No caller voice is played."}</small></div></li><li><span><CheckCircle2 size={17} /></span><div><strong>Fictional organization</strong><small>{scenario.fictional_organization.name} is fictional and marked training-only.</small></div></li><li><span><AlertTriangle size={17} /></span><div><strong>Dummy information only</strong><small>Never enter a real OTP, PIN, password, account number, or personal identifier.</small></div></li><li><span><LockKeyhole size={17} /></span><div><strong>No audio recording is retained</strong><small>{runtimeMode !== "MOCK" ? "Microphone consent is required separately before audio streams to Prisma. This application does not retain raw audio." : "Typed input drives the mock session. An optional development microphone check requires separate confirmation and discards audio after processing."}</small></div></li></ul>
      <label className="consent-check"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>{runtimeMode !== "MOCK"
        ? "I understand this is a simulation, will use only DUMMY-0000 format dummy information, and consent to this real transcription training session."
        : "I understand this is a simulation, will use dummy information only, and consent to this typed mock training session."}</span></label>
      <button className="button button-primary button-wide" type="button" onClick={() => void onStartConfirmed(scenario.scenario_id, runtimeMode)} disabled={!consented || busy || (runtimeMode !== "MOCK" && (!isScenarioRuntimeEligible(scenario) || scenario.language !== "hi-IN" || !scenario.adaptive_policy))}>{busy ? "Preparing session…" : "Start simulation"}<ArrowRight size={16} /></button>
      <p className="consent-version">CONSENT IS RECORDED BY THE LOCAL SESSION API · SESSION AUDIO RETENTION: NONE</p>
    </section></div>
  </div>;
}

function LiveCallPage({ session, lastTurn, sessionId, health, busy, onNavigate, onSubmitTurn, onEnd, onRealTurn, onSession, onConversationFinished, api }: PageProps & { sessionId: string }) {
  const [text, setText] = useState("");
  const [useFixture, setUseFixture] = useState(false);
  const [noResponse, setNoResponse] = useState(false);
  const canUseFixtures = health?.environment === "development" || health?.environment === "test";
  const currentSession = session?.sessionId === sessionId ? session : null;
  const conversationMode = currentSession?.runtimeMode === "REAL_CONVERSATION";
  const realMode = currentSession?.runtimeMode === "REAL_STT" || conversationMode;
  const realStop = useRef<(() => void) | null>(null);
  const audioEnabled = import.meta.env.DEV && canUseFixtures && !realMode;
  const audio = useBrowserAudio(currentSession, api, audioEnabled);
  const audioState = audio.diagnostics?.state;
  const scenario = scenarioById(currentSession?.scenarioId);
  const lastEvent = currentSession?.timelineEvents.at(-1);
  if (!currentSession) return <LoadingState title="Loading session telemetry" text="Reading the safe session projection from the local API." />;
  const completed = terminalState(currentSession);
  const activity: VoiceActivity = audioState === "ERROR" ? "error" : audioState === "SPEECH_ACTIVE" ? "speaking"
    : audioState === "LISTENING" || audioState === "CALIBRATING" ? "listening" : busy ? "processing" : currentSession.terminalState === "SAFE_VERIFIED" ? "safe" : "idle";
  const endWithAudioCleanup = () => { audio.stop(); realStop.current?.(); void onEnd(); };
  async function sendTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noResponse && !text.trim()) return;
    audio.stop();
    const fixture: AudioTimingFixture | undefined = noResponse
      ? { noResponse: true, callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1_000 }
      : useFixture ? { callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1_000, learnerSpeechStartedAtMs: 1_450, learnerSpeechEndedAtMs: 2_200 } : undefined;
    await onSubmitTurn(noResponse ? "" : text, fixture);
    setText(""); setNoResponse(false);
  }
  return <div className="page-stack live-page">
    <div className="live-topline"><div className="live-labels"><span className="status-badge status-draft"><span className="status-pulse" /> SIMULATION</span><span className="status-badge status-ai">{realMode ? "AI-GENERATED VOICE · SIMULATION" : "AI-GENERATED VOICE · NOT PLAYED"}</span><span className="session-id">SESSION {currentSession.sessionId.slice(0, 8).toUpperCase()}</span></div><button className="button button-danger" onClick={endWithAudioCleanup} disabled={completed && !realMode}><Square size={13} fill="currentColor" /> End simulation</button></div>
    <div className="live-heading"><div><span className="eyebrow">{scenario?.scenario_id ?? "TRAINING"} / {conversationMode ? "AUTOMATIC · MAXIMUM 3 TURNS" : realMode ? "REAL STT · ONE TURN" : "MOCK CALL CONSOLE"}</span><h1>{scenario ? scenarioTitle(scenario) : "Training session"}</h1><p>{completed ? "Simulation ended. Review the structured session debrief." : realMode ? "Prisma learner transcription · existing deterministic policy · caller mode selected below" : "Draft-safe practice loop · typed learner input · no caller audio"}</p></div><div className="live-state"><span className={`state-light ${completed ? "state-ended" : ""}`} /><div><span>SESSION STATE</span><strong>{currentSession.state.replaceAll("_", " ")}</strong></div></div></div>
    {completed && <div className="terminal-banner"><ShieldCheck size={20} /><div><strong>{currentSession.terminalState?.replaceAll("_", " ") ?? "SESSION ENDED"}</strong><span>Safe session boundary reached. No more learner input will be accepted.</span></div><button className="button button-outline button-small" onClick={() => onNavigate({ page: "debrief", sessionId })}>Open debrief <ArrowRight size={14} /></button></div>}
    <div className="live-console-grid"><section className="panel live-visual-panel"><div className="live-visual-top"><span><span className="pulse-dot" /> VOICE TELEMETRY</span><span>{realMode ? "REAL STT · CALLER MODE BELOW" : "MOCK · NON-PLAYABLE"}</span></div><VoiceSecurityCore activity={activity} />
      <div className="call-state-caption"><div className={`call-state-icon ${busy ? "call-state-processing" : ""}`}>{busy ? <Activity size={17} /> : <Mic2 size={17} />}</div><div><strong>{busy ? "Processing mock turn" : completed ? "Simulation complete" : audioState === "SPEECH_ACTIVE" ? "Local speech activity" : audioState === "LISTENING" ? "Microphone listening" : audioState === "CALIBRATING" ? "Calibrating microphone" : "Typed response ready"}</strong><span>{busy ? "Classifier and deterministic policy are running" : audioEnabled ? `Microphone: ${audioState?.replaceAll("_", " ") ?? "IDLE"}` : "Microphone check is development-only"}</span></div></div>
      <div className="live-audio-note"><Headphones size={15} /><span>Caller playback mode and local timing are shown in Voice response below. Mock mode remains non-playable.</span></div>
    </section><section className="panel live-telemetry-panel"><div className="panel-heading"><div><span className="eyebrow">SESSION TELEMETRY</span><h2>Observable signals</h2></div><span className="demo-tag">DEMO</span></div>
      <div className="telemetry-grid"><div className="telemetry-cell"><span>PRESSURE</span><PressureScale level={currentSession.currentPressureLevel} max={currentSession.maxPressureLevel} /></div><div className="telemetry-cell"><span>TURN</span><strong className="mono-large">{String(currentSession.turnNumber).padStart(2, "0")}<small> / {currentSession.maxTurns}</small></strong></div><div className="telemetry-cell"><span>BEHAVIOR</span><strong className="behavior-pill">{lastEvent?.behavior.label.replaceAll("_", " ") ?? "NOT OBSERVED"}</strong></div><div className="telemetry-cell"><span>RESPONSE LATENCY</span><strong className="mono-large">{lastEvent?.responseLatency ? `${Math.round(lastEvent.responseLatency.valueMs)} ms` : "—"}</strong><small>{lastEvent?.responseLatency ? `source ${lastEvent.responseLatency.source.toLowerCase()}` : "No timing fixture"}</small></div><div className="telemetry-cell"><span>INTERRUPTION</span><strong>{lastEvent?.interruption.status.replaceAll("_", " ") ?? "UNKNOWN"}</strong></div><div className="telemetry-cell"><span>BASELINE</span><strong>{lastEvent?.baselineSpeechRateWpm ? `${Math.round(lastEvent.baselineSpeechRateWpm)} WPM` : "INSUFFICIENT DATA"}</strong></div></div>
      <div className="telemetry-current"><span className="telemetry-current-dot" /> CURRENT TACTIC <strong>{currentSession.currentTacticId ?? "SYSTEM-SAFE FALLBACK"}</strong></div>
    </section></div>
    <div className="live-input-layout"><section className="panel learner-input-panel"><div className="panel-heading"><div><span className="eyebrow">LEARNER INPUT</span><h2>What would you say?</h2></div><span className="input-mode"><AudioLines size={14} /> TYPED MOCK</span></div>
      <div className="mock-prompt"><span className="prompt-mark">SIM</span><p>{scenario?.opening_line ?? "This is a training simulation."}</p><small>Source opening line · {scenario?.lifecycle_status ?? "DRAFT"}</small></div>
      {!realMode && <form onSubmit={(event) => void sendTurn(event)}><label htmlFor="learner-response">Your response <span>Use dummy data only</span></label><textarea id="learner-response" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder={noResponse ? "No response is selected for this turn." : "Type a response to the simulated call…"} disabled={busy || completed || noResponse} rows={3} />
        {canUseFixtures && <details className="fixture-details"><summary><Activity size={14} /> Development timing fixtures <ChevronDown size={14} /></summary><div className="fixture-controls"><label><input type="checkbox" checked={useFixture} onChange={(event) => setUseFixture(event.target.checked)} disabled={noResponse} /> Attach fixed local timing sample</label><span>Caller ends at 1,000 ms; speech begins at 1,450 ms. Synthetic fixture only.</span><label><input type="checkbox" checked={noResponse} onChange={(event) => { setNoResponse(event.target.checked); if (event.target.checked) setUseFixture(false); }} disabled={busy || completed} /> Simulate no response</label></div></details>}
        <div className="input-footer"><span><LockKeyhole size={13} /> Input is sent to the local mock API for this turn only.</span><button className="button button-primary" type="submit" disabled={busy || completed || (!noResponse && !text.trim())}>{busy ? "Analyzing…" : noResponse ? "Submit no-response turn" : "Submit response"}<ArrowRight size={15} /></button></div>
      </form>}
    </section><section className="panel live-safety-panel"><div className="panel-heading"><div><span className="eyebrow">SESSION CONTROL</span><h2>Safety always visible</h2></div><ShieldAlert size={18} /></div>
      <p>{realMode ? <>A recognized <kbd>stop simulation</kbd> phrase uses the safe-word policy after transcription. End simulation stops the microphone immediately.</> : <>Type <kbd>stop simulation</kbd> to trigger the configured safe-word path immediately. Submitting a turn also stops microphone capture.</>}</p><div className="hard-stop-row"><span><CircleStop size={16} /> End now</span><button className="button button-danger-soft button-small" onClick={endWithAudioCleanup} disabled={completed && !realMode}>End simulation <Square size={12} /></button></div>
      <div className="safety-status-row"><CheckCircle2 size={15} /><span>Microphone requires explicit preparation and consent</span></div><div className="safety-status-row"><CheckCircle2 size={15} /><span>No audio retained by default</span></div><div className="safety-status-row"><AlertCircle size={15} /><span>Scenario remains {currentSession.scenarioRuntimeStatus.toLowerCase()}</span></div>
    </section></div>
    {audioEnabled && <BrowserAudioPanel key={`${sessionId}:${currentSession.turnNumber}`} diagnostics={audio.diagnostics} disabled={busy || completed || currentSession.consent.status !== "granted"} onPrepare={() => { void audio.prepare(); }} onStop={audio.stop} onFinish={() => { void audio.finish(); }} onPlay={audio.playMockCaller} />}
    {currentSession.runtimeMode === "REAL_STT" && <RealVoiceTurnPanel key={sessionId} session={currentSession} api={api} onResult={onRealTurn} stopControl={realStop} />}
    {conversationMode && <ConversationPanel key={sessionId} session={currentSession} api={api} onTurn={onRealTurn} onSession={onSession} onFinished={onConversationFinished} stopControl={realStop} />}
    <section className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">TURN-BY-TURN EVENT LOG</span><h2>Pressure curve</h2></div><span className="panel-count">{currentSession.pressureTimeline.length} events</span></div><PressureTimeline points={currentSession.pressureTimeline} compact /></section>
    {lastTurn && <details className="panel turn-detail"><summary><FileAudio2 size={15} /> Last API turn metadata <ChevronDown size={14} /></summary><div className="turn-detail-grid"><span>Response ID <strong>{lastTurn.branch.responseId}</strong></span><span>Policy <strong>{lastTurn.branch.policyDecisionCode}</strong></span><span>Cache <strong>{lastTurn.response.cacheHit ? "HIT" : "MISS"}</strong></span><span>Playable <strong>{String(lastTurn.response.playable)}</strong></span><span>TTS media type <strong>{lastTurn.response.mediaType}</strong></span></div></details>}
  </div>;
}

function DebriefPage({ session, sessionId, onNavigate }: PageProps & { sessionId: string }) {
  const currentSession = session?.sessionId === sessionId ? session : null;
  if (!currentSession) return <LoadingState title="Loading debrief" text="Reading the session events from the local API." />;
  const debrief = currentSession.pressureDebrief;
  if (currentSession.runtimeMode === "REAL_CONVERSATION" && !terminalState(currentSession)) return <LoadingState title="Conversation still active" text="Return to the live session. The final debrief becomes available after terminal playback ends or the session stops." />;
  const average = meanLatency(currentSession);
  const verificationCount = currentSession.timelineEvents.filter((event) => event.behavior.label === "VERIFIED_INDEPENDENTLY").length;
  const firstCompliance = debrief?.firstComplianceMoment ?? null;
  const completedSafely = currentSession.terminalState === "SAFE_VERIFIED" || currentSession.terminalState === "SAFE_WORD" || currentSession.terminalState === "LEARNER_ENDED";
  return <div className="page-stack">
    {currentSession.runtimeMode === "REAL_CONVERSATION" && <div className="note-banner"><strong>{debrief?.completionKind === "complete" ? "Complete conversation" : "Partial debrief — session stopped before normal completion"}</strong><span>{currentSession.conversation?.failureCode ?? "Canonical committed learner events only."}</span></div>}
    <div className="debrief-hero"><div><span className="eyebrow"><span className="eyebrow-line" /> POST-SIMULATION REVIEW</span><h1>Session <em>debrief</em></h1><p>Observable evidence from {currentSession.timelineEvents.length} turn{currentSession.timelineEvents.length === 1 ? "" : "s"}. No emotion labels or inferred traits.</p></div><div className={`debrief-outcome ${completedSafely ? "outcome-safe" : "outcome-review"}`}><span>{completedSafely ? <ShieldCheck size={23} /> : <Activity size={23} />}</span><div><small>SESSION OUTCOME</small><strong>{currentSession.terminalState?.replaceAll("_", " ") ?? (currentSession.conversation?.failureCode ? "TECHNICAL STOP" : "ENDED BY LEARNER")}</strong></div></div></div>
    <section className="metric-grid debrief-metrics"><MetricCard label="Turns observed" value={String(currentSession.turnNumber)} detail="Structured learner-turn events" icon={AudioLines} tone="orange" /><MetricCard label="Mean response latency" value={average === null ? "—" : `${Math.round(average)} ms`} detail={average === null ? "No local timing captured" : "Measured turns only · session-local"} icon={Timer} tone="gold" unknown={average === null} /><MetricCard label="Independent verification" value={String(verificationCount)} detail="Observable verification labels" icon={UserCheck} tone="green" /><MetricCard label="Compliance moment" value={firstCompliance ? "Observed" : "None observed"} detail={firstCompliance ? `Turn ${firstCompliance.turnId.split("turn-").at(-1)} · segment-level, approximate` : "Synthetic detector only"} icon={AlertTriangle} tone={firstCompliance ? "orange" : "blue"} /></section>
    <div className="debrief-layout"><section className="panel timeline-panel debrief-timeline"><div className="panel-heading"><div><span className="eyebrow">CONVERSATION EVENT FLOW</span><h2>Pressure & response timeline</h2></div><span className="panel-count">SESSION-LOCAL</span></div><PressureTimeline points={debrief?.pressureTimeline ?? []} /></section>
      <aside className="panel debrief-insights"><div className="panel-heading"><div><span className="eyebrow">OBSERVABLE SUMMARY</span><h2>What the events show</h2></div><Activity size={17} /></div>
        <div className="insight-block"><span>RECOMMENDED NEXT BEHAVIOR</span><p>{debrief?.recommendedNextBehavior ?? "Pause and verify through an independently known official channel."}</p></div>
        <div className="insight-block"><span>OBSERVABLE SCORING</span><div className="score-display"><strong>{debrief?.observableScoring.pointsAwarded ?? 0}<small> / {debrief?.observableScoring.pointsPossible ?? 5}</small></strong><span>Evidence-backed points only</span></div>
          <ul className="evidence-list">{debrief?.observableScoring.evidence.map((evidence) => <li key={evidence}><Check size={13} />{evidence.replaceAll("_", " ")}</li>)}</ul>
        </div>
        {debrief?.observableScoring.unavailableRubricItems.length ? <div className="unavailable-evidence"><span>NOT OBSERVED</span>{debrief.observableScoring.unavailableRubricItems.map((item) => <p key={item}>{item}</p>)}</div> : null}
        {firstCompliance && <div className="compliance-insight"><AlertTriangle size={17} /><div><strong>Dummy-secret moment</strong><span>Within segment {firstCompliance.segmentIndex}; position is approximate. Synthetic test patterns only.</span></div></div>}
        <div className="debrief-privacy"><LockKeyhole size={14} /><span>Debrief uses structured event facts. Raw audio is not stored; transcripts are not kept in the event log.</span></div>
      </aside></div>
    <section className="panel session-summary-panel"><div className="panel-heading"><div><span className="eyebrow">TURN SUMMARIES</span><h2>Event evidence</h2></div><span className="panel-count">{currentSession.timelineEvents.length} rows</span></div>
      {debrief?.reviewedEntries?.map((entry) => <article key={entry.turnId}><strong>{entry.turnId.split(":").at(-1)}</strong><p>{entry.text}</p></article>)}
      {debrief?.turnSummaries.length ? <div className="summary-table-wrap"><table className="summary-table"><thead><tr><th>Turn</th><th>Pressure</th><th>Behavior</th><th>Latency</th><th>Silence</th><th>Speech rate</th><th>Interruption</th></tr></thead><tbody>{debrief.turnSummaries.map((row, index) => <tr key={row.turnId}><td className="mono-cell">{String(index + 1).padStart(2, "0")}</td><td><PressureScale level={row.callerPressureLevel} /></td><td>{row.learnerBehavior.label.replaceAll("_", " ")}</td><td>{row.responseLatencyMs === null ? "Not captured" : `${Math.round(row.responseLatencyMs)} ms`}</td><td>{row.preSpeechSilenceMs === null ? "Not captured" : `${Math.round(row.preSpeechSilenceMs)} ms`}</td><td>{row.speechRateWpm === null ? "Not measured" : `${Math.round(row.speechRateWpm)} WPM`}</td><td>{row.interruption.replaceAll("_", " ")}</td></tr>)}</tbody></table></div> : <div className="empty-inline">No learner turn events were recorded in this session.</div>}
    </section>
    <div className="debrief-actions"><button className="button button-outline" onClick={() => onNavigate({ page: "sessions" })}>Session history <ArrowRight size={15} /></button><button className="button button-primary" onClick={() => onNavigate({ page: "precall", scenarioId: currentSession.scenarioId })}>Practice again <RefreshCw size={15} /></button></div>
  </div>;
}

function SessionHistoryPage({ session, onNavigate }: PageProps) {
  if (!session) return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow"><Activity size={14} /> SESSION INSPECTION</div><h1>Session history</h1><p>Current API storage is in-memory and does not retain history across restarts.</p></div></div><EmptyState icon={Radio} title="No active session" text="Start a simulation to inspect its event timeline and debrief." action="Choose a scenario" onAction={() => onNavigate({ page: "scenarios" })} /></div>;
  const scenario = scenarioById(session.scenarioId);
  return <div className="page-stack"><div className="page-heading"><div><div className="eyebrow"><Activity size={14} /> SESSION INSPECTION</div><h1>Session history</h1><p>Only the current in-memory mock session is available. No persistent history endpoint is configured.</p></div><span className="status-badge status-ai">IN-MEMORY DEMO</span></div>
    <article className="session-history-card"><div className="session-history-mark"><AudioLines size={22} /></div><div className="session-history-main"><span className="mono-eyebrow">{session.sessionId}</span><h2>{scenario ? scenarioTitle(scenario) : session.scenarioId}</h2><p>{scenario ? scenarioFocus(scenario) : "Scenario details unavailable."}</p><div className="session-history-tags"><span>{session.state.replaceAll("_", " ")}</span><span>{session.turnNumber} turn{session.turnNumber === 1 ? "" : "s"}</span><span>{session.scenarioRuntimeStatus}</span><span>Consent {session.consent.status}</span></div></div><div className="session-history-actions"><button className="button button-outline button-small" onClick={() => onNavigate(terminalState(session) ? { page: "debrief", sessionId: session.sessionId } : { page: "live", sessionId: session.sessionId })}>{terminalState(session) ? "Open debrief" : "Resume session"}<ArrowUpRight size={14} /></button></div></article>
    <section className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">PRESSURE CURVE</span><h2>Conversation events</h2></div><span className="panel-count">{session.pressureTimeline.length} events</span></div><PressureTimeline points={session.pressureTimeline} /></section>
    <div className="note-banner"><Info size={17} /><div><strong>Storage boundary</strong><span>The API exposes session state while its process is running. Refresh can recover the current session ID for this tab only; raw audio and transcript history are not persisted.</span></div></div>
  </div>;
}

function EmptyState({ icon: Icon, title, text, action, onAction }: { icon: LucideIcon; title: string; text: string; action: string; onAction: () => void }) {
  return <section className="empty-state"><div className="empty-state-icon"><Icon size={23} /></div><h2>{title}</h2><p>{text}</p><button className="button button-primary" onClick={onAction}>{action}<ArrowRight size={15} /></button></section>;
}

function LoadingState({ title, text }: { title: string; text: string }) {
  return <section className="loading-state" role="status"><div className="loading-signal"><AudioLines size={22} /></div><strong>{title}</strong><span>{text}</span><div className="skeleton-line" /><div className="skeleton-line skeleton-short" /></section>;
}
