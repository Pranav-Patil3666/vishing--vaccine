import { Activity, ArrowRight, AudioLines, BookOpenCheck, CircleStop, LockKeyhole, ShieldCheck, UserCheck } from "lucide-react";
import type { SafeSession } from "@vaccine/contracts";
import type { ScenarioDocument } from "@vaccine/scenario-schema";
import { MetricCard } from "../components/MetricCard.js";
import { PressureTimeline } from "../components/PressureTimeline.js";
import { trainingTitle } from "../scenarioCatalog.js";
import { behaviorFeedback, sessionMode, sessionOutcome, sessionStartedAt, sessionStatus, summarizeSessions, tacticLabels, uniqueRecentSessions } from "../trainingResults.js";
import { ScreenMessage, type Navigate } from "./TrainingPages.js";

type ScenarioLookup = (session: SafeSession) => ScenarioDocument | undefined;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function SessionDate({ session }: { session: SafeSession }) {
  const date = sessionStartedAt(session);
  return date ? <time dateTime={date}>{dateFormat.format(new Date(date))}</time> : <span>Time unavailable</span>;
}

function titleFor(session: SafeSession, lookup: ScenarioLookup) {
  const scenario = lookup(session);
  return scenario ? trainingTitle(scenario) : session.scenarioId;
}

type ResultsProps = {
  sessions: readonly SafeSession[]; loading: boolean; issue: string | null;
  navigate: Navigate; refresh: () => void; lookup: ScenarioLookup;
};

function resultGroups(sessions: readonly SafeSession[]) {
  const ordered = uniqueRecentSessions(sessions);
  return [
    { title: "Voice practice", records: ordered.filter((session) => session.runtimeMode !== "MOCK") },
    { title: "Offline demonstration", records: ordered.filter((session) => session.runtimeMode === "MOCK") },
  ].filter(({ records }) => records.length > 0);
}

function HistoryNotice({ loading, issue, refresh }: Pick<ResultsProps, "loading" | "issue" | "refresh">) {
  return <>{loading && <p role="status">Loading available session results…</p>}
    {issue && <div className="note-banner" role="status"><Activity size={17} /><div><strong>{issue}</strong>
      <button type="button" className="text-action" onClick={refresh}>Retry session lookup</button></div></div>}</>;
}

function ResultsSummary({ title, records }: { title: string; records: readonly SafeSession[] }) {
  const metrics = summarizeSessions(records);
  return <section className="panel results-summary" aria-label={title}>
    <div className="panel-heading"><h3>{title}</h3><span className="panel-count">{metrics.total} recorded</span></div>
    <div className="result-stat-grid">
      <MetricCard label="Completed" value={String(metrics.completed)} detail="Reached the end of the call" icon={ShieldCheck} tone="green" />
      <MetricCard label="Stopped" value={String(metrics.stopped)} detail="Ended by learner or safe word" icon={CircleStop} tone="gold" />
      <MetricCard label="Independent verification" value={String(metrics.verification)} detail="Recorded terminal decisions" icon={UserCheck} tone="blue" />
      <MetricCard label="Practice token disclosed" value={String(metrics.disclosure)} detail="Synthetic tokens only" icon={AudioLines} />
    </div>
    {metrics.ended > 0 && <div className="outcome-breakdown">
      <h4>Outcome breakdown</h4><p>Each of the {metrics.ended} ended sessions appears once. Sessions still in progress are excluded.</p>
      <ul>{metrics.outcomes.map(([label, count]) => <li key={label}><span>{label}</span>
        {metrics.ended > 1 && <meter min={0} max={metrics.ended} value={count} aria-label={label} />}
        <strong>{count} of {metrics.ended}</strong></li>)}</ul>
    </div>}
    {metrics.behaviors.length > 0 && <details className="outcome-breakdown">
      <summary>Observed decisions and caller tactics</summary>
      <p>Counts are per committed turn. Hearing a tactic does not show that the learner recognized it.</p>
      <h4>Learner decisions</h4><ul>{metrics.behaviors.map(([label, count]) => <li key={label}>{behaviorFeedback[label].label}<strong>{count}</strong></li>)}</ul>
      <h4>Caller tactics</h4>{metrics.tactics.length > 0 ? <ul>{metrics.tactics.map(([label, count]) =>
        <li key={label}>{tacticLabels[label]}<strong>{count}</strong></li>)}</ul> : <p>No adaptive caller tactic was recorded.</p>}
    </details>}
  </section>;
}

export function DashboardPage(props: ResultsProps) {
  const { sessions, loading, navigate } = props;
  const groups = resultGroups(sessions);
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> VOICE SECURITY TRAINING</div>
      <h1>Practice the pause.</h1><p>Practice handling unexpected requests in a fictional call. Review your choices and learn what to do next time.</p></div>
      <button className="button button-primary" type="button" onClick={() => navigate({ page: "scenarios" })}>Start training <ArrowRight size={16} /></button></div>
    <section className="panel product-intro"><div><h2>Practice, review, improve</h2>
      <p>Learners practice on approved scenarios. Trainers inspect fictional drafts, safety findings and the review history before publication.</p></div>
      <button className="button button-outline" type="button" onClick={() => navigate({ page: "authoring" })}>Open scenario authoring <ArrowRight size={15} /></button></section>
    <div className="section-heading"><div><span className="eyebrow">THIS BROWSER TAB</span><h2>Training outcomes</h2>
      <p>Recent sessions from the running local API. Offline demonstrations are counted separately.</p></div>
      <button className="button button-ghost" type="button" onClick={() => navigate({ page: "sessions" })}>Session history <ArrowRight size={15} /></button></div>
    <HistoryNotice {...props} />
    {!groups.length && !loading && <ScreenMessage title="No recorded sessions yet" action="Choose a scenario" onAction={() => navigate({ page: "scenarios" })}>Finish a practice call to see its outcome and debrief here.</ScreenMessage>}
    {groups.map((group) => <ResultsSummary key={group.title} title={group.title} records={group.records} />)}
  </div>;
}

export function SessionHistoryPage(props: ResultsProps) {
  const { sessions, loading, navigate, lookup } = props;
  const groups = resultGroups(sessions);
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow"><Activity size={15} /> TRAINING RESULTS</div><h1>Session history</h1>
      <p>Up to 20 recent sessions in this browser tab. Results are available while the local API is running.</p></div>
      <button className="button button-outline" type="button" onClick={() => navigate({ page: "dashboard" })}>View outcomes <ArrowRight size={15} /></button></div>
    <HistoryNotice {...props} />
    {!groups.length && !loading && <ScreenMessage title="No session results available" action="Choose a scenario" onAction={() => navigate({ page: "scenarios" })}>Complete or stop a practice call to add its results. The API clears session data on restart.</ScreenMessage>}
    {groups.map(({ title, records }) => <section className="panel session-summary-panel" key={title}>
      <div className="panel-heading"><h2>{title}</h2><span className="panel-count">{records.length} sessions</span></div>
      <div className="summary-table-wrap"><table className="summary-table">
        <thead><tr>{["Started", "Scenario", "Status", "Outcome", "Turns", "Details"].map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{records.map((record) => <tr key={record.sessionId}>
          <td><SessionDate session={record} /></td>
          <td>{titleFor(record, lookup)} <small className="record-version">{record.scenarioId} · v{record.scenarioVersion}</small></td>
          <td>{sessionStatus(record)}</td><td>{sessionOutcome(record)}</td><td>{record.timelineEvents.length}</td>
          <td>{sessionStatus(record) === "In progress" ? "Awaiting result" : <button className="text-action" type="button"
            onClick={() => navigate({ page: "debrief", sessionId: record.sessionId })}>Open debrief <ArrowRight size={14} /></button>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>)}
  </div>;
}

export function DebriefPage({ session, lookup, canPractice, navigate }: {
  session: SafeSession; lookup: ScenarioLookup; canPractice: boolean; navigate: Navigate;
}) {
  const events = session.timelineEvents;
  const status = sessionStatus(session);
  const debrief = session.pressureDebrief?.sessionId === session.sessionId
    && session.pressureDebrief.sourceTurnIds.length === events.length
    && session.pressureDebrief.sourceTurnIds.every((id, index) => id === events[index]?.turnId) ? session.pressureDebrief : null;
  const strengths = events.flatMap((event, index) => behaviorFeedback[event.behavior.label].coaching === "strength" ? [index] : []);
  const practice = events.flatMap((event, index) => behaviorFeedback[event.behavior.label].coaching === "practice" ? [index] : []);
  const tactics = [...new Set(events.flatMap((event) => event.callerTacticCategory ? [event.callerTacticCategory] : []))];
  const notes = status === "Stopped" ? "This call stopped before a normal ending. The debrief uses any committed turns."
    : status === "Technical stop" ? "The call could not finish. The debrief uses any committed turns."
    : session.terminalState === "MAX_TURNS" ? "The practice reached its planned turn limit."
    : session.terminalState === "SAFE_FALLBACK" ? "The system ended practice with a safe response when it could not choose a more specific continuation."
    : session.terminalState === "SAFE_VERIFIED" ? "The learner response indicated a decision to verify independently."
    : session.terminalState === "DUMMY_SECRET_DISCLOSED" ? "The session detected a synthetic practice token." : null;
  return <div className="page-stack">
    <div className="debrief-hero"><div><span className="eyebrow"><span className="eyebrow-line" /> POST-SIMULATION REVIEW</span>
      <h1>Session debrief</h1><p>{titleFor(session, lookup)} · {session.scenarioId} v{session.scenarioVersion}</p></div>
      <div className="debrief-outcome outcome-review"><span><ShieldCheck size={23} /></span>
        <div><small>{status.toUpperCase()}</small><strong>{sessionOutcome(session)}</strong></div></div></div>
    <div className="library-toolbar debrief-facts"><span>{sessionMode(session)}</span><span>{events.length} committed turn{events.length === 1 ? "" : "s"}</span>
      <span>Started <SessionDate session={session} /></span></div>
    {notes && <p className="debrief-note">{notes}</p>}
    <div className="debrief-layout">
      <section className="panel session-summary-panel" aria-label="What happened">
        <div className="panel-heading"><h2>What happened</h2><span className="panel-count">{events.length} turn{events.length === 1 ? "" : "s"}</span></div>
        {events.length ? <ol className="decision-list">{events.map((event, index) => {
          const feedback = behaviorFeedback[event.behavior.label];
          const reviewed = debrief?.reviewedEntries?.find((entry) => entry.turnId === event.turnId);
          return <li key={event.turnId}><div className="decision-heading"><span>Turn {index + 1}</span><strong>{feedback.label}</strong></div>
            <p>{feedback.evidence}</p>
            {event.callerTacticCategory && <small>Caller presented {tacticLabels[event.callerTacticCategory].toLowerCase()}.</small>}
            {reviewed && <details><summary>Reviewed feedback</summary><p>{reviewed.text}</p></details>}</li>;
        })}</ol> : <p className="empty-inline">No learner turn was committed. There is no behavior or scoring evidence to review.</p>}
        <div className="encountered-tactics"><h3>Tactics encountered</h3>{tactics.length
          ? <ul className="scenario-tags">{tactics.map((tactic) => <li key={tactic}>{tacticLabels[tactic]}</li>)}</ul>
          : <p>No adaptive caller tactic was recorded in the committed turns.</p>}</div>
      </section>
      <aside className="panel debrief-insights">
        <div className="panel-heading"><h2>What to do next time</h2><BookOpenCheck size={19} /></div>
        <p>{debrief?.recommendedNextBehavior ?? "Pause on an unexpected call. End it and use an official contact you already know before taking action."}</p>
        {strengths.length > 0 && <div className="insight-block"><h3>What you handled well</h3><ul>{strengths.map((index) =>
          <li key={index}>Turn {index + 1} · {behaviorFeedback[events[index]!.behavior.label].label}</li>)}</ul></div>}
        {practice.length > 0 && <div className="insight-block"><h3>What to practice</h3><ul>{practice.map((index) =>
          <li key={index}>Turn {index + 1} · {behaviorFeedback[events[index]!.behavior.label].evidence}</li>)}</ul></div>}
        <div className="debrief-privacy"><LockKeyhole size={15} /><span>Based on committed turn events. The event log contains no raw microphone audio or transcript history.</span></div>
      </aside>
    </div>
    {events.length > 0 && <details className="panel debrief-evidence"><summary>Turn evidence and pressure timeline</summary>
      <PressureTimeline points={session.pressureTimeline} />
      {debrief && <p>Observable rubric: {debrief.observableScoring.pointsAwarded} / {debrief.observableScoring.pointsPossible} points. Only recorded evidence is scored.</p>}
      {session.runtimeRelease && <p className="release-fingerprint">Pinned package {session.runtimeRelease.packageHash}</p>}
    </details>}
    <div className="debrief-actions">
      <button className="button button-outline" type="button" onClick={() => navigate({ page: "sessions" })}>Session history <ArrowRight size={15} /></button>
      <button className="button button-primary" type="button" onClick={() => navigate(canPractice ? { page: "precall", scenarioId: session.scenarioId } : { page: "scenarios" })}>{canPractice ? "Practice again" : "Back to training"} <ArrowRight size={15} /></button>
    </div>
  </div>;
}
