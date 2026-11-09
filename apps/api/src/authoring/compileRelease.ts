import { isDeepStrictEqual } from "node:util";
import {
  RuntimeReleaseSchema, hashAuthoringData, validateScenarioForRelease, validateScenarioSafety,
  type AuthoringApproval, type RuntimeRelease, type ScenarioDocument, type ScenarioSafetyOptions,
} from "@vaccine/scenario-schema";
import { selectAdaptiveAction } from "../adaptivePolicy.js";

type CompileResult = { release: RuntimeRelease } | { reason: "OFFLINE_PROFILE_REQUIRED" | "GRAPH_POLICY_MISMATCH" | "RELEASE_VALIDATION_FAILED" };

/** The authored graph is a compatibility specification for the existing engine. */
export async function compileOfflineRelease(approval: AuthoringApproval, publicationId: string, safety: ScenarioSafetyOptions): Promise<CompileResult> {
  const { candidate } = approval.record;
  const { details, draft: { scenario: source } } = candidate;
  if (details.runtimeProfile !== "offline-adaptive-v1") return { reason: "OFFLINE_PROFILE_REQUIRED" };
  const { artifactHash, ...approvalData } = approval;
  if (await hashAuthoringData(candidate) !== approval.contentHash || await hashAuthoringData(approvalData) !== artifactHash) {
    return { reason: "RELEASE_VALIDATION_FAILED" };
  }
  let scenario: ScenarioDocument;
  try {
    scenario = validateScenarioForRelease({
      ...source, lifecycle_status: "RUNTIME_ELIGIBLE", review_status: "approved",
      reviewed_by: approval.reviewer.actorId, reviewed_at: approval.approvedAt, voice_id: "mock-only",
      nodes: source.nodes.map((node) => ({ ...node, branch_status: "approved" })),
      responses: Object.fromEntries(Object.entries(source.responses).map(([id, response]) => [id, {
        ...response, safety_status: response.safety_status === "draft" ? "reviewed_safe" : response.safety_status,
      }])),
    });
    if (!validateScenarioSafety(scenario, safety).passed) return { reason: "RELEASE_VALIDATION_FAILED" };
  } catch { return { reason: "RELEASE_VALIDATION_FAILED" }; }

  const root = scenario.nodes.find((node) => node.parent_node_id === null)!;
  const graph = { prefixes: 1, leaves: 0, depth: 0 };
  function verifyPoint(nodeId: string, pressure: number, tactics: string[], responses: string[]): boolean {
    const point = details.decisionPoints.find((entry) => entry.nodeId === nodeId);
    const node = scenario.nodes.find((entry) => entry.id === nodeId);
    if (!point || !node || point.turn !== tactics.length + 1 || !isDeepStrictEqual(node.debrief_tags, root.debrief_tags)) return false;
    for (const route of point.routes) {
      graph.prefixes++;
      graph.depth = Math.max(graph.depth, point.turn);
      const actual = selectAdaptiveAction({ scenario, behavior: route.behavior, turnNumber: point.turn,
        currentPressureLevel: pressure, previousTacticIds: tactics, previousResponseIds: responses, learnerText: "",
        sessionState: { scenarioId: scenario.scenario_id, scenarioVersion: scenario.version, currentNodeId: root.id,
          turnNumber: point.turn - 1, terminalState: null, state: "ROUTING",
          currentTacticId: tactics.at(-1) ?? null, currentResponseId: responses.at(-1) ?? null } });
      if (route.action === "terminal") {
        graph.leaves++;
        if (actual.terminalState !== route.outcome || actual.responseId !== details.terminalResponses[route.outcome]
          || actual.nextPressureLevel !== pressure) return false;
      } else {
        const next = scenario.nodes.find((entry) => entry.id === route.nextNodeId);
        const variant = details.variants.find((entry) => entry.responseId === next?.response_id);
        if (actual.terminalState !== null || !actual.tacticId || !variant || actual.responseId !== variant.responseId
          || actual.nextPressureLevel !== variant.pressureLevel
          || !verifyPoint(route.nextNodeId, actual.nextPressureLevel, [...tactics, actual.tacticId], [...responses, actual.responseId])) return false;
      }
    }
    return true;
  }
  try {
    if (!verifyPoint(root.id, 0, [], [])) return { reason: "GRAPH_POLICY_MISMATCH" };
  } catch { return { reason: "GRAPH_POLICY_MISMATCH" }; }
  const body = {
    schemaVersion: 1, compilerVersion: "offline-adaptive-v1", policyVersion: "deterministic-adaptive-v1",
    sourceCandidateId: approval.candidateId, sourceContentHash: approval.contentHash, approvalArtifactHash: artifactHash,
    approvalId: approval.approvalId, reviewId: approval.reviewId, publicationId, validationVersion: approval.validationVersion,
    policyHash: approval.policyHash, delivery: "MOCK", scenario, graph,
  };
  return { release: RuntimeReleaseSchema.parse({ ...body, packageHash: await hashAuthoringData(body) }) };
}
