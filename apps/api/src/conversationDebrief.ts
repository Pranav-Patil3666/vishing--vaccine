import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ApprovedScenarioPackageSchema, type ApprovedScenarioPackage, type ScenarioDocument } from "@vaccine/scenario-schema";
import { DeterministicDebriefSchema, type SessionState } from "@vaccine/contracts";
import { debriefForSession } from "./debriefEngine.js";
import { ApplicationError } from "./errors.js";

export type ReviewedTemplates = ApprovedScenarioPackage["debriefTemplateVariants"];
export function readConversationTemplates(path: string, scenario: ScenarioDocument): ReviewedTemplates {
  try {
    const approved = ApprovedScenarioPackageSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (!isDeepStrictEqual(approved.scenario, scenario) || approved.debriefTemplateVariants.length === 0) throw new Error("Content mismatch");
    return approved.debriefTemplateVariants;
  } catch { throw new ApplicationError("INVALID_SCENARIO", "Matching reviewed debrief templates are required for automatic conversation."); }
}

/** Values come from the corresponding canonical event; no transcript, model, or network dependency. */
export function conversationDebrief(state: SessionState, templates: ReviewedTemplates) {
  const base = debriefForSession(state);
  if (!base) return null;
  return DeterministicDebriefSchema.parse({ ...base,
    completionKind: state.conversation?.phase === "COMPLETED" ? "complete"
      : ["STOPPED", "ERROR"].includes(state.conversation?.phase ?? "") ? "partial" : "in_progress",
    terminalOutcome: state.terminalState,
    reviewedEntries: state.timelineEvents.flatMap((event) => {
      const template = templates.find((value) => value.templateId === event.behavior.label.toLowerCase());
      if (!template) return [];
      const values: Record<string, string> = { behavior: event.behavior.label,
        latency: event.responseLatency === null ? "unavailable" : `${Math.round(event.responseLatency.valueMs)} ms`,
        timestamp: event.learnerSpeechStartedAt ? `${(event.learnerSpeechStartedAt.monotonicMs / 1000).toFixed(2)} s (session-local, approximate)` : "unavailable" };
      return [{ turnId: event.turnId, templateId: template.templateId,
        text: template.text.replace(/\{(behavior|latency|timestamp)\}/gu, (_match, key: string) => values[key]!) }];
    }),
  });
}
