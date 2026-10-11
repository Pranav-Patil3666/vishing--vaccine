import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ApplicationError } from "../../errors.js";

// Verification hypotheses only. This configuration is never used by the application runtime.
export const syntheticPhrases = ["haan", "nahi", "rukko", "one second", "okay", "verify karunga",
  "Main official number par call karke verify karunga.", "DUMMY-4821",
  "okay one second", "okay one second okay", "haan one second", "okay haan one second"] as const;
export const probeKinds = ["BASELINE", "SHORT", "SEGMENTATION", "HINGLISH", "COMBINED", "ERROR"] as const;
export type ProbeKind = typeof probeKinds[number];
const rateSchema = z.union([z.literal(8000), z.literal(16000), z.literal(44100), z.literal(48000)]);
const headerSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const valueSchema = z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/);
const nonnegative = z.coerce.number().finite().nonnegative();
const envSchema = z.object({
  PRISMA_VERIFY_LIVE: z.literal("true"),
  PRISMA_VERIFY_WS_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "wss:" && !url.username && !url.password && !url.search && !url.hash;
  }),
  PRISMA_VERIFY_AUTH_HEADER: headerSchema,
  PRISMA_VERIFY_CREDENTIAL_ENV: z.enum(["GNANI_API_KEY", "GNANI_API_KEY_ID"]),
  PRISMA_VERIFY_LANGUAGE_HEADER: headerSchema,
  PRISMA_VERIFY_LANGUAGE_CODE: valueSchema,
  PRISMA_VERIFY_SAMPLE_RATE_HEADER: headerSchema,
  PRISMA_VERIFY_SAMPLE_RATE_HZ: z.coerce.number().pipe(rateSchema),
  PRISMA_VERIFY_FIXTURE_MANIFEST: z.string().min(1),
  PRISMA_VERIFY_FRAME_BYTES: z.coerce.number().int().min(2).max(4096).refine((n) => n % 2 === 0).default(1024),
  PRISMA_VERIFY_TRAILING_PARTIAL: z.enum(["true", "false"]).default("false"),
  PRISMA_VERIFY_FORMAT_HEADER: headerSchema.optional(),
  PRISMA_VERIFY_FORMAT: valueSchema.optional(),
  CREDIT_CAP: nonnegative,
  RESERVE_CAP: nonnegative,
  PRISMA_VERIFY_USED_UNITS: nonnegative,
  STT_COST_UNITS: z.coerce.number().finite().positive(),
});
export interface VerificationConfig {
  endpoint: string;
  headers: Record<string, string>;
  authHeaderName: string;
  sampleRateHz: number;
  frameBytes: number;
  trailingPartial: boolean;
  fixtureManifest: string;
  credit: { cap: number; reserve: number; used: number; estimated: number };
}

export function readVerificationConfig(env: NodeJS.ProcessEnv): VerificationConfig {
  // Blank numeric environment values must not silently coerce to zero.
  const input = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value?.trim() === "" ? undefined : value]));
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ApplicationError("INVALID_REQUEST", `Prisma verification requires valid explicit configuration: ${fields.join(", ")}. No connection opened.`);
  }
  const v = result.data;
  const credential = env[v.PRISMA_VERIFY_CREDENTIAL_ENV];
  if (!credential || !/^[\x21-\x7e]+$/.test(credential) || credential.length > 4096) {
    throw new ApplicationError("INVALID_REQUEST", "Selected server credential is absent or invalid. No connection opened.");
  }
  if ((v.PRISMA_VERIFY_FORMAT_HEADER === undefined) !== (v.PRISMA_VERIFY_FORMAT === undefined)) {
    throw new ApplicationError("INVALID_REQUEST", "Both format header and format value must be configured together.");
  }
  const entries: Array<[string, string]> = [
    [v.PRISMA_VERIFY_AUTH_HEADER.toLowerCase(), credential],
    [v.PRISMA_VERIFY_LANGUAGE_HEADER.toLowerCase(), v.PRISMA_VERIFY_LANGUAGE_CODE],
    [v.PRISMA_VERIFY_SAMPLE_RATE_HEADER.toLowerCase(), String(v.PRISMA_VERIFY_SAMPLE_RATE_HZ)],
  ];
  if (v.PRISMA_VERIFY_FORMAT_HEADER && v.PRISMA_VERIFY_FORMAT) entries.push([v.PRISMA_VERIFY_FORMAT_HEADER.toLowerCase(), v.PRISMA_VERIFY_FORMAT]);
  const forbidden = new Set(["host", "connection", "upgrade", "origin", "content-length", "transfer-encoding"]);
  if (new Set(entries.map(([name]) => name)).size !== entries.length || entries.some(([name]) => forbidden.has(name) || name.startsWith("sec-websocket-"))) {
    throw new ApplicationError("INVALID_REQUEST", "Verification headers collide or override transport headers.");
  }
  return {
    endpoint: v.PRISMA_VERIFY_WS_URL, headers: Object.fromEntries(entries),
    authHeaderName: v.PRISMA_VERIFY_AUTH_HEADER.toLowerCase(),
    sampleRateHz: v.PRISMA_VERIFY_SAMPLE_RATE_HZ, frameBytes: v.PRISMA_VERIFY_FRAME_BYTES,
    trailingPartial: v.PRISMA_VERIFY_TRAILING_PARTIAL === "true", fixtureManifest: v.PRISMA_VERIFY_FIXTURE_MANIFEST,
    credit: { cap: v.CREDIT_CAP, reserve: v.RESERVE_CAP, used: v.PRISMA_VERIFY_USED_UNITS, estimated: v.STT_COST_UNITS },
  };
}

const manifestSchema = z.object({
  source: z.literal("synthetic-local-speech"), encoding: z.literal("PCM_S16LE"), channels: z.literal(1),
  sampleRateHz: rateSchema, audioFile: z.string().regex(/^[a-zA-Z0-9_-]+\.pcm$/),
  expectedText: z.enum(syntheticPhrases), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  probe: z.enum(["BASELINE", "SHORT", "SEGMENTATION", "HINGLISH", "COMBINED"]).optional(),
  voiceName: z.string().min(1).max(128).optional(),
  voiceCulture: z.string().min(1).max(32).optional(),
  parts: z.array(z.object({ phrase: z.enum(syntheticPhrases), startSample: z.number().int().nonnegative(),
    endSample: z.number().int().positive() }).strict()).min(1).max(3).optional(),
}).strict();
export interface SyntheticFixture {
  bytes: Uint8Array; expectedText: typeof syntheticPhrases[number];
  probe?: Exclude<ProbeKind, "ERROR">;
  parts?: Array<{ phrase: typeof syntheticPhrases[number]; startSample: number; endSample: number }>;
  voiceName?: string; voiceCulture?: string;
}

export function validateFixture(manifest: unknown, bytes: Uint8Array, sampleRateHz: number): SyntheticFixture {
  const parsed = manifestSchema.safeParse(manifest);
  const maxBytes = sampleRateHz * 2 * 8;
  if (!parsed.success || parsed.data.sampleRateHz !== sampleRateHz || bytes.length === 0 || bytes.length > maxBytes || bytes.length % 2 !== 0
    || ["RIFF", "ID3", "OggS", "fLaC"].includes(Buffer.from(bytes.subarray(0, 4)).toString("ascii"))
    || createHash("sha256").update(bytes).digest("hex") !== parsed.data.sha256) {
    throw new ApplicationError("INVALID_REQUEST", "Synthetic fixture must match its manifest: raw mono PCM16LE, matching rate/hash, and at most eight seconds.");
  }
  const parts = parsed.data.parts;
  if (parts) {
    let previousEnd = 0;
    for (const part of parts) {
      if (part.startSample < previousEnd || part.endSample <= part.startSample || part.endSample > bytes.length / 2
        || bytes.subarray(previousEnd * 2, part.startSample * 2).some((byte) => byte !== 0)) {
        throw new ApplicationError("INVALID_REQUEST", "Synthetic composite ranges or pause bytes are invalid.");
      }
      previousEnd = part.endSample;
    }
    if (parts.map((part) => part.phrase).join(" ") !== parsed.data.expectedText) {
      throw new ApplicationError("INVALID_REQUEST", "Synthetic composite text does not match its reviewed phrase parts.");
    }
  }
  return { bytes, expectedText: parsed.data.expectedText,
    ...(parsed.data.probe ? { probe: parsed.data.probe } : {}), ...(parts ? { parts } : {}),
    ...(parsed.data.voiceName ? { voiceName: parsed.data.voiceName } : {}),
    ...(parsed.data.voiceCulture ? { voiceCulture: parsed.data.voiceCulture } : {}) };
}

export async function loadSyntheticFixture(config: VerificationConfig): Promise<SyntheticFixture> {
  try {
    const manifestPath = resolve(config.fixtureManifest);
    if ((await stat(manifestPath)).size > 4096) throw new Error();
    const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const parsed = manifestSchema.safeParse(manifest);
    if (!parsed.success) throw new Error();
    const audioPath = resolve(dirname(manifestPath), parsed.data.audioFile);
    if ((await stat(audioPath)).size > config.sampleRateHz * 2 * 8) throw new Error();
    return validateFixture(manifest, await readFile(audioPath), config.sampleRateHz);
  } catch {
    throw new ApplicationError("INVALID_REQUEST", "Cannot load a valid local synthetic fixture. No connection opened.");
  }
}
