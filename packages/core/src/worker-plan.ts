import type { ExecutionMode } from "@opentop/shared";
import { getModel, type OpenTopConfig } from "./config.js";
import type {
  Classification,
  ExecutionPlan,
  PlanArtifact,
  WorkItemCreateInput,
  WorkItemStatus,
  WorkerPlanCreateInput,
  WorkerRole,
  WorkItemBranchStrategy
} from "./types.js";

export interface BuiltWorkerPlanDraft {
  workerPlan: WorkerPlanCreateInput;
  workItems: WorkItemCreateInput[];
}

export function buildWorkerPlanDraft(
  ticketId: string,
  sourcePlanArtifact: PlanArtifact,
  config: OpenTopConfig
): BuiltWorkerPlanDraft {
  const classification = sourcePlanArtifact.classificationSnapshot;
  const executionPlan = sourcePlanArtifact.executionPlanSnapshot;
  const workItemSources =
    sourcePlanArtifact.structuredPlan.workItems.length > 0
      ? sourcePlanArtifact.structuredPlan.workItems
      : sourcePlanArtifact.structuredPlan.implementationSteps.map((step) => ({
          id: step.id,
          title: step.title,
          summary: step.summary ?? step.title,
          affectedAreas: step.affectedAreas,
          suggestedMode: inferFallbackMode(step.affectedAreas),
          dependsOn: []
        }));

  const workItems = workItemSources.map((source, index) =>
    buildWorkItemCreateInput(ticketId, sourcePlanArtifact, classification, executionPlan, source, index, config)
  );

  return {
    workerPlan: {
      ticketId,
      sourcePlanArtifactId: sourcePlanArtifact.id,
      version: 1,
      status: "ready",
      summary: sourcePlanArtifact.structuredPlan.summary,
      classificationSnapshot: classification,
      executionPlanSnapshot: executionPlan
    },
    workItems
  };
}

function buildWorkItemCreateInput(
  ticketId: string,
  sourcePlanArtifact: PlanArtifact,
  classification: Classification,
  executionPlan: ExecutionPlan,
  source: {
    id: string;
    title: string;
    summary: string;
    affectedAreas: string[];
    suggestedMode: ExecutionMode;
    dependsOn: string[];
  },
  index: number,
  config: OpenTopConfig
): WorkItemCreateInput {
  const affectedAreas = source.affectedAreas.length > 0 ? source.affectedAreas : classification.affectedAreas;
  const role = deriveWorkerRole(affectedAreas, source.title, source.summary);
  const suggestedModelTier = deriveModelTier(role, classification, config);
  const modelConfig = getModel(config, suggestedModelTier);
  const branchStrategy = deriveBranchStrategy(role, affectedAreas, source.dependsOn);
  const reviewNotes = deriveReviewNotes(sourcePlanArtifact, role, source.dependsOn);

  return {
    workerPlanId: "0",
    ticketId,
    sourcePlanArtifactId: sourcePlanArtifact.id,
    sourcePlanWorkItemId: source.id,
    key: source.id || `work-${index + 1}`,
    title: source.title,
    summary: source.summary,
    role,
    status: deriveInitialWorkItemStatus(source.dependsOn),
    affectedAreas,
    dependsOn: source.dependsOn,
    suggestedProviderId: modelConfig.provider,
    suggestedModelTier,
    suggestedModelId: modelConfig.model,
    suggestedMode: normalizeSuggestedMode(source.suggestedMode, role, affectedAreas),
    branchStrategy,
    reviewNotes
  };
}

function deriveWorkerRole(affectedAreas: string[], title: string, summary: string): WorkerRole {
  const text = `${title} ${summary}`.toLowerCase();

  if (affectedAreas.includes("security") || text.includes("security") || text.includes("permission")) {
    return "security";
  }

  if (affectedAreas.includes("frontend") || text.includes("ui") || text.includes("frontend")) {
    return "frontend";
  }

  if (affectedAreas.includes("data") || text.includes("migration") || text.includes("schema")) {
    return "data";
  }

  if (affectedAreas.includes("integration") || text.includes("integration") || text.includes("webhook")) {
    return "integration";
  }

  if (affectedAreas.includes("tests") || text.includes("test") || text.includes("coverage")) {
    return "test";
  }

  if (affectedAreas.includes("docs") || text.includes("docs") || text.includes("documentation")) {
    return "docs";
  }

  if (affectedAreas.includes("backend")) {
    return "backend";
  }

  return "generalist";
}

function deriveModelTier(role: WorkerRole, classification: Classification, config: OpenTopConfig): string {
  if ((role === "docs" || role === "test") && config.models.cheap) {
    return "cheap";
  }

  if ((role === "security" || role === "data" || role === "integration" || role === "backend") && config.models.strong) {
    return "strong";
  }

  return classification.suggestedModelTier;
}

function deriveBranchStrategy(
  role: WorkerRole,
  affectedAreas: string[],
  dependsOn: string[]
): WorkItemBranchStrategy {
  if (dependsOn.length > 0) {
    return "reuse_parent_branch";
  }

  if (role === "frontend" || role === "backend" || role === "data" || affectedAreas.length >= 2) {
    return "isolated_worktree";
  }

  return "shared_ticket_branch";
}

function deriveReviewNotes(sourcePlanArtifact: PlanArtifact, role: WorkerRole, dependsOn: string[]): string[] {
  const notes: string[] = [];

  if (dependsOn.length > 0) {
    notes.push(`Wait for dependencies: ${dependsOn.join(", ")}.`);
  }

  for (const risk of sourcePlanArtifact.structuredPlan.risks.slice(0, 2)) {
    notes.push(`Plan risk: ${risk}`);
  }

  for (const question of sourcePlanArtifact.structuredPlan.openQuestions.slice(0, 2)) {
    notes.push(`Open question: ${question}`);
  }

  if (role === "test") {
    notes.push("Verify acceptance coverage before implementation is considered done.");
  }

  if (role === "security") {
    notes.push("Review auth, permission, and secret-handling implications carefully.");
  }

  return notes;
}

function deriveInitialWorkItemStatus(dependsOn: string[]): WorkItemStatus {
  return dependsOn.length > 0 ? "blocked" : "ready";
}

function normalizeSuggestedMode(
  suggestedMode: ExecutionMode,
  role: WorkerRole,
  affectedAreas: string[]
): ExecutionMode {
  if (role === "test" || affectedAreas.includes("tests")) {
    return "implement_and_test";
  }

  if (role === "docs") {
    return "implement_only";
  }

  return suggestedMode === "plan_only" || suggestedMode === "plan_then_implement" ? "implement_only" : suggestedMode;
}

function inferFallbackMode(affectedAreas: string[]): ExecutionMode {
  return affectedAreas.includes("tests") ? "implement_and_test" : "implement_only";
}
