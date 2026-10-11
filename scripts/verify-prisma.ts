import { ApplicationError } from "../apps/api/src/errors.js";
import { loadRootEnvironment } from "../apps/api/src/loadRootEnvironment.js";
import { readVerificationConfig } from "../apps/api/src/providers/prisma/verificationConfig.js";
import { verifyPrisma, verifyPrismaMissingAuth } from "../apps/api/src/providers/prisma/verifyPrisma.js";

try {
  loadRootEnvironment();
  const config = readVerificationConfig(process.env);
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== "--missing-auth")) {
    throw new ApplicationError("INVALID_REQUEST", "Only the explicit --missing-auth negative probe option is supported.");
  }
  const result = arguments_.length ? await verifyPrismaMissingAuth(config, { emit: (diagnostic) => console.log(JSON.stringify(diagnostic)) })
    : await verifyPrisma(config, { emit: (diagnostic) => console.log(JSON.stringify(diagnostic)) });
  console.log(JSON.stringify({ result: "single-fixture-transport-pass", ...result,
    caveat: "This run does not verify untested capabilities or complete Phase 4A." }));
} catch (error) {
  // No stacks, raw transport errors, environment values, credentials, or provider messages.
  const safe = error instanceof ApplicationError ? { code: error.code, message: error.message }
    : { code: "TRANSCRIPTION_FAILED", message: "Prisma verification could not be completed." };
  console.error(JSON.stringify({ result: "verification-failed", ...safe }));
  process.exitCode = 1;
}
