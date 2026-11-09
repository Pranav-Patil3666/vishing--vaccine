import { z } from "zod";
import { ScenarioDocumentSchema } from "./scenario.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/u);

export const RuntimeReleaseSchema = z.object({
  schemaVersion: z.literal(1),
  compilerVersion: z.literal("offline-adaptive-v1"),
  policyVersion: z.literal("deterministic-adaptive-v1"),
  sourceCandidateId: z.string(), sourceContentHash: hash, approvalArtifactHash: hash,
  approvalId: z.string().uuid(), reviewId: z.string().uuid(), publicationId: z.string().uuid(),
  validationVersion: z.string(), policyHash: hash,
  delivery: z.literal("MOCK"), scenario: ScenarioDocumentSchema,
  graph: z.object({ prefixes: z.number().int().positive(), leaves: z.number().int().positive(), depth: z.number().int().positive() }).strict(),
  packageHash: hash,
}).strict();
export type RuntimeRelease = z.infer<typeof RuntimeReleaseSchema>;
