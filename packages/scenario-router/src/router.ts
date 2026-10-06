import { SYSTEM_SAFE_FALLBACK_RESPONSE_ID, type TranscriptEvent, type TriggerRule } from "@vaccine/contracts";
import { isConservativeRegex, type ScenarioDocument, type ScenarioNode } from "@vaccine/scenario-schema";

export { SYSTEM_SAFE_FALLBACK_RESPONSE_ID };

export interface RouteResult {
  branchId: string | null;
  responseId: string;
  nextNodeId: string | null;
  matched: boolean;
  reason: "matched" | "unmatched" | "unknown-transcript" | "scenario-not-approved" | "unknown-node";
}

export function normalizeTranscript(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function routeTranscript(
  scenario: ScenarioDocument,
  currentNodeId: string,
  transcript: Pick<TranscriptEvent, "text"> | string | null | undefined,
): RouteResult {
  const currentNode = scenario.nodes.find((node) => node.id === currentNodeId);
  if (!currentNode) return systemFallback("unknown-node");

  if (scenario.review_status !== "approved") {
    return fallbackFor(currentNode, "scenario-not-approved");
  }

  const text = typeof transcript === "string" ? transcript : transcript?.text;
  const normalizedText = text ? normalizeTranscript(text) : "";
  if (!normalizedText) return fallbackFor(currentNode, "unknown-transcript");

  const candidates = scenario.nodes.filter((node) => node.parent_node_id === currentNodeId && node.branch_status === "approved");
  const match = candidates.find((node) => node.trigger_rules.some((rule) => matchesRule(normalizedText, rule)));
  if (!match) return fallbackFor(currentNode, "unmatched");

  const response = scenario.responses[match.response_id];
  if (!response || response.safety_status === "draft") return fallbackFor(currentNode, "unmatched");

  return {
    branchId: match.id,
    responseId: match.response_id,
    nextNodeId: match.next_node_id,
    matched: true,
    reason: "matched",
  };
}

function fallbackFor(node: ScenarioNode, reason: RouteResult["reason"]): RouteResult {
  return {
    branchId: null,
    responseId: node.safe_fallback_response_id,
    nextNodeId: node.next_node_id,
    matched: false,
    reason,
  };
}

function systemFallback(reason: "unknown-node"): RouteResult {
  return {
    branchId: null,
    responseId: SYSTEM_SAFE_FALLBACK_RESPONSE_ID,
    nextNodeId: null,
    matched: false,
    reason,
  };
}

function matchesRule(normalizedText: string, rule: TriggerRule): boolean {
  switch (rule.type) {
    case "exact_phrase":
      return rule.phrases.some((phrase) => normalizeTranscript(phrase) === normalizedText);
    case "normalized_text":
      return normalizeTranscript(rule.text) === normalizedText;
    case "keyword": {
      const paddedText = ` ${normalizedText} `;
      const matches = rule.keywords.map((keyword) => paddedText.includes(` ${normalizeTranscript(keyword)} `));
      return rule.mode === "all" ? matches.every(Boolean) : matches.some(Boolean);
    }
    case "regex": {
      if (normalizedText.length > 5000 || !isConservativeRegex(rule.pattern, rule.flags ?? "")) return false;
      try {
        return new RegExp(rule.pattern, rule.flags ?? "").test(normalizedText);
      } catch {
        return false;
      }
    }
    default:
      return assertNever(rule);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported trigger rule: ${String(value)}`);
}
