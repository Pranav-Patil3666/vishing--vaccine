import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// src/ and dist/ sit at the same depth, so this also works for compiled startup.
export const rootEnvironmentPath = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Server entry points only. Existing process environment values take precedence. */
export function loadRootEnvironment(path = rootEnvironmentPath): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // Do not include raw loader errors or file contents in diagnostics.
    // eslint-disable-next-line preserve-caught-error -- Private configuration errors must remain sanitized.
    throw new Error("Could not load the root server environment file.");
  }
}
