import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiHealthResponseSchema, type ApiHealthResponse } from "@vaccine/contracts";

export interface HealthServerOptions {
  environment: string;
  version?: string;
  now?: () => Date;
}

export function createHealthResponse(options: HealthServerOptions): ApiHealthResponse {
  const response = {
    status: "ok" as const,
    environment: options.environment,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.version ? { version: options.version } : {}),
  };
  return ApiHealthResponseSchema.parse(response);
}

export function createApiServer(options: HealthServerOptions): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, createHealthResponse(options));
      return;
    }

    sendJson(response, 404, { error: { code: "not_found", message: "Route not found." } });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
