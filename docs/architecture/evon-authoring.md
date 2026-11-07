# Scenario authoring and the runtime boundary

Phase 6A provides deterministic mock-assisted scenario authoring with manual draft import. Future Evon inference can replace the mock generation adapter without changing validation, review, approval or live runtime.

```text
structured brief → DeterministicMockScenarioGenerator ─┐
author-selected UTF-8 JSON → bounded parser ───────────┴→ candidate schema → local DRAFT store → Authoring preview
```

`ScenarioDraftGenerator.generateDraft(brief)` is the offline generator interface. The `fictional-benefits-verification` family v1.0.0 accepts an explicitly supported brief. Its templates supply the fictional organization, premise, department, five tactic categories, intensity variants, safe actions and endings. The brief selects the working title, scenario ID, draft version, audience, difficulty, training emphasis, caller script and two or three learner decisions. Change the template version when changing its authored content. A future inference adapter would return the same candidate structure for the same intake checks.

The Phase 6A input envelope adds `schemaVersion: 1` and authoring-only `details` around the existing `DraftScenarioPackage`. The package still owns the scenario, review, tactic pool, responses, examples, debrief templates and importable artifact. Details reference those IDs for authored intensity, example interpretation, safe actions, behavior routes and observable scoring. The existing scenario and runtime release validators retain their rules. The old development mock API and S-01 review fixtures remain compatibility surfaces.

The terminal CLI owns all writes. It accepts an explicit local file, bounds reads at 160 KiB, checks UTF-8 and JSON structure, and validates the draft package and its internal references. Incompatible approval claims are rejected. Manual import verifies the ingestion source and records any `declaredOrigin` as unverified metadata. Configured organization, credential and operational-phrase patterns provide a basic intake filter. Human semantic, linguistic and safety review remains required.

Saved records live in the ignored `.cache/authoring/` directory. Their filenames use the verified ingestion source and canonical content hash. A synced staging file and exclusive hard link make the record visible as a whole and prevent duplicate writes. Later revisions can reference an existing candidate with the same scenario ID and a different version. The Authoring page reads a user-selected saved record, revalidates its structure and verifies its hash in the browser. Use localhost or another secure browser context for Web Crypto.

The simulation catalog reads `content/scenarios/`. Local authoring records stay in their separate store. DRAFT, pending review and runtime-ineligible status are enforced independently of structural validation. Existing human review and runtime promotion still require named approval, timestamp, checklist evidence, and matching scenario/version. See the [Phase 6A evidence and walkthrough](../evidence/phase6a-mock-authoring-import.md).
