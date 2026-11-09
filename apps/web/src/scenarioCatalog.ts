import scenarioOne from "../../../content/scenarios/S-01-urgent-account-verification.json";
import scenarioTwo from "../../../content/scenarios/S-02-insurance-refund-trap.json";
import scenarioThree from "../../../content/scenarios/S-03-telecom-kyc-lockout.json";
import { validateScenarioDocument, type ScenarioDocument } from "@vaccine/scenario-schema";

/** Scenarios are loaded from the repository's source files and validated with the shared schema. */
export const scenarioCatalog: readonly ScenarioDocument[] = [scenarioOne, scenarioTwo, scenarioThree]
  .map((scenario) => validateScenarioDocument(scenario));

export function getScenarioCatalog(localDrafts: readonly { scenario: ScenarioDocument }[] = []): ScenarioDocument[] {
  return [...scenarioCatalog, ...localDrafts.map((draft) => draft.scenario)];
}

export function scenarioById(scenarioId: string | undefined): ScenarioDocument | undefined {
  return scenarioCatalog.find((scenario) => scenario.scenario_id === scenarioId);
}

export function scenarioFocus(scenario: ScenarioDocument): string {
  return scenario.learning_objectives[0] ?? "Training objective not specified.";
}

export function scenarioTitle(scenario: ScenarioDocument): string {
  return scenario.fictional_organization.name;
}

export function scenarioTacticCount(scenario: ScenarioDocument): number {
  return scenario.adaptive_policy?.tactics.length ?? 0;
}

export function trainingTitle(scenario: ScenarioDocument): string {
  return scenario.scenario_id === "S-01" ? "Urgent account verification" : scenarioTitle(scenario);
}

export function trainingObjective(scenario: ScenarioDocument): string {
  return scenario.scenario_id === "S-01"
    ? "Pause under pressure and verify an unexpected account request through an official channel you already know."
    : scenarioFocus(scenario);
}

export function trainingLanguage(scenario: ScenarioDocument): string {
  return scenario.language === "hi-IN" || scenario.language === "hi-en" ? "Hindi / Hinglish" : scenario.language ?? "Unavailable";
}
