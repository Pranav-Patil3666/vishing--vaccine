import { useEffect, useState } from "react";
import type { ApiHealthResponse } from "@vaccine/contracts";
import { SafetyDisclosures } from "@vaccine/ui";
import { fetchApiHealth } from "./healthClient.js";
import { parseClientEnvironment } from "./environment.js";

const publicEnvironment = parseClientEnvironment({
  VITE_PUBLIC_APP_NAME: import.meta.env.VITE_PUBLIC_APP_NAME,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});

export function App() {
  const [health, setHealth] = useState<ApiHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkHealth(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setHealth(await fetchApiHealth(publicEnvironment.VITE_API_BASE_URL));
    } catch (cause) {
      setHealth(null);
      setError(cause instanceof Error ? cause.message : "Health check failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void checkHealth();
  }, []);

  return (
    <>
      <SafetyDisclosures />
      <main>
        <h1>{publicEnvironment.VITE_PUBLIC_APP_NAME}</h1>
        <p>Temporary development shell. No voice session or provider call is available in this phase.</p>
        <section aria-labelledby="health-heading">
          <h2 id="health-heading">API connection</h2>
          <button type="button" onClick={() => void checkHealth()} disabled={loading}>
            {loading ? "Checking…" : "Check API health"}
          </button>
          {health && <p role="status">Connected: {health.status} ({health.environment})</p>}
          {error && <p role="alert">{error}</p>}
        </section>
      </main>
    </>
  );
}
