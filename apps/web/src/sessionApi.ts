import {
  DebriefEventSchema,
  SafeSessionSchema,
  type AudioTimingFixture,
  ScenarioBriefSchema,
  SessionCreateResponseSchema,
  TurnApiResponseSchema,
  type ScenarioBrief,
} from "@vaccine/contracts";
import { DraftScenarioPackageSchema } from "@vaccine/scenario-schema";
import { z } from "zod";
import { DevelopmentAudioForwarder, type AudioForwarder } from "./audio/transport.js";
import type { BrowserAudioError } from "./audio/errors.js";

type SafeSession = z.infer<typeof SafeSessionSchema>;
type TurnApiResponse = z.infer<typeof TurnApiResponseSchema>;
type DraftScenarioPackage = z.infer<typeof DraftScenarioPackageSchema>;

export class SessionApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SessionApiError";
  }
}

const SessionEnvelopeSchema = z.object({
  session: SafeSessionSchema,
  debriefEvents: z.array(DebriefEventSchema),
}).strict();

export interface ApiClient {
  createAudioForwarder(sessionId: string, onError: (error: BrowserAudioError) => void): AudioForwarder;
  createDemoSession(input: { scenarioId: string; scenarioVersion: string; language: string }): Promise<SafeSession>;
  grantConsent(sessionId: string): Promise<SafeSession>;
  submitMockTurn(sessionId: string, text: string, timingFixture?: AudioTimingFixture): Promise<TurnApiResponse>;
  endSession(sessionId: string): Promise<SafeSession>;
  getSession(sessionId: string): Promise<SafeSession>;
  generateMockDraft(brief: ScenarioBrief): Promise<DraftScenarioPackage>;
}

export function createApiClient(baseUrl = "", fetcher: typeof fetch = fetch): ApiClient {
  async function request<S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, method = "POST"): Promise<z.output<S>> {
    const base = baseUrl.trim();
    const url = base ? new URL(path, base.endsWith("/") ? base : `${base}/`).toString() : path;
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
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
      const parsed = z.object({ error: z.object({ message: z.string().optional() }).optional() }).safeParse(payload);
      throw new SessionApiError(parsed.success ? parsed.data.error?.message ?? `The API returned ${response.status}.` : `The API returned ${response.status}.`, response.status);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new SessionApiError("The API response did not match its shared contract.", response.status);
    return parsed.data as z.output<S>;
  }

  return {
    createAudioForwarder: (sessionId, onError) => new DevelopmentAudioForwarder(sessionId, baseUrl, fetcher, onError),
    async createDemoSession(input) {
      const created = await request("/api/sessions", SessionCreateResponseSchema, { ...input, demoMode: true });
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
    async endSession(sessionId) {
      const result = await request(`/api/sessions/${encodeURIComponent(sessionId)}/end`, z.object({ session: SafeSessionSchema }).passthrough(), {});
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
