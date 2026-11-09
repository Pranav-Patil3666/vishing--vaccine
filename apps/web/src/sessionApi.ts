import {
  DebriefEventSchema,
  SafeSessionSchema,
  type AudioTimingFixture,
  ScenarioBriefSchema,
  SessionCreateResponseSchema,
  RealVoiceStatusSchema, RealVoiceTurnResultSchema, REAL_TURN_LIMITS,
  TurnApiResponseSchema,
  type ScenarioBrief,
  type RealVoiceStatus, type RealVoiceTurnResult,
  CallerAudioAssetSchema, CallerAudioStatusSchema, type CallerAudioAsset, type CallerAudioStatus,
  RuntimeCreditSnapshotSchema, type RuntimeCreditSnapshot, type TechnicalFailure, type TechnicalStage,
} from "@vaccine/contracts";
import { DraftScenarioPackageSchema, ScenarioDocumentSchema, type ScenarioDocument } from "@vaccine/scenario-schema";
import { z } from "zod";
import { DevelopmentAudioForwarder, type AudioForwarder } from "./audio/transport.js";
import type { BrowserAudioError } from "./audio/errors.js";
import { readTechnicalFailure } from "./audio/technicalFailure.js";

type SafeSession = z.infer<typeof SafeSessionSchema>;
type TurnApiResponse = z.infer<typeof TurnApiResponseSchema>;
type DraftScenarioPackage = z.infer<typeof DraftScenarioPackageSchema>;

export class SessionApiError extends Error {
  constructor(message: string, readonly status?: number, readonly technical?: TechnicalFailure, readonly apiCode?: string) {
    super(message);
    this.name = "SessionApiError";
  }
  get code() { return this.technical?.causeCode ?? this.apiCode; }
}

const SessionEnvelopeSchema = z.object({
  session: SafeSessionSchema,
  debriefEvents: z.array(DebriefEventSchema),
}).strict();

export interface ApiClient {
  listRuntimeScenarios?(): Promise<ScenarioDocument[]>;
  createAudioForwarder(sessionId: string, onError: (error: BrowserAudioError) => void): AudioForwarder;
  createDemoSession(input: { scenarioId: string; scenarioVersion: string; language: string; demoMode?: false; runtimeMode?: "REAL_STT" | "REAL_CONVERSATION" }): Promise<SafeSession>;
  conversationAction?(sessionId: string, action: "start" | "caller-start" | "caller-ended" | "fail", body: unknown, signal?: AbortSignal): Promise<SafeSession>;
  createRealAudioForwarder?(sessionId: string, onError: (error: BrowserAudioError) => void, onResult: (result: RealVoiceTurnResult) => void): AudioForwarder;
  getRealVoiceStatus?(sessionId: string): Promise<RealVoiceStatus>;
  getCallerAudioStatus?(sessionId: string): Promise<CallerAudioStatus>;
  getCallerAudio?(sessionId: string, turnNumber: number, responseId: string, signal: AbortSignal): Promise<{ asset: CallerAudioAsset; blob: Blob }>;
  getRuntimeCredit?(): Promise<RuntimeCreditSnapshot>;
  grantConsent(sessionId: string): Promise<SafeSession>;
  submitMockTurn(sessionId: string, text: string, timingFixture?: AudioTimingFixture): Promise<TurnApiResponse>;
  endSession(sessionId: string, keepalive?: boolean): Promise<SafeSession>;
  getSession(sessionId: string): Promise<SafeSession>;
  generateMockDraft(brief: ScenarioBrief): Promise<DraftScenarioPackage>;
}

export function createApiClient(baseUrl = "", fetcher: typeof fetch = fetch): ApiClient {
  async function request<S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, method = "POST", signal?: AbortSignal, keepalive = false): Promise<z.output<S>> {
    const base = baseUrl.trim();
    const url = base ? new URL(path, base.endsWith("/") ? base : `${base}/`).toString() : path;
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        ...(keepalive ? { keepalive: true } : { signal: signal ?? AbortSignal.timeout(10_000) }),
        ...(method === "GET" ? { cache: "no-store" } : {}),
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SessionApiError("The local API could not be reached. Start the API service and retry.");
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new SessionApiError("The API returned an unreadable response.", response.status); }
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ message: z.string().optional(), code: z.string().optional() }).optional() }).safeParse(payload);
      const detail = parsed.success ? parsed.data.error : undefined;
      throw new SessionApiError(detail?.message ?? `The API returned ${response.status}.`, response.status, undefined, detail?.code);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new SessionApiError("The API response did not match its shared contract.", response.status);
    return parsed.data as z.output<S>;
  }

  return {
    async listRuntimeScenarios() {
      const result = await request("/api/runtime/scenarios", z.object({ scenarios: z.array(ScenarioDocumentSchema) }).strict(), undefined, "GET", AbortSignal.timeout(5000));
      return result.scenarios;
    },
    async conversationAction(sessionId, action, body, signal) {
      const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/conversation/${action}`, z.object({ session: SafeSessionSchema }).strict(), body, "POST", timeout);
      return result.session;
    },
    createAudioForwarder: (sessionId, onError) => new DevelopmentAudioForwarder(sessionId, baseUrl, fetcher, onError),
    createRealAudioForwarder: (sessionId, onError, onResult) => new DevelopmentAudioForwarder(sessionId, baseUrl, fetcher, onError, {
      route: "real-audio", startRequestMs: REAL_TURN_LIMITS.startRequestMs, finishRequestMs: REAL_TURN_LIMITS.finishRequestMs,
      parseFinish: (value) => { const result = RealVoiceTurnResultSchema.parse(value); onResult(result); return result.audioSummary; },
    }),
    getRealVoiceStatus: (sessionId) => request(`/api/sessions/${encodeURIComponent(sessionId)}/real-audio/status`, RealVoiceStatusSchema, undefined, "GET"),
    getCallerAudioStatus: (sessionId) => request(`/api/sessions/${encodeURIComponent(sessionId)}/caller-audio/status`, CallerAudioStatusSchema, undefined, "GET"),
    getRuntimeCredit: () => request("/api/runtime/credit", RuntimeCreditSnapshotSchema, undefined, "GET", AbortSignal.timeout(3000)),
    async getCallerAudio(sessionId, turnNumber, responseId, signal) {
      const path = `/api/sessions/${encodeURIComponent(sessionId)}/caller-audio`, base = baseUrl.trim();
      const url = (value: string) => base ? new URL(value, base).toString() : value;
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(32_000)]);
      let stage: TechnicalStage = "CALLER_AUDIO_RESOLUTION";
      try {
      const response = await fetcher(url(path), { method: "POST", signal: timeout, cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ turnNumber, responseId }) });
      if (!response.ok) throw new SessionApiError("Approved caller audio could not be prepared.", response.status, readTechnicalFailure(await response.json().catch(() => null), stage));
      const parsed = CallerAudioAssetSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new SessionApiError("Invalid caller audio metadata.", response.status, { stage, causeCode: "AUDIO_ASSET_INVALID", providerAttempted: null });
      const asset = parsed.data;
      if (asset.sessionId !== sessionId || asset.turnNumber !== turnNumber || asset.responseId !== responseId
        || !asset.audioUrl.startsWith(`${path}/`)) throw new SessionApiError("Stale caller audio reference.", undefined, { stage, causeCode: "INVALID_STATE", providerAttempted: null });
      stage = "CALLER_AUDIO_FETCH";
      const audio = await fetcher(url(asset.audioUrl), { signal: timeout, cache: "no-store", redirect: "error" });
      if (!audio.ok) throw new SessionApiError("Caller audio delivery failed.", audio.status, readTechnicalFailure(await audio.json().catch(() => null), stage));
      if (audio.headers.get("content-type") !== "audio/wav") throw new SessionApiError("Caller audio media type is invalid.", audio.status, { stage, causeCode: "AUDIO_ASSET_INVALID", providerAttempted: null });
      const blob = await audio.blob();
      if (blob.size !== asset.byteLength || blob.size > 8 * 1024 * 1024) throw new SessionApiError("Caller audio size is invalid.", undefined, { stage, causeCode: "AUDIO_ASSET_INVALID", providerAttempted: null });
      return { asset, blob };
      } catch (error) {
        if (error instanceof SessionApiError) throw error;
        throw new SessionApiError("Caller audio request could not complete.", undefined, { stage, causeCode: "NETWORK_ERROR", providerAttempted: null });
      }
    },
    async createDemoSession(input) {
      const created = await request("/api/sessions", SessionCreateResponseSchema, { ...input, demoMode: input.demoMode ?? input.runtimeMode === undefined });
      return SafeSessionSchema.parse(created.session);
    },
    async grantConsent(sessionId) {
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/consent`, z.object({ session: SafeSessionSchema }).passthrough(), { consentVersion: "training-consent-v1" });
      return SafeSessionSchema.parse(result.session);
    },
    async submitMockTurn(sessionId, text, timingFixture) {
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/turn`, TurnApiResponseSchema, { text, ...(timingFixture ? { timingFixture } : {}) });
      return { ...result, session: SafeSessionSchema.parse(result.session) };
    },
    async endSession(sessionId, keepalive) {
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/end`, z.object({ session: SafeSessionSchema }).passthrough(), {}, "POST", undefined, keepalive);
      return SafeSessionSchema.parse(result.session);
    },
    async getSession(sessionId) {
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}`, SessionEnvelopeSchema, undefined, "GET");
      return SafeSessionSchema.parse(result.session);
    },
    async generateMockDraft(brief) {
      const validated = ScenarioBriefSchema.parse(brief);
      return request("/api/authoring/mock", DraftScenarioPackageSchema, validated);
    },
  };
}
