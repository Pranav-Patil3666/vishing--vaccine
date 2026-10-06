import { z } from "zod";

const clientEnvironmentSchema = z.object({
  VITE_PUBLIC_APP_NAME: z.string().min(1).default("Vishing Vaccine — development shell"),
  VITE_API_BASE_URL: z.string().default(""),
}).strict();

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;

export function parseClientEnvironment(input: Record<string, string | undefined>): ClientEnvironment {
  return clientEnvironmentSchema.parse(input);
}
