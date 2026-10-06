import { z } from "zod";

const optionalString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);

const nonNegativeNumber = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? "0" : value,
  z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().nonnegative()),
);

const optionalNonNegativeNumber = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite().nonnegative()).optional(),
);

const booleanSetting = z.union([z.literal("true"), z.literal("false")])
  .transform((value) => value === "true")
  .default("false");

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: nonNegativeNumber.default(3001).pipe(z.number().int().min(1).max(65535)),
  APP_VERSION: optionalString,
  GNANI_API_KEY: optionalString,
  GNANI_API_KEY_ID: optionalString,
  GNANI_BASE_URL: optionalString,
  DATABASE_URL: optionalString,
  SESSION_SIGNING_SECRET: optionalString,
  PUBLIC_DEMO_ACCESS_CODE: optionalString,
  CREDIT_CAP: nonNegativeNumber.default(0),
  PUBLIC_DEMO_CREDIT_CAP: nonNegativeNumber.default(0),
  RESERVE_CAP: nonNegativeNumber.default(0),
  STT_COST_UNITS: optionalNonNegativeNumber,
  TTS_COST_UNITS: optionalNonNegativeNumber,
  FEATURE_LIVE_EVON: booleanSetting,
  ENABLE_LIVE_EVON: booleanSetting,
}).transform((environment) => ({
  nodeEnvironment: environment.NODE_ENV,
  port: environment.API_PORT,
  appVersion: environment.APP_VERSION,
  // The two independent settings must both be true to enable the optional path.
  liveEvonEnabled: environment.FEATURE_LIVE_EVON && environment.ENABLE_LIVE_EVON,
  providerConfigurationPresent: Boolean(environment.GNANI_API_KEY && environment.GNANI_API_KEY_ID && environment.GNANI_BASE_URL),
  developmentCreditCap: environment.CREDIT_CAP,
  publicDemoCreditCap: environment.PUBLIC_DEMO_CREDIT_CAP,
  reserveCap: environment.RESERVE_CAP,
  configuredSpeechRecognitionCostUnits: environment.STT_COST_UNITS,
  configuredSpeechSynthesisCostUnits: environment.TTS_COST_UNITS,
}));

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  readonly invalidFields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid environment configuration: ${fields.join(", ")}`);
    this.name = "EnvironmentValidationError";
    this.invalidFields = fields;
  }
}

export function parseServerEnvironment(input: Record<string, string | undefined>): ServerEnvironment {
  const parsed = serverEnvironmentSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))];
    throw new EnvironmentValidationError(fields);
  }
  return parsed.data;
}

const clientEnvironmentSchema = z.object({
  VITE_PUBLIC_APP_NAME: z.string().min(1).default("Vishing Vaccine — development shell"),
  VITE_API_BASE_URL: z.string().default(""),
});

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;

export function parseClientEnvironment(input: Record<string, string | undefined>): ClientEnvironment {
  const parsed = clientEnvironmentSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))];
    throw new EnvironmentValidationError(fields);
  }
  return parsed.data;
}
