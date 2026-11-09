export type AppRoute =
  | { page: "dashboard" }
  | { page: "scenarios" }
  | { page: "scenario"; scenarioId: string }
  | { page: "authoring" }
  | { page: "sessions" }
  | { page: "precall"; scenarioId: string }
  | { page: "live"; sessionId: string }
  | { page: "debrief"; sessionId: string };

export function parseHashRoute(hash: string): AppRoute {
  const [page, id] = hash.replace(/^#\/?/u, "").split("/");
  const decode = (value: string) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };
  switch (page) {
    case "scenarios": return id ? { page: "scenario", scenarioId: decode(id) } : { page: "scenarios" };
    case "authoring": return { page: "authoring" };
    case "sessions": return { page: "sessions" };
    case "training": return id === "precall"
      ? { page: "precall", scenarioId: decode(hash.replace(/^#\/?training\/precall\/?/u, "") || "S-01") }
      : id ? { page: "live", sessionId: decode(id) } : { page: "dashboard" };
    case "debrief": return id ? { page: "debrief", sessionId: decode(id) } : { page: "dashboard" };
    case "dashboard": return { page: "dashboard" };
    default: return { page: "dashboard" };
  }
}

export function routeHash(route: AppRoute): string {
  switch (route.page) {
    case "dashboard": return "#/dashboard";
    case "scenarios": return "#/scenarios";
    case "scenario": return `#/scenarios/${encodeURIComponent(route.scenarioId)}`;
    case "authoring": return "#/authoring";
    case "sessions": return "#/sessions";
    case "precall": return `#/training/precall/${encodeURIComponent(route.scenarioId)}`;
    case "live": return `#/training/${encodeURIComponent(route.sessionId)}`;
    case "debrief": return `#/debrief/${encodeURIComponent(route.sessionId)}`;
  }
}
