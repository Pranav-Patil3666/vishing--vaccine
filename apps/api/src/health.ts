import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiHealthResponseSchema, ConsentRequestSchema, CreateSessionRequestSchema, EndSessionRequestSchema, MockTurnRequestSchema, type ApiHealthResponse } from "@vaccine/contracts";
import { isScenarioRuntimeEligible, validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";
import { MockPrismaRecognizer } from "./providers/prisma/mockPrisma.js";
import { MockTimbreSynthesizer } from "./providers/timbre/mockTimbre.js";
import { createSessionState, endSession, transitionConsent } from "./session.js";
import { InMemorySessionStore } from "./sessionStore.js";
import { InMemoryRateLimiter } from "./rateLimit.js";
import { TurnOrchestrator } from "./turnOrchestrator.js";
import { ApplicationError, errorResponse } from "./errors.js";
import { debriefForSession } from "./debriefEngine.js";
import type { CreditBudget } from "@vaccine/credit-guard";

export interface HealthServerOptions {
  environment: string;
  version?: string;
  now?: () => Date;
  scenarioDirectory?: string;
  budget?: CreditBudget;
  sttUnits?: number;
  ttsUnits?: number;
  sessionStore?: InMemorySessionStore;
  recognizer?: MockPrismaRecognizer;
  synthesizer?: MockTimbreSynthesizer;
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
  const scenarios = loadScenarios(options.scenarioDirectory ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/scenarios"));
  const store = options.sessionStore ?? new InMemorySessionStore();
  const apiBudget = options.budget ?? { mode: "development" as const, developmentCap: 100, publicDemoCap: 100, reserveCap: 0, usedUnits: 0 };
  const orchestrator = new TurnOrchestrator({
    store, scenarios,
    recognizer: options.recognizer ?? new MockPrismaRecognizer(),
    synthesizer: options.synthesizer ?? new MockTimbreSynthesizer(),
    budget: apiBudget,
    sttUnits: options.sttUnits ?? 0,
    ttsUnits: options.ttsUnits ?? 0,
    ...(options.now ? { now: options.now } : {}),
  });
  const createLimiter = new InMemoryRateLimiter({ limit: 5, windowMs: 60_000, now: () => (options.now ?? (() => new Date()))().getTime() });
  const turnLimiter = new InMemoryRateLimiter({ limit: 12, windowMs: 60_000, now: () => (options.now ?? (() => new Date()))().getTime() });

  return createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const mapped = errorResponse(error);
      sendJson(response, mapped.status, mapped.body);
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, createHealthResponse(options));
      return;
    }
    if (request.method === "POST" && pathname === "/api/sessions") {
      const startedAt = (options.now ?? (() => new Date()))();
      rate(createLimiter, request);
      const body = await readBody(request);
      const parsed = CreateSessionRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "Session request did not match the allowed configuration.");
      const input = parsed.data;
      const scenario = scenarios.get(input.scenarioId);
      if (!scenario) throw new ApplicationError("SCENARIO_NOT_FOUND", "Scenario was not found.");
      if (scenario.version !== input.scenarioVersion || scenario.simulation !== true) throw new ApplicationError("INVALID_SCENARIO", "Scenario version or simulation metadata is invalid.");
      const runtimeEligible = isScenarioRuntimeEligible(scenario);
      if (runtimeEligible) {
        if (!scenario.language || input.language !== scenario.language) throw new ApplicationError("INVALID_SCENARIO", "Language is not approved for this scenario.");
        if (input.voiceId !== undefined && input.voiceId !== scenario.voice_id) throw new ApplicationError("INVALID_SCENARIO", "Voice is not approved for this scenario.");
      } else {
        if (!input.demoMode || scenario.language !== null || input.language !== MOCK_LANGUAGE_SENTINEL || input.voiceId !== undefined) {
          throw new ApplicationError("INVALID_SCENARIO", "Draft scenarios can only run the explicitly limited metadata-only mock fallback.");
        }
      }
      const initial = createSessionState({
        sessionId: randomUUID(), scenarioId: scenario.scenario_id, scenarioVersion: scenario.version,
        language: input.language, startingNodeId: scenario.nodes.find((node) => node.parent_node_id === null)?.id ?? "start",
        consentVersion: CONSENT_VERSION,
        mode: input.demoMode ? "demo" : "safe",
        scenarioRuntimeStatus: scenario.lifecycle_status,
        maxPressureLevel: scenario.adaptive_policy?.max_pressure_level ?? 5,
        maxTurns: scenario.adaptive_policy?.max_turns ?? 12,
      });
      const endedAt = (options.now ?? (() => new Date()))();
      const state = { ...initial, metrics: [{ operation: "session_creation", stage: "session_creation", sessionId: initial.sessionId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()), measuredAt: endedAt.toISOString(), success: true }] };
      store.create(state);
      sendJson(response, 201, { session: safeSession(state), simulationOnly: true, draftFallbackOnly: !runtimeEligible });
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
      rate(turnLimiter, request);
      const body = await readBody(request);
      const parsed = MockTurnRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApplicationError("INVALID_REQUEST", "Mock turn request must contain a text string.");
      if (parsed.data.timingFixture && options.environment !== "development" && options.environment !== "test") {
        throw new ApplicationError("INVALID_REQUEST", "Timing fixtures are available only in development and test environments.");
      }
      const result = await orchestrator.processTurn(sessionId, parsed.data.text, parsed.data.timingFixture);
      sendJson(response, 200, { ...result, session: safeSession(result.session) });
      return;
    }
    if (request.method === "POST" && action === "end") {
      const body = await readBody(request, true);
      if (!EndSessionRequestSchema.safeParse(body).success) throw new ApplicationError("INVALID_REQUEST", "End-session does not accept arbitrary fields.");
      const state = store.get(sessionId);
      const ended = endSession(state, (options.now ?? (() => new Date()))());
      store.update(ended);
      sendJson(response, 200, { session: safeSession(ended), transientAudioCleared: true });
      return;
    }
    sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
  }
}

function loadScenarios(directory: string): Map<string, ScenarioDocument> {
  try {
    const result = new Map<string, ScenarioDocument>();
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
      const raw: unknown = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
      const scenario = validateScenarioDocument(raw);
      result.set(scenario.scenario_id, scenario);
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

function safeSession(state: ReturnType<typeof createSessionState>) {
  return {
    sessionId: state.sessionId, scenarioId: state.scenarioId, scenarioVersion: state.scenarioVersion,
    language: state.language, state: state.state, consent: state.consent, turnNumber: state.turnNumber,
    scenarioRuntimeStatus: state.scenarioRuntimeStatus,
    currentNodeId: state.currentNodeId, mode: state.mode, recordingEnabled: state.recordingEnabled,
    currentTacticId: state.currentTacticId, currentResponseId: state.currentResponseId,
    currentTacticCategory: state.currentTacticCategory, currentTacticPromptedDummySecret: state.currentTacticPromptedDummySecret,
    currentPressureLevel: state.currentPressureLevel,
    previousTacticIds: state.previousTacticIds, maxPressureLevel: state.maxPressureLevel, maxTurns: state.maxTurns,
    safeWordState: state.safeWordState, behaviorHistory: state.behaviorHistory,
    baselineSpeechRateWpm: state.baselineSpeechRateWpm, baselineSpeechRateSampleCount: state.baselineSpeechRateSampleCount,
    timelineEvents: state.timelineEvents, pressureTimeline: state.pressureTimeline, terminalState: state.terminalState,
    pressureDebrief: debriefForSession(state),
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
