import { ApiHealthResponseSchema, type ApiHealthResponse } from "@vaccine/contracts";

export class ApiHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiHealthError";
  }
}

export async function fetchApiHealth(apiBaseUrl = "", fetcher: typeof fetch = fetch): Promise<ApiHealthResponse> {
  const baseUrl = apiBaseUrl.trim();
  const endpoint = baseUrl ? new URL("/health", baseUrl).toString() : "/health";
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: "GET", headers: { accept: "application/json" } });
  } catch {
    throw new ApiHealthError("The API could not be reached. Start the local API service and retry.");
  }
  if (!response.ok) throw new ApiHealthError(`The API returned status ${response.status}.`);
  const parsed = ApiHealthResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ApiHealthError("The API health response did not match the shared contract.");
  return parsed.data;
}
