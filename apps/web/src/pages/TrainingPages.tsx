import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowRight, BookOpenCheck, ChevronLeft, CircleStop, LockKeyhole, Mic2, ShieldCheck, Square } from "lucide-react";
import type { ApiHealthResponse, AudioTimingFixture, RealVoiceTurnResult, SafeSession } from "@vaccine/contracts";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { useBrowserAudio } from "../audio/useBrowserAudio.js";
import { BrowserAudioPanel } from "../components/BrowserAudioPanel.js";
import { ConversationPanel } from "../components/ConversationPanel.js";
import { RealVoiceTurnPanel } from "../components/RealVoiceTurnPanel.js";
import { ScenarioCard } from "../components/ScenarioCard.js";
import type { AppRoute } from "../route.js";
import { trainingLanguage, trainingObjective, trainingTitle } from "../scenarioCatalog.js";
import type { ApiClient } from "../sessionApi.js";
import { sessionMode, sessionStatus } from "../trainingResults.js";

export type Navigate = (route: AppRoute) => void;
export type CatalogState =
  | { status: "loading" | "unavailable" }
  | { status: "ready"; scenarios: readonly ScenarioDocument[] };

export function ScreenMessage({ title, children, action, onAction, loading = false, busy = false }: {
  title: string; children: ReactNode; action?: string; onAction?: () => void; loading?: boolean; busy?: boolean;
}) {
  return <section className="empty-state" role={loading ? "status" : undefined}>
    <div className="empty-state-icon" aria-hidden="true"><ShieldCheck size={23} /></div>
    <h2>{title}</h2><p>{children}</p>
    {action && <button className="button button-primary" type="button" onClick={onAction} disabled={busy}>{action} <ArrowRight size={15} /></button>}
  </section>;
}

export function TrainingLibrary({ catalog, navigate, refresh }: { catalog: CatalogState; navigate: Navigate; refresh: () => void }) {
  const choices = catalog.status === "ready" ? [...new Map(catalog.scenarios.map((entry) => [entry.scenario_id, entry])).values()] : [];
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow"><BookOpenCheck size={15} /> LEARNER TRAINING</div>
      <h1>Choose a practice call</h1><p>Practice spotting social engineering in a fictional call, then review what your choices showed.</p></div></div>
    {catalog.status === "loading" && <ScreenMessage title="Checking the training catalog" loading>Looking up scenarios available to play.</ScreenMessage>}
    {catalog.status === "unavailable" && <ScreenMessage title="Training catalog unavailable" action="Retry connection" onAction={refresh}>Check that the local API is running, then try again.</ScreenMessage>}
    {catalog.status === "ready" && choices.length === 0 && <ScreenMessage title="No playable scenarios" action="Refresh catalog" onAction={refresh}>The server has no published training available. You can review draft content in Scenario authoring.</ScreenMessage>}
    {choices.length > 0 && <div className="scenario-grid training-grid">{choices.map((scenario) =>
      <ScenarioCard key={scenario.scenario_id} scenario={scenario} eligible onStart={() => navigate({ page: "precall", scenarioId: scenario.scenario_id })} />)}</div>}
  </div>;
}

export function TrainingBriefing({ scenario, voiceAvailable, busy, navigate, start }: {
  scenario: ScenarioDocument; voiceAvailable: boolean; busy: boolean; navigate: Navigate;
  start: (scenario: ScenarioDocument, mode: SafeSession["runtimeMode"]) => void;
}) {
  const [mode, setMode] = useState<SafeSession["runtimeMode"]>("MOCK");
  const [consented, setConsented] = useState(false);
  const voice = mode !== "MOCK";
  const turns = scenario.adaptive_policy?.max_turns;
  const selectMode = (next: SafeSession["runtimeMode"]) => { setMode(next); setConsented(false); };
  return <div className="precall-wrap">
    <button className="back-link" type="button" onClick={() => navigate({ page: "scenarios" })}><ChevronLeft size={16} /> Back to training</button>
    <div className="page-heading"><div><div className="eyebrow"><span className="pulse-dot" /> FICTIONAL SECURITY TRAINING</div>
      <h1>{trainingTitle(scenario)}</h1><p>{trainingObjective(scenario)}</p></div></div>
    <div className="precall-layout">
      <section className="panel scenario-brief-card briefing-overview">
        <div className="scenario-brief-content"><span className="eyebrow">{scenario.scenario_id} · v{scenario.version}</span>
          <h2>{scenario.fictional_organization.name}</h2><p>A fictional caller may use social pressure to make an unexpected request feel urgent or legitimate.</p>
          <div className="brief-details"><span><small>LANGUAGE</small><strong>{trainingLanguage(scenario)}</strong></span>
            {turns && <span><small>SESSION LIMIT</small><strong>{mode === "REAL_STT" ? "One learner turn" : `Up to ${turns} learner turns`}</strong></span>}</div>
          <div className="note-banner"><ShieldCheck size={18} /><div><strong>Use fictional information only</strong><span>Keep real passwords, OTPs, banking details, and personal information private. Any practice token is synthetic.</span></div></div>
        </div>
      </section>
      <form className="panel consent-panel" onSubmit={(event) => { event.preventDefault(); if (consented && !busy && (!voice || voiceAvailable)) start(scenario, mode); }}>
        <div className="panel-heading"><div><span className="eyebrow">DISCLOSURE AND CONSENT</span><h2>Before you begin</h2></div><ShieldCheck size={20} /></div>
        {voiceAvailable && <fieldset className="practice-modes" disabled={busy}><legend>Practice mode</legend>
          <label><input type="radio" name="practice-mode" checked={mode === "MOCK"} onChange={() => selectMode("MOCK")} /> Offline demonstration · typed practice</label>
          <label><input type="radio" name="practice-mode" checked={mode === "REAL_CONVERSATION"} onChange={() => selectMode("REAL_CONVERSATION")} /> Live voice · automatic conversation</label>
          <details><summary>Other practice options</summary><label><input type="radio" name="practice-mode" checked={mode === "REAL_STT"} onChange={() => selectMode("REAL_STT")} /> Voice transcription · one learner turn</label></details>
        </fieldset>}
        <ul className="briefing-facts">
          <li>{voice ? "The fictional caller may use an AI-synthesized voice." : "Live practice can use an AI-synthesized caller. This offline demonstration displays approved caller text."}</li>
          <li>{voice ? "Browser microphone permission is requested when you explicitly start voice practice. Learner audio is sent to Prisma for transcription. This application does not retain raw microphone audio." : "Typed practice does not use your microphone or play caller audio."}</li>
          <li>Use <strong>End simulation</strong> at any time. Say or type <kbd>stop simulation</kbd> during a learner turn.</li>
          <li>Structured turn results are available while the local API is running.</li>
        </ul>
        <label className="consent-check"><input type="checkbox" checked={consented} disabled={busy} onChange={(event) => setConsented(event.target.checked)} />
          <span>{voice ? "I consent to microphone transcription for this fictional simulation and will use only dummy information." : "I agree to take part in this fictional simulation and will use only dummy information."}</span></label>
        <button className="button button-primary button-wide" type="submit" disabled={!consented || busy || (voice && !voiceAvailable)}>{busy ? "Preparing session…" : "Start simulation"}<ArrowRight size={16} /></button>
        <button className="back-link" type="button" onClick={() => navigate({ page: "scenarios" })}>Decline and return to training</button>
      </form>
    </div>
  </div>;
}

const sampleReplies = [
  ["Ask for time", "I need more time."],
  ["Verify independently", "Main official number par call karke check karunga."],
  ["Decline", "I refuse to share."],
] as const;

function approvedCallerLine(session: SafeSession, scenario: ScenarioDocument | undefined): string | undefined {
  if (!scenario || session.runtimeMode !== "MOCK" || session.mode !== "safe" || !session.runtimeRelease) return;
  const id = session.currentResponseId ?? (session.turnNumber === 0 ? scenario.nodes.find((node) => node.parent_node_id === null)?.response_id : undefined);
  const response = id ? scenario.responses[id] : undefined;
  if (response && response.safety_status !== "draft") return response.text;
}

export function ActiveCall({ session, scenario, api, health, busy, ending, stopControl, onEnd, onSubmit, onSession, onFinished }: {
  session: SafeSession; scenario?: ScenarioDocument; api: ApiClient; health: ApiHealthResponse | null; busy: boolean; ending: boolean;
  stopControl: RefObject<(() => void) | null>; onEnd: () => void; onSubmit: (text: string, timing?: AudioTimingFixture) => Promise<boolean>;
  onSession: (session: SafeSession) => void; onFinished: (session: SafeSession) => void;
}) {
  const [text, setText] = useState("");
  const [useFixture, setUseFixture] = useState(false);
  const realStop = useRef<(() => void) | null>(null);
  const automatic = session.runtimeMode === "REAL_CONVERSATION";
  const offline = session.runtimeMode === "MOCK";
  const finished = sessionStatus(session) !== "In progress";
  const diagnosticsEnabled = Boolean(import.meta.env?.DEV && health?.environment === "development" && offline && !session.runtimeRelease?.publicationId);
  const audio = useBrowserAudio(session, api, diagnosticsEnabled);
  const stopAudio = audio.stop;
  useEffect(() => {
    stopControl.current = () => { stopAudio(); realStop.current?.(); };
    return () => { stopControl.current = null; };
  }, [stopAudio, stopControl]);
  const updateTurn = (result: RealVoiceTurnResult) => onSession(result.turn.session);
  const callerLine = approvedCallerLine(session, scenario);
  const disabled = busy || ending || finished || session.consent.status !== "granted";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !text.trim()) return;
    stopAudio();
    const timing = useFixture ? { callerAudioStartedAtMs: 0, callerAudioEndedAtMs: 1_000,
      learnerSpeechStartedAtMs: 1_450, learnerSpeechEndedAtMs: 2_200 } : undefined;
    if (await onSubmit(text, timing)) setText("");
  }
  return <div className="page-stack live-page">
    <div className="live-topline">
      <div className="live-labels"><span className="status-badge status-draft">SIMULATION</span><span className="status-badge status-ai">{sessionMode(session)}</span></div>
      <button className="button button-danger" type="button" onClick={onEnd} disabled={ending}><Square size={14} fill="currentColor" />{ending ? "Ending simulation…" : finished ? "Open debrief" : "End simulation"}</button>
    </div>
    <div className="live-heading"><div><span className="eyebrow">{session.scenarioId} · FICTIONAL CALLER</span>
      <h1>{scenario?.fictional_organization.name ?? "Training call"}</h1><p>{scenario ? trainingTitle(scenario) : `Scenario ${session.scenarioId}`} · {session.scenarioVersion}</p></div>
      <div className="call-progress" aria-label="Committed learner turns"><strong>{session.timelineEvents.length} / {session.maxTurns}</strong><span>learner turns</span></div>
    </div>
    {automatic && <ConversationPanel session={session} api={api} onSession={onSession} onTurn={updateTurn} onFinished={onFinished} stopControl={realStop} />}
    {session.runtimeMode === "REAL_STT" && <RealVoiceTurnPanel session={session} api={api} onResult={updateTurn} stopControl={realStop} />}
    {offline && <section className="panel learner-input-panel offline-call">
      <div className="panel-heading"><div><span className="eyebrow">OFFLINE DEMONSTRATION · TYPED PRACTICE</span><h2>Practice conversation</h2></div><Mic2 size={20} aria-hidden="true" /></div>
      <p className="offline-call-status" role="status">{ending ? "Ending simulation…" : finished ? sessionStatus(session) : busy ? "Processing your response…" : "Ready for your response"}</p>
      <div className="mock-prompt"><span className="prompt-mark" aria-hidden="true">SIM</span><p>{callerLine ?? "Approved caller text is unavailable for this version."}</p>
        <small>Approved caller text · no caller audio</small></div>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="learner-response">What would you say? <span>Fictional responses only</span></label>
        <textarea id="learner-response" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} disabled={disabled} rows={3} />
        {session.scenarioId === "S-01" && <div className="sample-replies" aria-label="Synthetic reply examples">{sampleReplies.map(([label, value]) =>
          <button key={label} type="button" className="button button-outline button-small" disabled={disabled} onClick={() => setText(value)}>{label}</button>)}</div>}
        {diagnosticsEnabled && <details className="fixture-details"><summary>Development timing</summary>
          <label><input type="checkbox" checked={useFixture} onChange={(event) => setUseFixture(event.target.checked)} disabled={disabled} /> Attach a synthetic timing sample</label></details>}
        <div className="input-footer"><span><LockKeyhole size={14} /> No microphone in typed practice</span>
          <button className="button button-primary" type="submit" disabled={disabled || !text.trim()}>Submit response <ArrowRight size={15} /></button></div>
      </form>
    </section>}
    <div className="note-banner"><CircleStop size={18} /><div><strong>You can stop at any time</strong>
      <span>{offline ? "Type" : "Say during a learner turn"} <kbd>stop simulation</kbd>, or select End simulation.</span></div></div>
    {diagnosticsEnabled && <details className="panel development-audio"><summary>Optional development microphone check</summary>
      <BrowserAudioPanel key={session.turnNumber} diagnostics={audio.diagnostics} disabled={disabled}
        onPrepare={() => { void audio.prepare(); }} onStop={audio.stop} onFinish={() => { void audio.finish(); }} onPlay={audio.playMockCaller} />
    </details>}
  </div>;
}
