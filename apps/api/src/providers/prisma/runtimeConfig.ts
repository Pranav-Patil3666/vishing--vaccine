import { z } from "zod";

export interface PrismaRuntimeConfig { endpoint: string; headers: Record<string, string>; }

/** Frozen to the participant baseline verified in Phase 4A. No verification script is invoked. */
export function readPrismaRuntimeConfig(env: NodeJS.ProcessEnv): PrismaRuntimeConfig | undefined {
  if (env.PRISMA_RUNTIME_ENABLED !== "true") return undefined;
  const credential = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/u).safeParse(env.GNANI_API_KEY);
  const units = Number(env.STT_COST_UNITS);
  if (!credential.success || !Number.isFinite(units) || units <= 0) return undefined;
  return { endpoint: "wss://api.vachana.ai/stt/v3/stream", headers: {
    "x-api-key-id": credential.data, lang_code: "hi-IN", "x-sample-rate": "16000",
  } };
}
