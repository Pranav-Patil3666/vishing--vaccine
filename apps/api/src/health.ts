import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiHealthResponseSchema, ConsentRequestSchema, CreateSessionRequestSchema, EndSessionRequestSchema, MockTurnRequestSchema, ScenarioBriefSchema, type ApiHealthResponse, type SpeechRecognizer, type SpeechSynthesizer, type RuntimeCreditReservation } from "@vaccine/contracts";
import { DraftScenarioPackageSchema, isScenarioRuntimeEligible, validateScenarioDocument, validateScenarioSafety, type RuntimeRelease, type ScenarioDocument, type ScenarioSafetyOptions } from "@vaccine/scenario-schema";
import { MockEvonAuthoringAdapter } from "./providers/evon/mockEvon.js";
import { MockPrismaRecognizer } from "./providers/prisma/mockPrisma.js";
import { MockTimbreSynthesizer } from "./providers/timbre/mockTimbre.js";
import { createSessionState, endSession, transitionConsent } from "./session.js";
import { InMemorySessionStore } from "./sessionStore.js";
import { InMemoryRateLimiter } from "./rateLimit.js";
import { TurnOrchestrator } from "./turnOrchestrator.js";
import { ApplicationError, errorResponse } from "./errors.js";
import { debriefForSession } from "./debriefEngine.js";
import type { CreditBudget } from "@vaccine/credit-guard";
import { BrowserAudioIngress } from "./browserAudioIngress.js";
import { RuntimeAudioIngress } from "./runtimeAudioIngress.js";
import { CallerAudioRoutes } from "./callerAudio/routes.js";
import type { CallerAudioService } from "./callerAudio/service.js";
import { applyConversationAction } from "./conversationRuntime.js";
import { requireLocalRuntimeRequest } from "./runtimeAudioIngress.js";
import { conversationDebrief, readConversationTemplates, type ReviewedTemplates } from "./conversationDebrief.js";
import { RuntimeCatalog } from "./runtimeCatalog.js";

export interface HealthServerOptions {
  environment: string;
  version?: string;
  now?: () => Date;
  scenarioDirectory?: string;
  /** Trusted process configuration, never accepted from the learner API. */
  runtimeWorkspace?: string;
  onRuntimeDenial?: (event: { scenarioId: string; scenarioVersion: string; code: string; at: string }) => void;
  budget?: CreditBudget;
  sttUnits?: number;
  ttsUnits?: number;
  sessionStore?: InMemorySessionStore;
  recognizer?: MockPrismaRecognizer;
  runtimeRecognizer?: SpeechRecognizer;
  synthesizer?: SpeechSynthesizer;
  initialTtsUsedUnits?: number;
  callerAudio?: (scenarios: ReadonlyMap<string, ScenarioDocument>, reserve: (sessionId: string) => RuntimeCreditReservation) => CallerAudioService;
}

const CONSENT_VERSION = "training-consent-v1";
const MOCK_LANGUAGE_SENTINEL = "pending-verification";

export function createHealthResponse(options: HealthServerOptions): ApiHealthResponse {
  return ApiHealthResponseSchema.parse({
    status: "ok",
    environment: options.environment,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.version ? { version: options.version } : {}),
  });
}

export function createApiServer(options: HealthServerOptions): Server {
  const workspace = options.runtimeWorkspace ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const catalog = new RuntimeCatalog(workspace);
  if (options.scenarioDirectory && options.environment !== "test") throw new Error("Scenario fixture directories are test-only.");
  const testDirectory = options.scenarioDirectory;
  const templates = new Map<string, ReviewedTemplates>();
  const pins = new Map<string, { publicationId: string | null; packageHash: string; policyVersion: string }>();
  const publishedSessions = new Map<string, { release: RuntimeRelease; pipeline: TurnOrchestrator }>();
  const safeSession = (state: ReturnType<typeof createSessionState>) => ({
    ...projectSafeSession(state, templates.get(`${state.scenarioId}:${state.scenarioVersion}`)),
    ...(pins.has(state.sessionId) ? { runtimeRelease: pins.get(state.sessionId)! } : {}),
  });
  const scenarios = testDirectory ? loadTestScenarios(testDirectory) : catalog.legacyScenarios();
  const store = options.sessionStore ?? new InMemorySessionStore();
  const browserAudio = new BrowserAudioIngress(options.environment, store);
  const pendingTypedTurns = new Map<string, Promise<unknown>>();
  const endingTypedSessions = new Set<string>();
  const apiBudget = options.budget ?? { mode: "development" as const, developmentCap: 100, publicDemoCap: 100, reserveCap: 0, usedUnits: 0 };
  const orchestrator = new TurnOrchestrator({
    store, scenarios,
    recognizer: options.recognizer ?? new MockPrismaRecognizer(),
    synthesizer: options.synthesizer ?? new MockTimbreSynthesizer(),
    budget: apiBudget,
    sttUnits: options.sttUnits ?? 0,
    ttsUnits: options.ttsUnits ?? 0,
    ...(options.initialTtsUsedUnits === undefined ? {} : { initialTtsUsedUnits: options.initialTtsUsedUnits }),
    ...(options.now ? { now: options.now } : {}),
  });
  const createLimiter = new InMemoryRateLimiter({ limit: 5, windowMs: 60_000, now: () => (options.now ?? (() => new Date()))().getTime() });
  const turnLimiter = new InMemoryRateLimiter({ limit: 12, windowMs: 60_000, now: () => (options.now ?? (() => new Date()))().getTime() });
  const callerAudio = new CallerAudioRoutes(options.environment, store, options.callerAudio?.(scenarios, (id) => orchestrator.reserveCallerSynthesis(id)));
  const runtimeAudio = new RuntimeAudioIngress(options.environment, store, scenarios, orchestrator, options.runtimeRecognizer, safeSession, () => Boolean(callerAudio.service));

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const mapped = errorResponse(error);
      sendJson(response, mapped.status, mapped.body);
    });
  });
  server.once("close", () => { runtimeAudio.close(); callerAudio.close(); });
  return server;

  async function verifyPublished(release: RuntimeRelease) {
    const current = (await catalog.published()).find((entry) => entry.publicationId === release.publicationId);
    if (current?.packageHash !== release.packageHash) throw new ApplicationError("INVALID_SCENARIO", "The pinned release is no longer available.");
  }

  async function guardSession(sessionId: string, frame: boolean) {
    const state = store.get(sessionId);
    const pinned = publishedSessions.get(sessionId);
    try {
      if (pinned) await verifyPublished(pinned.release);
      else if (!testDirectory && state.scenarioRuntimeStatus === "RUNTIME_ELIGIBLE") {
        if (state.scenarioId !== "S-01" || !pins.has(sessionId)) throw new ApplicationError("INVALID_SCENARIO", "Session release is unavailable.");
        if (!frame && catalog.legacyRelease().scenario.version !== state.scenarioVersion) throw new ApplicationError("INVALID_SCENARIO", "Session release has changed.");
      }
    } catch (error) {
      browserAudio.cancelSession(sessionId); runtimeAudio.cancelSession(sessionId); callerAudio.cancelSession(sessionId);
      store.update(endSession(store.get(sessionId), (options.now ?? (() => new Date()))()));
      throw error;
    }
  }

  function offlinePipeline(release: RuntimeRelease) {
    const synthesizer = options.environment === "test" && options.synthesizer ? options.synthesizer : new MockTimbreSynthesizer();
    return new TurnOrchestrator({ store, scenarios: new Map([[release.scenario.scenario_id, release.scenario]]),
      recognizer: options.environment === "test" && options.recognizer ? options.recognizer : new MockPrismaRecognizer(),
      synthesizer: { synthesize: async (request) => { await verifyPublished(release); return synthesizer.synthesize(request); } },
      budget: apiBudget, sttUnits: 0, ttsUnits: 0, ...(options.now ? { now: options.now } : {}),
    });
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/api/runtime/scenarios") {
      sendJson(response, 200, { scenarios: await catalog.playable() }); return;
    }
    if (request.method === "GET" && pathname === "/api/runtime/credit") {
      requireLocalRuntimeRequest(request, options.environment);
      sendJson(response, 200, orchestrator.creditDiagnostics()); return;
    }
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, createHealthResponse(options));
      return;
    }
    if (request.method === "POST" && pathname === "/api/authoring/mock") {
      if (options.environment !== "development" && options.environment !== "test") {
        throw new ApplicationError("INVALID_STATE", "Mock authoring is available only in development and test environments.");
      }
      const body = await readBody(request);
      const brief = ScenarioBriefSchema.safeParse(body);
      if (!brief.success) throw new ApplicationError("INVALID_REQUEST", "Authoring brief did not match the shared scenario brief contract.");
      const draft = await new MockEvonAuthoringAdapter().generateDraftScenarioPackage(brief.data);
      sendJson(response, 200, DraftScenarioPackageSchema.parse(draft));
      return;
    }
    if (request.method === "POST" && pathname === "/api/sessions") {
      const startedAt = (options.now ?? (() => new Date()))();
      rate(createLimiter, request);
      const body = await readBody(request);
      const parsed = CreateSessionRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "Session request did not match the allowed configuration.");
      const input = parsed.data;
      try { await startSession(input, startedAt, response); }
      catch (error) {
        const identity = /^S-\d{2}$/u.test(input.scenarioId) ? input.scenarioId : "invalid";
        const version = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-draft)?$/u.test(input.scenarioVersion) ? input.scenarioVersion : "invalid";
        const event = { scenarioId: identity, scenarioVersion: version, code: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR", at: startedAt.toISOString() };
        options.onRuntimeDenial?.(event);
        throw error;
      }
      return;
    }

    const scoped = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/.*)?$/u);
    if (scoped && !/\/(?:end|cancel)$/u.test(pathname)) await guardSession(decodeURIComponent(scoped[1]!), pathname.endsWith("/frame"));

    async function startSession(input: import("@vaccine/contracts").CreateSessionRequest, startedAt: Date, response: ServerResponse) {
      let scenario = scenarios.get(input.scenarioId);
      const release = scenario ? undefined : (await catalog.published()).find((entry) =>
        entry.scenario.scenario_id === input.scenarioId && entry.scenario.version === input.scenarioVersion);
      scenario ??= release?.scenario;
      if (!scenario) throw new ApplicationError("SCENARIO_NOT_FOUND", "Scenario was not found.");
      if (scenario.version !== input.scenarioVersion || scenario.simulation !== true) throw new ApplicationError("INVALID_SCENARIO", "Scenario version or simulation metadata is invalid.");
      const runtimeEligible = isScenarioRuntimeEligible(scenario);
      if (input.runtimeMode !== "MOCK" && (input.demoMode || scenario.scenario_id !== "S-01" || input.language !== "hi-IN"
        || !runtimeEligible || !scenario.adaptive_policy || !["development", "test"].includes(options.environment))) {
        throw new ApplicationError("INVALID_SCENARIO", "Real STT requires approved runtime-eligible S-01 hi-IN content.");
      }
      if (runtimeEligible) {
        if (!scenario.language || input.language !== scenario.language) throw new ApplicationError("INVALID_SCENARIO", "Language is not approved for this scenario.");
        if (input.voiceId !== undefined && input.voiceId !== scenario.voice_id) throw new ApplicationError("INVALID_SCENARIO", "Voice is not approved for this scenario.");
      } else {
        if (!input.demoMode || scenario.language !== null || input.language !== MOCK_LANGUAGE_SENTINEL || input.voiceId !== undefined) {
          throw new ApplicationError("INVALID_SCENARIO", "Draft scenarios can only run the explicitly limited metadata-only mock fallback.");
        }
      }
      const canonical = runtimeEligible && !release && !testDirectory ? catalog.legacyRelease() : undefined;
      if (canonical && canonical.scenario.version !== scenario.version) throw new ApplicationError("INVALID_SCENARIO", "Runtime version has changed.");
      if (input.runtimeMode === "REAL_CONVERSATION") templates.set(`${scenario.scenario_id}:${scenario.version}`,
        canonical?.templates ?? readConversationTemplates(resolve(workspace, "content/authoring/S-01-hi-IN.package.json"), scenario));
      const initial = createSessionState({
        sessionId: randomUUID(), scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
        language: input.language, startingNodeId: scenario.nodes.find((node) => node.parent_node_id === null)?.id ?? "start",
        consentVersion: CONSENT_VERSION,
        mode: input.demoMode && !release ? "demo" : "safe",
        runtimeMode: input.runtimeMode,
        scenarioRuntimeStatus: scenario.lifecycle_status,
        maxPressureLevel: scenario.adaptive_policy?.max_pressure_level ?? 5,
        maxTurns: scenario.adaptive_policy?.max_turns ?? 12,
      });
      const endedAt = (options.now ?? (() => new Date()))();
      const rootResponseId = scenario.nodes.find((node) => node.parent_node_id === null)?.response_id;
      const openingTactic = input.runtimeMode !== "MOCK" ? scenario.adaptive_policy?.tactics.find((tactic) => tactic.response_ids.includes(rootResponseId ?? "")) : undefined;
      const state = { ...initial,
        ...(input.runtimeMode !== "MOCK" ? { currentResponseId: rootResponseId ?? null, currentTacticId: openingTactic?.tactic_id ?? null,
          currentTacticCategory: openingTactic?.category ?? null, currentPressureLevel: openingTactic?.pressure_level ?? 0,
          currentTacticPromptedDummySecret: openingTactic?.prompts_dummy_secret ?? false,
          previousTacticIds: openingTactic ? [openingTactic.tactic_id] : [] } : {}),
        metrics: [{ operation: "session_creation", stage: "session_creation", sessionId: initial.sessionId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()), measuredAt: endedAt.toISOString(), success: true }] };
      if (release) {
        pins.set(state.sessionId, { publicationId: release.publicationId, packageHash: release.packageHash, policyVersion: release.policyVersion });
        publishedSessions.set(state.sessionId, { release, pipeline: offlinePipeline(release) });
      } else if (canonical) pins.set(state.sessionId, { publicationId: null, packageHash: canonical.packageHash, policyVersion: "deterministic-adaptive-v1" });
      store.create(state);
      sendJson(response, 201, { session: safeSession(state), simulationOnly: true, draftFallbackOnly: !runtimeEligible });
      return;
    }

    const conversationRoute = pathname.match(/^\/api\/sessions\/([^/]+)\/conversation\/(start|caller-start|caller-ended|fail)$/u);
    if (conversationRoute && request.method === "POST") {
      requireLocalRuntimeRequest(request, options.environment);
      const sessionId = decodeURIComponent(conversationRoute[1]!), action = conversationRoute[2]!;
      const updated = applyConversationAction(store.get(sessionId), action, await readBody(request));
      if (action === "fail") { runtimeAudio.cancelSession(sessionId); callerAudio.cancelSession(sessionId); }
      store.update(updated); sendJson(response, 200, { session: safeSession(updated) }); return;
    }
    const callerRoute = pathname.match(/^\/api\/sessions\/([^/]+)\/caller-audio(?:\/([a-f0-9-]+|status))?$/u);
    if (callerRoute) {
      await callerAudio.handle(request, response, decodeURIComponent(callerRoute[1]!), callerRoute[2]); return;
    }
    const runtimeRoute = pathname.match(/^\/api\/sessions\/([^/]+)\/real-audio\/(status|start|frame|finish|cancel)$/);
    if (runtimeRoute) {
      if (runtimeRoute[2] === "start") { rate(turnLimiter, request, "real-audio"); browserAudio.cancelSession(decodeURIComponent(runtimeRoute[1]!)); }
      await runtimeAudio.handle(request, response, decodeURIComponent(runtimeRoute[1]!), runtimeRoute[2]!); return;
    }
    const audioRoute = pathname.match(/^\/api\/sessions\/([^/]+)\/audio\/(start|frame|finish|cancel)$/);
    if (request.method === "POST" && audioRoute) {
      if (publishedSessions.has(decodeURIComponent(audioRoute[1]!))) throw new ApplicationError("INVALID_STATE", "This published practice accepts typed input only.");
      if (audioRoute[2] === "start") rate(turnLimiter, request, "browser-audio");
      await browserAudio.handle(request, response, decodeURIComponent(audioRoute[1]!), audioRoute[2]!);
      return;
    }
    const sessionRoute = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(consent|turn|end))?$/);
    if (!sessionRoute) { sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } }); return; }
    const sessionId = decodeURIComponent(sessionRoute[1] ?? "");
    const action = sessionRoute[2];
    if (request.method === "GET" && !action) {
      const state = store.get(sessionId);
      sendJson(response, 200, { session: safeSession(state), debriefEvents: state.observedEvents });
      return;
    }
    if (request.method === "POST" && action === "consent") {
      const startedAt = (options.now ?? (() => new Date()))();
      const body = await readBody(request);
      const parsed = ConsentRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.consentVersion !== CONSENT_VERSION) throw new ApplicationError("INVALID_REQUEST", "Consent version is missing or unsupported.");
      const state = store.get(sessionId);
      if (state.state !== "CONSENT_REQUIRED" || state.consent.status !== "not-requested") throw new ApplicationError("INVALID_STATE", "Session is not awaiting consent.");
      const consentedAt = (options.now ?? (() => new Date()))();
      const changed = transitionConsent(state, "granted", consentedAt);
      const next = { ...changed, metrics: [...changed.metrics, { operation: "consent", stage: "consent", sessionId, startedAt: startedAt.toISOString(), endedAt: consentedAt.toISOString(), durationMs: Math.max(0, consentedAt.getTime() - startedAt.getTime()), measuredAt: consentedAt.toISOString(), success: true }] };
      store.update(next);
      sendJson(response, 200, { session: safeSession(next) });
      return;
    }
    if (request.method === "POST" && action === "turn") {
      if (store.get(sessionId).runtimeMode !== "MOCK") throw new ApplicationError("INVALID_STATE", "Real STT sessions do not accept mock typed turns.");
      browserAudio.cancelSession(sessionId);
      rate(turnLimiter, request);
      const body = await readBody(request);
      const parsed = MockTurnRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "Mock turn request must contain a text string.");
      if (parsed.data.timingFixture && options.environment !== "development" && options.environment !== "test") {
        throw new ApplicationError("INVALID_REQUEST", "Timing fixtures are available only in development and test environments.");
      }
      if (endingTypedSessions.has(sessionId)) throw new ApplicationError("INVALID_STATE", "The session is ending.");
      const work = (publishedSessions.get(sessionId)?.pipeline ?? orchestrator).processTurn(sessionId, parsed.data.text, parsed.data.timingFixture);
      pendingTypedTurns.set(sessionId, work);
      try {
        const result = await work;
        if (publishedSessions.has(sessionId)) await guardSession(sessionId, false);
        sendJson(response, 200, { ...result, session: safeSession(result.session) });
      } finally {
        if (pendingTypedTurns.get(sessionId) === work) pendingTypedTurns.delete(sessionId);
      }
      return;
    }
    if (request.method === "POST" && action === "end") {
      browserAudio.cancelSession(sessionId);
      runtimeAudio.cancelSession(sessionId);
      callerAudio.cancelSession(sessionId);
      const body = await readBody(request, true);
      if (!EndSessionRequestSchema.safeParse(body).success) throw new ApplicationError("INVALID_REQUEST", "End-session does not accept arbitrary fields.");
      const typedTurn = pendingTypedTurns.get(sessionId);
      if (typedTurn) {
        endingTypedSessions.add(sessionId);
        // Finish already-admitted local mock work before committing End. Live audio is cancelled above.
        try { await typedTurn; } catch { /* The request owns its own typed error. */ }
        finally { endingTypedSessions.delete(sessionId); }
      }
      const state = store.get(sessionId);
      const ended = endSession(state, (options.now ?? (() => new Date()))());
      store.update(ended);
      sendJson(response, 200, { session: safeSession(ended), transientAudioCleared: true });
      return;
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
  }
}

function loadTestScenarios(directory: string): Map<string, ScenarioDocument> {
  try {
    const result = new Map<string, ScenarioDocument>();
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
      const raw: unknown = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
      const scenario = validateScenarioDocument(raw);
      if (isScenarioRuntimeEligible(scenario)) {
        const references = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/safety/review-reference-lists.json"), "utf8")) as ScenarioSafetyOptions;
        if (!validateScenarioSafety(scenario, references).passed) throw new ApplicationError("INVALID_SCENARIO", "Released scenario did not pass the configured safety scan.");
      }
      result.set(scenario.scenario_id, scenario);
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

function projectSafeSession(state: ReturnType<typeof createSessionState>, templates?: ReviewedTemplates) {
  return {
    sessionId: state.sessionId, scenarioId: state.scenarioId, scenarioVersion: state.scenarioVersion,
    language: state.language, state: state.state, consent: state.consent, turnNumber: state.turnNumber,
    scenarioRuntimeStatus: state.scenarioRuntimeStatus,
    currentNodeId: state.currentNodeId, mode: state.mode, recordingEnabled: state.recordingEnabled,
    runtimeMode: state.runtimeMode,
    ...(state.conversation ? { conversation: state.conversation } : {}),
    currentTacticId: state.currentTacticId, currentResponseId: state.currentResponseId,
    currentTacticCategory: state.currentTacticCategory, currentTacticPromptedDummySecret: state.currentTacticPromptedDummySecret,
    currentPressureLevel: state.currentPressureLevel,
    previousTacticIds: state.previousTacticIds, maxPressureLevel: state.maxPressureLevel, maxTurns: state.maxTurns,
    safeWordState: state.safeWordState, behaviorHistory: state.behaviorHistory,
    baselineSpeechRateWpm: state.baselineSpeechRateWpm, baselineSpeechRateSampleCount: state.baselineSpeechRateSampleCount,
    timelineEvents: state.timelineEvents, pressureTimeline: state.pressureTimeline, terminalState: state.terminalState,
    pressureDebrief: state.runtimeMode === "REAL_CONVERSATION" ? conversationDebrief(state, templates ?? []) : debriefForSession(state),
    cache: state.cache, debriefEvents: state.observedEvents,
    metrics: state.metrics,
  };
}

async function readBody(request: IncomingMessage, allowEmpty = false): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new ApplicationError("INVALID_REQUEST", "Request body is too large.");
    chunks.push(buffer);
  }
  if (allowEmpty && size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function rate(limiter: InMemoryRateLimiter, request: IncomingMessage, suffix = ""): void {
  const decision = limiter.take(`${request.socket.remoteAddress ?? "unknown"}:${suffix}`);
  if (!decision.allowed) throw new ApplicationError("RATE_LIMITED", "Development request limit exceeded.", decision.retryAfterSeconds);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
