import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, LockKeyhole, Radio, WandSparkles } from "lucide-react";
import { ScenarioBriefSchema, type ScenarioBrief } from "@vaccine/contracts";
import type { ApiClient } from "../sessionApi.js";
import { normalizeMockDraft, type LocalScenarioDraft } from "../authoringDraft.js";

const availableRedFlags = ["RF-01", "RF-02", "RF-03", "RF-04", "RF-05", "RF-06", "RF-07", "RF-08"] as const;

export function AuthoringPage({ api, onRegisterDraft }: { api: ApiClient; onRegisterDraft: (draft: LocalScenarioDraft) => void }) {
  const [brief, setBrief] = useState<ScenarioBrief>({
    scenarioId: "S-90",
    learningObjective: "Practice recognizing urgency and verifying a request through an independently known channel.",
    redFlags: ["RF-01", "RF-02"],
    language: "hi-en",
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const request = ScenarioBriefSchema.parse({ ...brief, language: "hi-en" });
      const generated = await api.generateMockDraft(request);
      onRegisterDraft(normalizeMockDraft(generated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mock authoring request failed.");
    } finally {
      setGenerating(false);
    }
  }

  function updateBrief<K extends keyof ScenarioBrief>(key: K, value: ScenarioBrief[K]) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  return <div className="page-stack">
    <div className="page-heading">
      <div><div className="eyebrow"><WandSparkles size={14} /> OFFLINE CONTENT WORKFLOW</div><h1>Scenario authoring</h1><p>Create a structured Hinglish draft with the existing mock authoring adapter. Generated content stays local to this page session.</p></div>
      <span className="provider-chip"><span className="provider-indicator" /> MOCKEVON · LOCAL</span>
    </div>
    <div className="authoring-layout authoring-layout-correction">
      <section className="panel authoring-brief-panel">
        <div className="panel-heading"><div><span className="eyebrow">01 / AUTHORING BRIEF</span><h2>Define the learning objective</h2></div><span className="step-number">01</span></div>
        <form className="authoring-form" onSubmit={(event) => void generateDraft(event)}>
          <label>Scenario ID <input value={brief.scenarioId} onChange={(event) => updateBrief("scenarioId", event.target.value)} maxLength={4} pattern="S-[0-9]{2}" title="Use an ID such as S-90" required disabled={generating} /></label>
          <label>Learning objective <textarea value={brief.learningObjective} onChange={(event) => updateBrief("learningObjective", event.target.value)} rows={4} maxLength={400} required disabled={generating} /></label>
          <label>Content language<select value="hi-en" disabled aria-label="Content language"><option value="hi-en">Hinglish / code-mixed</option></select></label>
          <fieldset className="flag-fieldset"><legend>Relevant red-flag IDs</legend><div className="flag-grid">{availableRedFlags.map((flag) => <label key={flag} className="check-chip"><input type="checkbox" checked={brief.redFlags.includes(flag)} onChange={(event) => updateBrief("redFlags", event.target.checked ? [...brief.redFlags, flag] : brief.redFlags.filter((item) => item !== flag))} /><span>{flag}</span></label>)}</div></fieldset>
          <p className="form-note"><LockKeyhole size={14} /> Pressure levels are derived from the mock policy maximum. Caller lines, credentials, and review decisions are not accepted as free-form runtime commands.</p>
          <button className="button button-primary button-wide" type="submit" disabled={generating}><WandSparkles size={17} /> {generating ? "Preparing local draft…" : "Generate draft"}<ArrowRight size={16} /></button>
        </form>
      </section>
      <section className="panel authoring-result-panel authoring-next-panel">
        <div className="panel-heading"><div><span className="eyebrow">02 / LOCAL LIBRARY ENTRY</span><h2>One draft record</h2></div><span className="status-badge status-draft">DRAFT</span></div>
        {generating ? <div className="authoring-loading"><div className="authoring-pulse"><WandSparkles size={26} /></div><strong>Preparing the Hinglish draft</strong><span>Five tactics · fifteen caller lines · local safety preflight</span><div className="skeleton-line" /><div className="skeleton-line skeleton-short" /></div> : <div className="authoring-empty"><div className="empty-orb"><Radio size={24} /></div><h3>Generated drafts open in the library</h3><p>One in-memory record will appear with its full pressure curve, training examples, debrief templates, and computed safety checks.</p><span>CONTENT DRAFT · REVIEW NOT SUBMITTED</span></div>}
        {error && <div className="inline-error" role="alert"><AlertCircle size={16} />{error}</div>}
      </section>
    </div>
    <div className="note-banner"><Radio size={16} /><div><strong>Local draft only</strong><span>The generated record is held in memory for this page session. It is not persisted, submitted for review, or eligible for a demo call.</span></div></div>
  </div>;
}
