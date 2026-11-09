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

The runtime catalog uses fingerprint-bound canonical content and verified successful publication entries. Local authoring records stay in their separate store. DRAFT, pending review and runtime-ineligible status are enforced independently of structural validation. Existing human review and runtime promotion still require named approval, timestamp, checklist evidence, and matching scenario/version. See the [Phase 6A evidence and walkthrough](../evidence/phase6a-mock-authoring-import.md).

Phase 6B extends the existing validation command and preview with deterministic consolidated findings. `validateAuthoringDraft` checks current schema, content, references, pressure, graph, learning metadata and saved-record integrity. `canSubmitForSafetyReview` recomputes the result and requires matching content, validator version and configured-policy hash. Imported reports never authorize review by themselves. Phase 6C calls this gate before accepting a review request and before approval. See the [rule reference](authoring-validation-rules.md) and [Phase 6B evidence](../evidence/phase6b-safety-schema-validation.md).

Phase 6C adds an explicit local review workflow around the saved draft. `LocalReviewStore` adopts the unchanged record, assigns author ownership, submits an immutable snapshot, records a distinct assigned reviewer's checklist and individual warning decisions, and requires explicit approval. The authoring approval envelope reuses `ScenarioReview` while retaining the original DRAFT source record. It cannot fabricate the verified voice required by the runtime release contract. Approval therefore remains separate from runtime eligibility and publication.

```text
saved DRAFT → submit + fresh validation → SAFETY_REVIEW
  → explicit complete current human review → APPROVED authoring artifact (runtimeEligible false)
  → separate publisher request → compatibility gate → PUBLISHED or PUBLICATION_BLOCKED

SAFETY_REVIEW → reject / request changes → DRAFT with rejected review history
existing version → explicit revision → new DRAFT + parent link + fresh validation + no inherited decisions
```

Privileged mutation uses `authoring:review` in a local terminal. Actors/roles are configured in ignored `content/authoring/review-registry/actors.json`. Local OS access is the trust boundary; author/reviewer/publisher separation is enforced by the service. This is not externally authenticated IAM. No review-write API exists. The Authoring page verifies a captured workflow export, displays complete content and history, and downloads operation proposals. CLI apply commits; refresh the export afterward.

Each immutable journal commit contains both the resulting item and audit events, with hash chaining and exclusive next-sequence file publication. Expected hash/state/sequence reject stale races; operation ID plus request/actor binding makes identical retries idempotent. A failed revision journal commit may leave an unregistered DRAFT in the existing cache; retry reuses that exact staged revision. This is not an atomic transaction spanning draft and registry directories. Restart tests reinstantiate the stores from disk. Hashes and local roles do not defend against an OS owner rewriting files or policy. Back up both stores together.

Every checklist decision is bound to review ID and content hash with actor/timestamp/reason. Mandatory items require PASS; optional translation NOT_APPLICABLE requires a reason. Each warning has its ruleId/path identity and separate disposition. Completing decisions does not approve automatically. Revisions never inherit approval or warning acceptance. Rejection/change requests preserve the original snapshot and append history.

The current real-conversation target retains the protected S-01/hi-IN path. Phase 6D adds an explicit typed-practice publication target with a compiler that verifies the authored graph against the existing policy. It commits successful packages to the same journal that records compatibility blocks. S-92's approved source and historical block are preserved. See the [runtime boundary](runtime-content-boundary.md) and the [Phase 6C acceptance record](../evidence/phase6c-human-review-approval.md).

## Phase 6E generator seam

The CLI brief may explicitly select `runtimeProfile: "offline-adaptive-v1"`. That selects the authoring-only `OfflineAdaptiveMockGenerator` and records generator v1.1.0 under the same template family and template v1.0.0. The draft keeps the template's 15 authored variants and narrows the reachable continuation responses to the existing medium-intensity lines. The profile uses a common safe-ending line where the typed-practice compiler requires it. With the field omitted, the original v1.0.0 generator and default output are preserved. Both outputs are pending drafts. Approval and separate compatible publication are required for typed practice.

`E2E-FAKE-ADAPTER` implements the existing `ScenarioDraftGenerator` interface in a disposable test. It returns the same canonical `AuthoringCandidate` contract and is imported as `MANUAL_IMPORT` with an unverified test-origin declaration. The test proves that it has the same review, publication and runtime gates as the mock generator. The development mock endpoint remains a local stub. [Phase 6E acceptance](../evidence/phase6e-end-to-end-acceptance.md)

## Proposed future adapter

An asynchronous boundary belongs in the server-side authoring CLI or a dedicated authoring worker. It wraps the current sync mock if a common entry point is useful. The adapter returns bounded untrusted UTF-8 bytes for the existing `AuthoringCandidate` schema v1, which wraps `DraftScenarioPackage`. A validated draft uses the existing store and Phase 6B validator. A future adapter may be described with this interface sketch.

```ts
interface AuthoringGenerator {
  readonly identity: { kind: string; adapterVersion: string; languages: readonly string[]; outputSchemaVersion: 1 };
  generate(input: {
    requestId: string;
    brief: MockDraftBrief;
    signal: AbortSignal;
  }): Promise<{ candidateJson: Uint8Array; observation: GeneratorObservation }>;
}
```

`GeneratorObservation` would be populated by the trusted host boundary. Record the provider identity, observed model name/version where available, adapter version, server timestamp, request ID, canonical brief hash, raw response hash, canonical draft hash after parse, configuration reference with secrets excluded, and the verification state of each attribution. Missing model evidence stays unverified. Existing `DETERMINISTIC_MOCK` and `MANUAL_IMPORT` retain their semantics. Model-supplied provenance remains a declaration. The host assigns any future verified provider-origin type after evidence and schema migration. Review, approval, publication and runtime eligibility are assigned by their existing trusted services.

### Data flow and validation

1. The host validates the brief and constructs structured input from allowed fields. Provide a fictional organization, training objective, audience, difficulty, language/script, maximum turns, tactic allowlist, pressure ceiling, behavior labels, terminal outcomes, synthetic-token formats, red flags, safe actions and required simulation disclosure. The host owns these limits. Treat free text and any separately approved source excerpts as data.
2. Inference may propose metadata, the opening, tactic variants, learner examples, routes, safe endings, observable debriefs and educational annotations. Validate encoding, size, depth and duplicate keys, then run the strict candidate schema, reference checks, credential and fictional-identity scans, language and script rules, graph and pressure checks, terminal checks and observable-scoring checks. The current JSON intake limit is 160 KiB. Match language/profile claims to the host request, and retain human review for semantic or linguistic judgment.
3. The existing pipeline records `DRAFT`, runs deterministic validation, submits a hash-bound snapshot to a human reviewer, requires explicit approval, and requires a separate publisher and compatibility proof. Runtime reads only verified releases. The generation worker receives no review registry write access, published files, session creation capability, Prisma audio, Timbre synthesis credentials or learner recordings.

### Prompt injection and hostile output

Treat brief text, retrieved excerpts and every generated JSON field as untrusted data. Delimit them separately from host instructions. Give the inference worker no tools, privileged filesystem writes or access to the runtime network. Use a narrow inference egress allowlist in any hosted deployment. Reject extra fields, lifecycle/approval claims, runtime eligibility, arbitrary file paths, unsupported behavior or language values, invalid response IDs, unbounded routes, unsafe terminal or coercive content, real institutions, credential requests and fabricated provenance. The generation process does not act on instructions embedded in output. Bounded parsing and policy checks run before review. A named model or a structured-output setting provides no approval authority.

### Failures and operations

Classify unavailable or network failure, timeout, rate limit, authentication failure, unsupported language, user cancellation, empty/truncated/oversized output, parse or schema mismatch, safety failure and duplicate output distinctly. Stop reading at the byte bound and abort on cancellation or deadline. Keep partial output outside candidate storage. Use a request ID and canonical hashes to return the same recorded outcome for an identical accepted attempt. Apply a small explicit retry budget only to approved transient failures, respecting the deadline and rate limit. Invalid or unsafe content gets a sanitized finding and requires an explicit author decision. Authentication, language, cancellation and duplicate results do not trigger automatic generation. Never weaken validators or relabel a mock as provider output on failure. Capture sanitized counters and timings while excluding prompts, generated secrets and credentials from operational logs.

### Privacy and enablement

Use synthetic briefs by default. Minimize and redact names, employee records, identifiers, private contacts and confidential source details before any inference. Source documents require a separately authorized, access-controlled intake and redaction step. Keep credentials server-side in managed secret storage. Limit author, reviewer and publisher access by role. Define data location, transit encryption, retention and deletion for drafts and restricted logs. Before external processing, verify prompt/output retention, provider logging and training defaults, deletion controls, region and any cross-border requirements with the project owner. Vendor capabilities and privacy terms require separate verification.

The available modes are deterministic mock generation and manual import. Real Evon remains unavailable in Phase 6E. A future server-only feature flag should default off and fail closed when identity, authorized deployment, credentials, quotas, regions or bounds are missing. Evaluate a supported local deployment, a controlled self-hosted service and an authorized hosted interface during feasibility. Endpoint availability, licensing, supported languages, hardware, cost and deployment terms remain open.

### Future test plan and rollout

| Stage | Gate |
| --- | --- |
| 1. Feasibility | Establish authorized access and supported deployment. Verify model identity, supported output constraints, cost and privacy terms. |
| 2. Adapter | Add cancellable request mapping, server-only configuration and allowlisted transport under the authoring boundary. |
| 3. Structured output | Test valid/invalid shape, missing/extra fields, schema mismatch, size/encoding limits, language mismatch and unverifiable origin. |
| 4. Safety hardening | Test injection in briefs, source and output, fake approval, credential attempts, real identities, unsafe ends, excess pressure, hallucinated IDs and graph failures. Inject outage, timeout, authentication, throttling and cancellation. Prove bounded retry, duplicate handling and sanitized observability. |
| 5. Review | Run the current Phase 6B and 6C gates on test drafts. Verify immutable review, no bypass and explicit approval. |
| 6. Publication | Exercise the existing publisher, compatibility compiler, release integrity and session pins. Confirm Evon is absent from runtime and S-01 is preserved. |
| 7. Acceptance | With separate authorization, measure actual language quality, generation success, latency, cost and failure rates. Validate adversarial behavior and data handling. |
| 8. Deployment | Enable a narrowly scoped environment only after documented security review and explicit owner authorization. |
