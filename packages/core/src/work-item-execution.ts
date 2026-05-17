import type { OpenTopConfig } from "./config.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import type {
  BuiltPrompt,
  Classification,
  Execution,
  ExecutionPlan,
  OpenTopProjectContext,
  PlanArtifact,
  Ticket,
  WorkItem,
  WorkerPlan
} from "./types.js";

export function createWorkItemExecutionPlan(ticket: Ticket, workerPlan: WorkerPlan, workItem: WorkItem): ExecutionPlan {
  const basePlan = workerPlan.executionPlanSnapshot;
  const classification: Classification = {
    ...workerPlan.classificationSnapshot,
    affectedAreas: workItem.affectedAreas.length > 0 ? workItem.affectedAreas : workerPlan.classificationSnapshot.affectedAreas,
    suggestedProviderId: workItem.suggestedProviderId,
    suggestedModelTier: workItem.suggestedModelTier,
    suggestedModel: workItem.suggestedModelId,
    suggestedMode: workItem.suggestedMode,
    reason: `${workerPlan.classificationSnapshot.reason} Focus on work item "${workItem.title}".`,
    approvalRequired: false
  };

  return {
    ticket: { ...ticket, classification },
    classification,
    profile: {
      ...basePlan.profile,
      mode: workItem.suggestedMode,
      modelTier: workItem.suggestedModelTier,
      requiresApproval: false
    },
    providerId: workItem.suggestedProviderId,
    modelId: workItem.suggestedModelId,
    branchName: basePlan.branchName
  };
}

export function buildWorkItemExecutionPrompt(input: {
  ticket: Ticket;
  config: OpenTopConfig;
  projectContext: OpenTopProjectContext;
  workerPlan: WorkerPlan;
  workItem: WorkItem;
  approvedPlanArtifact: PlanArtifact;
  branchName: string;
}): BuiltPrompt {
  const executionPlan = {
    ...createWorkItemExecutionPlan(input.ticket, input.workerPlan, input.workItem),
    branchName: input.branchName
  };
  const virtualTicket: Ticket = {
    ...input.ticket,
    title: `${input.ticket.title} :: ${input.workItem.title}`,
    description: [
      input.ticket.description.trim(),
      "",
      "Worker plan focus:",
      input.workItem.summary,
      `Role: ${input.workItem.role}`,
      `Dependencies: ${input.workItem.dependsOn.join(", ") || "none"}`,
      `Affected areas: ${input.workItem.affectedAreas.join(", ") || "none"}`,
      `Branch strategy: ${input.workItem.branchStrategy}`,
      "Review notes:",
      ...input.workItem.reviewNotes.map((note) => `- ${note}`)
    ]
      .filter(Boolean)
      .join("\n")
  };
  const basePrompt = buildAgentPrompt({
    ticket: { ...virtualTicket, classification: executionPlan.classification },
    config: input.config,
    projectContext: input.projectContext,
    executionPlan,
    approvedPlanArtifact: input.approvedPlanArtifact,
    executionPhase: "implementation"
  });

  return {
    ...basePrompt,
    prompt: [
      basePrompt.prompt,
      "",
      "## Worker Item Contract",
      `Worker plan ID: ${input.workerPlan.id}`,
      `Work item ID: ${input.workItem.id}`,
      `Work item key: ${input.workItem.key}`,
      `Work item title: ${input.workItem.title}`,
      `Worker role: ${input.workItem.role}`,
      `Branch strategy: ${input.workItem.branchStrategy}`,
      `Dependencies: ${input.workItem.dependsOn.join(", ") || "none"}`,
      "Review notes:",
      formatList(input.workItem.reviewNotes),
      "",
      "Focus only on this work item while preserving the approved plan and any dependency output already present in the assigned workspace."
    ].join("\n"),
    sources: [...new Set([...basePrompt.sources, `worker-plan v${input.workerPlan.version}`])]
  };
}

export function buildWorkerPlanIntegrationSummary(workerPlan: WorkerPlan, workItems: WorkItem[], executions: Execution[]): {
  status: WorkerPlan["status"];
  summary: string;
  issues: string[];
} {
  const activeWorkItems = workItems.filter((workItem) => workItem.status !== "superseded" && workItem.workerPlanId === workerPlan.id);
  const failedItems = activeWorkItems.filter((workItem) => workItem.status === "failed");
  const blockedItems = activeWorkItems.filter((workItem) => workItem.status === "blocked");
  const incompleteItems = activeWorkItems.filter((workItem) => workItem.status !== "done");
  const issues = detectIntegrationIssues(activeWorkItems, executions);

  if (failedItems.length > 0) {
    return {
      status: "failed",
      summary: `${failedItems.length} work item(s) failed. Resolve them before integration can continue.`,
      issues
    };
  }

  if (incompleteItems.length === 0) {
    return {
      status: "integration_ready",
      summary:
        issues.length > 0
          ? "All work items ran, but integration needs attention before the feature is considered coherent."
          : "All work items ran and the feature is ready for integration review.",
      issues
    };
  }

  if (activeWorkItems.some((workItem) => workItem.status === "in_progress")) {
    return {
      status: "running",
      summary: "Worker-plan execution is in progress.",
      issues
    };
  }

  if (blockedItems.length > 0) {
    return {
      status: "ready",
      summary: `${blockedItems.length} work item(s) are still waiting on dependencies before they can run.`,
      issues
    };
  }

  return {
    status: "ready",
    summary: "Worker plan is ready for the next execution step.",
    issues
  };
}

function detectIntegrationIssues(workItems: WorkItem[], executions: Execution[]): string[] {
  const issues: string[] = [];
  const latestExecutions = new Map<string, Execution>();

  for (const execution of executions) {
    if (!execution.workItemId || latestExecutions.has(execution.workItemId)) {
      continue;
    }

    latestExecutions.set(execution.workItemId, execution);
  }

  const fileOwners = new Map<string, string[]>();

  for (const workItem of workItems) {
    const execution = latestExecutions.get(workItem.id);
    if (!execution) {
      continue;
    }

    for (const changedFile of execution.changedFiles) {
      const owners = fileOwners.get(changedFile) ?? [];
      owners.push(workItem.title);
      fileOwners.set(changedFile, owners);
    }

    if (workItem.branchStrategy === "isolated_worktree") {
      issues.push(`Work item "${workItem.title}" ran in an isolated workspace and will need explicit integration review.`);
    }
  }

  for (const [changedFile, owners] of fileOwners.entries()) {
    if (owners.length > 1) {
      issues.push(`Multiple work items touched "${changedFile}": ${owners.join(", ")}.`);
    }
  }

  return [...new Set(issues)];
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${item}`).join("\n");
}
