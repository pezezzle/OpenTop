import { spawn } from "node:child_process";
import type { ExecutionBranchPolicy, ExecutionMode } from "@opentop/shared";
import { resolveExecutionBranch } from "./branch-policy.js";
import { classifyTicket } from "./classifier.js";
import type { OpenTopConfig } from "./config.js";
import { createExecutionPlan } from "./execution.js";
import { parseStructuredPlan, isStructuredPlanUsable } from "./plan-output.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import { buildWorkItemExecutionPrompt, buildWorkerPlanIntegrationSummary, createWorkItemExecutionPlan } from "./work-item-execution.js";
import { buildWorkerPlanDraft } from "./worker-plan.js";
import type {
  CheckRunRepository,
  ExecutionProvider,
  ExecutionRepository,
  ExecutionWorkspace,
  PlanArtifactRepository,
  PullRequestService,
  PromptReviewRepository,
  TicketRepository,
  WorkItemRepository,
  WorkerPlanRepository
} from "./repositories.js";
import type {
  BuiltPrompt,
  Classification,
  Execution,
  ExecutionDiffSummary,
  ExecutionPullRequest,
  ExecutionRunResult,
  ExecutionRiskSummary,
  ExecutionPlan,
  PreparedWorkItemWorkspace,
  WorkItem,
  WorkItemExecutionResult,
  WorkerPlanRunResult,
  WorkerPlan,
  OpenTopProjectContext,
  PlanArtifact,
  PromptReview,
  RepositoryState,
  Ticket,
  TicketCreateInput
} from "./types.js";

interface PromptBuildOptions {
  planArtifactRepository?: PlanArtifactRepository;
  forcePlanningPhase?: boolean;
}

interface ExecutionContext {
  ticket: Ticket;
  classification: Classification;
  baseExecutionPlan: ExecutionPlan;
  executionPlan: ExecutionPlan;
  executionPhase: "planning" | "implementation";
  latestPlanArtifact?: PlanArtifact;
  approvedPlanArtifact?: PlanArtifact;
}

interface WorkItemRuntimeDependencies {
  providerForWorkItem: (workItem: WorkItem) => ExecutionProvider | Promise<ExecutionProvider>;
  prepareWorkspace: (input: {
    ticket: Ticket;
    workerPlan: WorkerPlan;
    workItem: WorkItem;
    dependencyExecutions: Execution[];
    projectContext: OpenTopProjectContext;
  }) => Promise<PreparedWorkItemWorkspace>;
}

export async function createTicket(repository: TicketRepository, input: TicketCreateInput): Promise<Ticket> {
  return repository.create(input);
}

export async function listTickets(repository: TicketRepository): Promise<Ticket[]> {
  return repository.list();
}

export async function classifyStoredTicket(
  repository: TicketRepository,
  config: OpenTopConfig,
  ticketId: string
): Promise<{ ticket: Ticket; classification: Classification; executionPlan: ExecutionPlan }> {
  const ticket = await getRequiredTicket(repository, ticketId);
  const classification = classifyTicket(ticket, config);
  const executionPlan = createExecutionPlan({ ...ticket, classification }, config);

  return {
    ticket: { ...ticket, classification },
    classification,
    executionPlan
  };
}

export async function buildPromptForStoredTicket(
  repository: TicketRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  options: PromptBuildOptions = {}
): Promise<BuiltPrompt> {
  const context = await resolveExecutionContext(repository, options.planArtifactRepository, config, ticketId, options);

  return buildAgentPrompt({
    ticket: { ...context.ticket, classification: context.classification },
    config,
    projectContext,
    executionPlan: context.executionPlan,
    approvedPlanArtifact: context.approvedPlanArtifact,
    executionPhase: context.executionPhase
  });
}

export async function preparePromptReviewForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  options: PromptBuildOptions = {}
): Promise<{ promptReview: PromptReview; builtPrompt: BuiltPrompt; createdNewVersion: boolean }> {
  const builtPrompt = await buildPromptForStoredTicket(ticketRepository, config, projectContext, ticketId, options);
  const existingReviews = await promptReviewRepository.listByTicketId(ticketId);
  const latestReview = existingReviews[0];

  if (latestReview && promptReviewMatchesBuiltPrompt(latestReview, builtPrompt)) {
    return {
      promptReview: latestReview,
      builtPrompt,
      createdNewVersion: false
    };
  }

  if (latestReview?.status === "draft") {
    await promptReviewRepository.update(latestReview.id, {
      status: "superseded"
    });
  }

  const promptReview = await promptReviewRepository.create({
    ticketId,
    version: (latestReview?.version ?? 0) + 1,
    status: "draft",
    promptSnapshot: builtPrompt.prompt,
    sources: builtPrompt.sources,
    contextSummary: builtPrompt.contextSummary,
    classificationSnapshot: builtPrompt.executionPlan.classification,
    executionPlanSnapshot: builtPrompt.executionPlan
  });

  return {
    promptReview,
    builtPrompt,
    createdNewVersion: true
  };
}

export async function approvePromptReviewForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  promptReviewId: string,
  reviewerComment?: string,
  options: PromptBuildOptions = {}
): Promise<PromptReview> {
  const { promptReview } = await preparePromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    projectContext,
    ticketId,
    options
  );

  if (promptReview.id !== promptReviewId) {
    throw new Error("Only the latest prompt version can be approved.");
  }

  const existingReviews = await promptReviewRepository.listByTicketId(ticketId);

  for (const review of existingReviews) {
    if (review.id !== promptReviewId && review.status === "approved") {
      await promptReviewRepository.update(review.id, { status: "superseded" });
    }
  }

  return promptReviewRepository.update(promptReviewId, {
    status: "approved",
    reviewerComment
  });
}

export async function rejectPromptReviewForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  promptReviewId: string,
  reviewerComment?: string,
  options: PromptBuildOptions = {}
): Promise<PromptReview> {
  const { promptReview } = await preparePromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    projectContext,
    ticketId,
    options
  );

  if (promptReview.id !== promptReviewId) {
    throw new Error("Only the latest prompt version can be rejected.");
  }

  return promptReviewRepository.update(promptReviewId, {
    status: "rejected",
    reviewerComment
  });
}

export async function regeneratePromptReviewForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  reviewerComment?: string,
  options: PromptBuildOptions = {}
): Promise<PromptReview> {
  const builtPrompt = await buildPromptForStoredTicket(ticketRepository, config, projectContext, ticketId, options);
  const existingReviews = await promptReviewRepository.listByTicketId(ticketId);
  const latestReview = existingReviews[0];

  if (latestReview?.status === "draft") {
    await promptReviewRepository.update(latestReview.id, {
      status: "superseded"
    });
  }

  return promptReviewRepository.create({
    ticketId,
    version: (latestReview?.version ?? 0) + 1,
    status: "draft",
    promptSnapshot: builtPrompt.prompt,
    sources: builtPrompt.sources,
    contextSummary: builtPrompt.contextSummary,
    classificationSnapshot: builtPrompt.executionPlan.classification,
    executionPlanSnapshot: builtPrompt.executionPlan,
    reviewerComment
  });
}

export async function listPromptReviewsForStoredTicket(
  promptReviewRepository: PromptReviewRepository,
  ticketId: string
): Promise<PromptReview[]> {
  return promptReviewRepository.listByTicketId(ticketId);
}

export async function listPlanArtifactsForStoredTicket(
  planArtifactRepository: PlanArtifactRepository,
  ticketId: string
): Promise<PlanArtifact[]> {
  return planArtifactRepository.listByTicketId(ticketId);
}

export async function listWorkerPlansForStoredTicket(
  workerPlanRepository: WorkerPlanRepository,
  ticketId: string
): Promise<WorkerPlan[]> {
  return workerPlanRepository.listByTicketId(ticketId);
}

export async function listWorkItemsForStoredTicket(
  workItemRepository: WorkItemRepository,
  ticketId: string
): Promise<WorkItem[]> {
  return workItemRepository.listByTicketId(ticketId);
}

export async function listExecutionsForStoredWorkerPlan(
  executionRepository: ExecutionRepository,
  workerPlanId: string
): Promise<Execution[]> {
  return executionRepository.listByWorkerPlanId(workerPlanId);
}

export async function listExecutionsForStoredWorkItem(
  executionRepository: ExecutionRepository,
  workItemId: string
): Promise<Execution[]> {
  return executionRepository.listByWorkItemId(workItemId);
}

export async function getWorkItem(workItemRepository: WorkItemRepository, workItemId: string): Promise<WorkItem> {
  const workItem = await workItemRepository.findById(workItemId);

  if (!workItem) {
    throw new Error(`Work item "${workItemId}" was not found in the local OpenTop store.`);
  }

  return workItem;
}

export async function approvePlanArtifactForStoredTicket(
  planArtifactRepository: PlanArtifactRepository,
  ticketId: string,
  planArtifactId: string,
  reviewerComment?: string
): Promise<PlanArtifact> {
  const existingArtifacts = await planArtifactRepository.listByTicketId(ticketId);
  const latestArtifact = existingArtifacts[0];

  if (!latestArtifact || latestArtifact.id !== planArtifactId) {
    throw new Error("Only the latest plan version can be approved.");
  }

  for (const artifact of existingArtifacts) {
    if (artifact.id !== planArtifactId && artifact.status === "approved") {
      await planArtifactRepository.update(artifact.id, { status: "superseded" });
    }
  }

  return planArtifactRepository.update(planArtifactId, {
    status: "approved",
    reviewerComment
  });
}

export async function rejectPlanArtifactForStoredTicket(
  planArtifactRepository: PlanArtifactRepository,
  ticketId: string,
  planArtifactId: string,
  reviewerComment?: string
): Promise<PlanArtifact> {
  const existingArtifacts = await planArtifactRepository.listByTicketId(ticketId);
  const latestArtifact = existingArtifacts[0];

  if (!latestArtifact || latestArtifact.id !== planArtifactId) {
    throw new Error("Only the latest plan version can be rejected.");
  }

  return planArtifactRepository.update(planArtifactId, {
    status: "rejected",
    reviewerComment
  });
}

export async function generateWorkerPlanForStoredTicket(
  ticketRepository: TicketRepository,
  planArtifactRepository: PlanArtifactRepository,
  workerPlanRepository: WorkerPlanRepository,
  workItemRepository: WorkItemRepository,
  config: OpenTopConfig,
  ticketId: string,
  reviewerComment?: string
): Promise<{ workerPlan: WorkerPlan; workItems: WorkItem[] }> {
  await getRequiredTicket(ticketRepository, ticketId);
  const planArtifacts = await planArtifactRepository.listByTicketId(ticketId);
  const sourcePlanArtifact = planArtifacts.find((artifact) => artifact.status === "approved");

  if (!sourcePlanArtifact) {
    throw new Error("An approved plan artifact is required before generating worker plans.");
  }

  const existingWorkerPlans = await workerPlanRepository.listByTicketId(ticketId);
  const latestWorkerPlan = existingWorkerPlans[0];

  for (const workerPlan of existingWorkerPlans) {
    if (workerPlan.status !== "superseded") {
      await workerPlanRepository.update(workerPlan.id, { status: "superseded" });
    }
  }

  const existingWorkItems = await workItemRepository.listByTicketId(ticketId);
  for (const workItem of existingWorkItems) {
    if (workItem.status !== "superseded") {
      await workItemRepository.update(workItem.id, { status: "superseded" });
    }
  }

  const draft = buildWorkerPlanDraft(ticketId, sourcePlanArtifact, config);
  const workerPlan = await workerPlanRepository.create({
    ...draft.workerPlan,
    version: (latestWorkerPlan?.version ?? 0) + 1,
    integrationSummary: "Worker plan generated and ready for execution.",
    reviewerComment: reviewerComment ?? draft.workerPlan.reviewerComment
  });
  const workItems: WorkItem[] = [];

  for (const draftItem of draft.workItems) {
    const workItem = await workItemRepository.create({
      ...draftItem,
      workerPlanId: workerPlan.id
    });
    workItems.push(workItem);
  }

  return {
    workerPlan,
    workItems
  };
}

export async function runWorkItemForStoredTicket(
  ticketRepository: TicketRepository,
  planArtifactRepository: PlanArtifactRepository,
  workerPlanRepository: WorkerPlanRepository,
  workItemRepository: WorkItemRepository,
  executionRepository: ExecutionRepository,
  checkRunRepository: CheckRunRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  workItemId: string,
  runtime: WorkItemRuntimeDependencies
): Promise<WorkItemExecutionResult> {
  const workItem = await getWorkItem(workItemRepository, workItemId);
  const workerPlan = await getRequiredWorkerPlan(workerPlanRepository, workItem.workerPlanId);
  const ticket = await getRequiredTicket(ticketRepository, workItem.ticketId);
  const approvedPlanArtifact = await getApprovedPlanArtifactForWorkerPlan(planArtifactRepository, ticket.id, workerPlan);

  if (workItem.status === "superseded" || workerPlan.status === "superseded") {
    return {
      status: "blocked",
      workerPlan,
      workItem,
      reason: "This worker plan was superseded by a newer version."
    };
  }

  if (workItem.status === "done") {
    return {
      status: "blocked",
      workerPlan,
      workItem,
      reason: "This work item is already marked done."
    };
  }

  if (workItem.status === "in_progress") {
    return {
      status: "blocked",
      workerPlan,
      workItem,
      reason: "This work item is already in progress."
    };
  }

  if (approvedPlanArtifact.id !== workerPlan.sourcePlanArtifactId) {
    return {
      status: "blocked",
      workerPlan,
      workItem,
      reason: "The latest approved plan no longer matches this worker plan. Regenerate worker planning first."
    };
  }

  const currentWorkItems = (await workItemRepository.listByWorkerPlanId(workerPlan.id)).filter(
    (entry) => entry.status !== "superseded"
  );
  const dependencyBlockers = workItem.dependsOn.filter((dependencyKey) => {
    const dependency = currentWorkItems.find(
      (entry) => entry.key === dependencyKey || entry.sourcePlanWorkItemId === dependencyKey
    );
    return !dependency || dependency.status !== "done";
  });

  if (dependencyBlockers.length > 0) {
    const blockedWorkItem = await workItemRepository.update(workItem.id, { status: "blocked" });
    return {
      status: "blocked",
      workerPlan,
      workItem: blockedWorkItem,
      reason: `Dependencies are not finished yet: ${dependencyBlockers.join(", ")}.`
    };
  }

  const dependencyExecutions = await collectDependencyExecutions(executionRepository, currentWorkItems, workItem.dependsOn);
  const preparedWorkspace = await runtime.prepareWorkspace({
    ticket,
    workerPlan,
    workItem,
    dependencyExecutions,
    projectContext
  });
  const executionPlan = {
    ...createWorkItemExecutionPlan(ticket, workerPlan, workItem),
    branchName: preparedWorkspace.branchName
  };
  const builtPrompt = buildWorkItemExecutionPrompt({
    ticket,
    config,
    projectContext,
    workerPlan,
    workItem,
    approvedPlanArtifact,
    branchName: preparedWorkspace.branchName
  });
  const provider = await runtime.providerForWorkItem(workItem);
  const updatedWorkerPlan = await workerPlanRepository.update(workerPlan.id, {
    status: "running",
    integrationSummary: `Running work item "${workItem.title}".`
  });
  const inProgressWorkItem = await workItemRepository.update(workItem.id, { status: "in_progress" });
  const execution = await executionRepository.create({
    ticketId: executionPlan.ticket.id,
    workerPlanId: updatedWorkerPlan.id,
    workItemId: inProgressWorkItem.id,
    profileId: executionPlan.profile.id,
    providerId: executionPlan.providerId,
    modelId: executionPlan.modelId,
    status: "planned",
    runKind: "work_item",
    branchName: preparedWorkspace.branchName,
    workspacePath: preparedWorkspace.repositoryPath,
    promptSnapshot: builtPrompt.prompt,
    classificationSnapshot: executionPlan.classification,
    artifactKind: "workspace_changes",
    reviewStatus: "not_required",
    logs: [],
    changedFiles: []
  });
  const executionLogs = [
    `Work-item execution created for "${inProgressWorkItem.title}".`,
    `Worker plan ${updatedWorkerPlan.id} using strategy "${preparedWorkspace.strategy}".`,
    `Workspace: ${preparedWorkspace.repositoryPath}`,
    ...preparedWorkspace.logs
  ];

  try {
    const queuedExecution = await executionRepository.update(execution.id, {
      status: "queued",
      logs: executionLogs
    });
    const runningExecution = await executionRepository.update(queuedExecution.id, {
      status: "running",
      logs: [
        ...queuedExecution.logs,
        `Starting provider "${queuedExecution.providerId}" with model "${queuedExecution.modelId}" for work item "${inProgressWorkItem.title}".`
      ]
    });
    const providerResult = await provider.run({
      ticketTitle: executionPlan.ticket.title,
      ticketDescription: executionPlan.ticket.description,
      repositoryPath: preparedWorkspace.repositoryPath,
      branchName: preparedWorkspace.branchName,
      agentProfile: executionPlan.profile.id,
      model: executionPlan.modelId,
      mode: executionPlan.profile.mode,
      projectRules: projectContext.rules ?? "",
      prompt: builtPrompt.prompt
    });
    const repositoryStateAfterRun = await preparedWorkspace.workspace.getRepositoryState();
    const changedFiles = uniqueStrings([...providerResult.changedFiles, ...repositoryStateAfterRun.changedFiles]);
    const artifactKind =
      changedFiles.length > 0 ? "workspace_changes" : providerResult.artifactKind ?? "workspace_changes";
    const successStatus =
      artifactKind === "review_output" && changedFiles.length === 0 ? "output_ready" : "succeeded";
    if (!providerResult.success) {
      const finalExecution = await executionRepository.update(runningExecution.id, {
        status: "failed",
        artifactKind,
        outputKind: providerResult.outputKind,
        outputText: providerResult.outputText,
        changedFiles,
        reviewStatus: "not_required",
        logs: [
          ...runningExecution.logs,
          ...normalizeLogEntries(providerResult.logs),
          `Provider summary: ${providerResult.summary}`
        ]
      });
      const failedWorkItem = await workItemRepository.update(inProgressWorkItem.id, { status: "failed" });
      const failedWorkerPlan = await workerPlanRepository.update(updatedWorkerPlan.id, {
        status: "failed",
        integrationSummary: `Work item "${failedWorkItem.title}" failed and blocked integration progress.`
      });

      return {
        status: "failed",
        workerPlan: failedWorkerPlan,
        workItem: failedWorkItem,
        execution: finalExecution,
        reason: providerResult.summary,
        repositoryPath: preparedWorkspace.repositoryPath
      };
    }

    const finalExecution = await finalizeExecutionArtifacts({
      execution: runningExecution,
      executionRepository,
      checkRunRepository,
      config,
      workspace: preparedWorkspace.workspace,
      workspacePath: preparedWorkspace.repositoryPath,
      classification: executionPlan.classification,
      providerResult,
      artifactKind,
      successStatus,
      changedFiles
    });

    const completedWorkItem = await workItemRepository.update(inProgressWorkItem.id, { status: "done" });
    await unblockDependentWorkItems(workItemRepository, currentWorkItems, completedWorkItem);
    const refreshedWorkItems = await workItemRepository.listByWorkerPlanId(updatedWorkerPlan.id);
    const refreshedExecutions = await executionRepository.listByWorkerPlanId(updatedWorkerPlan.id);
    const integration = buildWorkerPlanIntegrationSummary(updatedWorkerPlan, refreshedWorkItems, refreshedExecutions);
    const finalizedWorkerPlan = await workerPlanRepository.update(updatedWorkerPlan.id, {
      status: integration.status,
      integrationSummary: integration.summary
    });

    return {
      status: successStatus,
      workerPlan: finalizedWorkerPlan,
      workItem: completedWorkItem,
      execution: finalExecution,
      repositoryPath: preparedWorkspace.repositoryPath
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedExecution = await executionRepository.update(execution.id, {
      status: "failed",
      logs: [...executionLogs, `Work-item execution failed: ${message}`]
    });
    const failedWorkItem = await workItemRepository.update(inProgressWorkItem.id, { status: "failed" });
    const failedWorkerPlan = await workerPlanRepository.update(updatedWorkerPlan.id, {
      status: "failed",
      integrationSummary: `Work item "${failedWorkItem.title}" failed before integration could continue.`
    });

    return {
      status: "failed",
      workerPlan: failedWorkerPlan,
      workItem: failedWorkItem,
      execution: failedExecution,
      reason: message,
      repositoryPath: preparedWorkspace.repositoryPath
    };
  }
}

export async function runWorkerPlanForStoredTicket(
  ticketRepository: TicketRepository,
  planArtifactRepository: PlanArtifactRepository,
  workerPlanRepository: WorkerPlanRepository,
  workItemRepository: WorkItemRepository,
  executionRepository: ExecutionRepository,
  checkRunRepository: CheckRunRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  runtime: WorkItemRuntimeDependencies
): Promise<WorkerPlanRunResult> {
  await getRequiredTicket(ticketRepository, ticketId);
  const workerPlan = (await workerPlanRepository.listByTicketId(ticketId)).find((entry) => entry.status !== "superseded");

  if (!workerPlan) {
    throw new Error("Generate a worker plan before starting multi-run execution.");
  }

  const approvedPlanArtifact = await getApprovedPlanArtifactForWorkerPlan(planArtifactRepository, ticketId, workerPlan);
  if (approvedPlanArtifact.id !== workerPlan.sourcePlanArtifactId) {
    return {
      status: "blocked",
      workerPlan,
      workItems: await workItemRepository.listByWorkerPlanId(workerPlan.id),
      executions: await executionRepository.listByWorkerPlanId(workerPlan.id),
      summary: "The latest approved plan is newer than this worker plan.",
      integrationSummary: "Regenerate the worker plan before executing more work items.",
      integrationIssues: [],
      blockedWorkItemIds: [],
      failedWorkItemIds: []
    };
  }

  const executions: Execution[] = [];

  while (true) {
    const currentWorkItems = (await workItemRepository.listByWorkerPlanId(workerPlan.id)).filter(
      (entry) => entry.status !== "superseded"
    );
    const nextWorkItem = currentWorkItems.find((entry) => entry.status === "ready");

    if (!nextWorkItem) {
      break;
    }

    const result = await runWorkItemForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository,
      checkRunRepository,
      config,
      projectContext,
      nextWorkItem.id,
      runtime
    );

    if (result.execution) {
      executions.push(result.execution);
    }

    if (result.status === "failed" || result.status === "blocked") {
      break;
    }
  }

  const refreshedWorkerPlan = await getRequiredWorkerPlan(workerPlanRepository, workerPlan.id);
  const refreshedWorkItems = await workItemRepository.listByWorkerPlanId(workerPlan.id);
  const refreshedExecutions = await executionRepository.listByWorkerPlanId(workerPlan.id);
  const integration = buildWorkerPlanIntegrationSummary(refreshedWorkerPlan, refreshedWorkItems, refreshedExecutions);
  const finalWorkerPlan = await workerPlanRepository.update(refreshedWorkerPlan.id, {
    status: integration.status,
    integrationSummary: integration.summary
  });

  return {
    status: integration.status === "failed" ? "failed" : integration.status === "running" ? "running" : integration.status === "integration_ready" ? "integration_ready" : "blocked",
    workerPlan: finalWorkerPlan,
    workItems: refreshedWorkItems,
    executions: refreshedExecutions,
    summary: integration.summary,
    integrationSummary: integration.summary,
    integrationIssues: integration.issues,
    blockedWorkItemIds: refreshedWorkItems.filter((entry) => entry.status === "blocked").map((entry) => entry.id),
    failedWorkItemIds: refreshedWorkItems.filter((entry) => entry.status === "failed").map((entry) => entry.id)
  };
}

export async function regeneratePlanArtifactForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  planArtifactRepository: PlanArtifactRepository,
  executionRepository: ExecutionRepository,
  executionWorkspace: ExecutionWorkspace,
  executionProvider: ExecutionProvider,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  repositoryState: RepositoryState,
  reviewerComment?: string
): Promise<ExecutionRunResult> {
  return runPlanningExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    executionWorkspace,
    executionProvider,
    config,
    projectContext,
    ticketId,
    repositoryState,
    reviewerComment
  );
}

export async function planExecutionForStoredTicket(
  repository: TicketRepository,
  config: OpenTopConfig,
  ticketId: string
): Promise<ExecutionPlan> {
  const ticket = await getRequiredTicket(repository, ticketId);
  const classification = classifyTicket(ticket, config);
  return createExecutionPlan({ ...ticket, classification }, config);
}

export async function startExecutionForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  planArtifactRepository: PlanArtifactRepository,
  executionRepository: ExecutionRepository,
  checkRunRepository: CheckRunRepository,
  executionWorkspace: ExecutionWorkspace,
  executionProvider: ExecutionProvider,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  repositoryState: RepositoryState,
  branchPolicyOverride?: ExecutionBranchPolicy
): Promise<ExecutionRunResult> {
  const context = await resolveExecutionContext(ticketRepository, planArtifactRepository, config, ticketId);
  const latestExecution = await getLatestExecutionForTicket(executionRepository, ticketId);
  const branchResolution = resolveExecutionBranch(context.executionPlan, config, repositoryState, branchPolicyOverride);
  const executionPlan = {
    ...context.executionPlan,
    branchName: branchResolution.branchName ?? "none"
  };

  if (latestExecution?.pullRequest && !context.ticket.reopenedAt) {
    if (context.ticket.status !== "done") {
      await ticketRepository.update(context.ticket.id, {
        status: "done",
        resolutionType: "done",
        resolutionNote: `Pull request #${latestExecution.pullRequest.number ?? "?"} already exists in ${latestExecution.pullRequest.repositoryFullName}.`,
        resolvedAt: new Date().toISOString(),
        reopenedAt: undefined
      });
    }

    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "ticket_closed",
      reason: "This ticket already has a pull request. Reopen it before starting a new execution.",
      planArtifact: context.latestPlanArtifact
    };
  }

  if (context.ticket.status === "done") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "ticket_closed",
      reason: "This ticket is closed. Reopen it before starting a new execution.",
      planArtifact: context.latestPlanArtifact
    };
  }

  const { promptReview, builtPrompt } = await preparePromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    projectContext,
    ticketId,
    { planArtifactRepository }
  );

  if (branchResolution.decision === "blocked") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "branch_policy",
      reason: branchResolution.reason,
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  if (promptReview.status === "rejected") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "prompt_review",
      reason: "The latest prompt version was rejected. Regenerate or approve a new prompt before running.",
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  if (context.classification.approvalRequired && promptReview.status !== "approved") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "prompt_review",
      reason: "Prompt approval is required before execution can start.",
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  if (context.executionPhase === "planning") {
    if (context.latestPlanArtifact?.status === "rejected") {
      return {
        status: "blocked",
        executionPlan,
        branchResolution,
        blocker: "plan_review",
        reason: "The latest plan version was rejected. Regenerate a new plan before execution can continue.",
        promptReview,
        planArtifact: context.latestPlanArtifact
      };
    }

    if (context.latestPlanArtifact?.status === "draft") {
      return {
        status: "blocked",
        executionPlan,
        branchResolution,
        blocker: "plan_review",
        reason: "A generated plan is waiting for review. Approve, reject, or regenerate it before continuing.",
        promptReview,
        planArtifact: context.latestPlanArtifact
      };
    }

    return runPlanningExecutionForStoredTicket(
      ticketRepository,
      promptReviewRepository,
      planArtifactRepository,
      executionRepository,
      executionWorkspace,
      executionProvider,
      config,
      projectContext,
      ticketId,
      repositoryState
    );
  }

  const execution = await executionRepository.create({
    ticketId: executionPlan.ticket.id,
    profileId: executionPlan.profile.id,
    providerId: executionPlan.providerId,
    modelId: executionPlan.modelId,
    status: "planned",
    runKind: "ticket",
    branchName: executionPlan.branchName,
    workspacePath: projectContext.rootDirectory,
    promptSnapshot: builtPrompt.prompt,
    classificationSnapshot: executionPlan.classification,
    artifactKind: "workspace_changes",
    outputKind: undefined,
    reviewStatus: "not_required",
    logs: [],
    changedFiles: []
  });

  const executionLogs = [
    `Execution created for ticket ${executionPlan.ticket.id}.`,
    `Branch policy "${branchResolution.policy}" resolved to decision "${branchResolution.decision}".`,
    branchResolution.reason
  ];

  try {
    const workspacePreparation =
      branchResolution.decision === "none"
        ? {
            branchName: "none",
            logs: ["No working branch was required for this execution mode."]
          }
        : await executionWorkspace.prepareBranch(branchResolution);
    const queuedExecution = await executionRepository.update(execution.id, {
      status: "queued",
      branchName: workspacePreparation.branchName,
      logs: [...executionLogs, ...workspacePreparation.logs]
    });
    const runningExecution = await executionRepository.update(queuedExecution.id, {
      status: "running",
      logs: [
        ...queuedExecution.logs,
        `Starting provider "${queuedExecution.providerId}" with model "${queuedExecution.modelId}".`
      ]
    });
    const providerResult = await executionProvider.run({
      ticketTitle: executionPlan.ticket.title,
      ticketDescription: executionPlan.ticket.description,
      repositoryPath: projectContext.rootDirectory,
      branchName: workspacePreparation.branchName,
      agentProfile: executionPlan.profile.id,
      model: executionPlan.modelId,
      mode: executionPlan.profile.mode,
      projectRules: projectContext.rules ?? "",
      prompt: builtPrompt.prompt
    });
    const repositoryStateAfterRun = await executionWorkspace.getRepositoryState();
    const changedFiles = uniqueStrings([...providerResult.changedFiles, ...repositoryStateAfterRun.changedFiles]);
    const artifactKind =
      changedFiles.length > 0 ? "workspace_changes" : providerResult.artifactKind ?? "workspace_changes";
    const successStatus =
      artifactKind === "review_output" && changedFiles.length === 0 ? "output_ready" : "succeeded";
    if (!providerResult.success) {
      const finalExecution = await executionRepository.update(runningExecution.id, {
        status: "failed",
        artifactKind,
        outputKind: providerResult.outputKind,
        outputText: providerResult.outputText,
        changedFiles,
        reviewStatus: "not_required",
        logs: [
          ...runningExecution.logs,
          ...normalizeLogEntries(providerResult.logs),
          `Provider summary: ${providerResult.summary}`
        ]
      });
      return {
        status: "failed",
        execution: finalExecution,
        executionPlan: {
          ...builtPrompt.executionPlan,
          branchName: workspacePreparation.branchName
        },
        sources: builtPrompt.sources,
        branchResolution,
        error: providerResult.summary,
        promptReview,
        planArtifact: context.approvedPlanArtifact
      };
    }

    const finalExecution = await finalizeExecutionArtifacts({
      execution: runningExecution,
      executionRepository,
      checkRunRepository,
      config,
      workspace: executionWorkspace,
      workspacePath: projectContext.rootDirectory,
      classification: executionPlan.classification,
      providerResult,
      artifactKind,
      successStatus,
      changedFiles
    });

    return {
      status: successStatus,
      execution: finalExecution,
      executionPlan: {
        ...builtPrompt.executionPlan,
        branchName: workspacePreparation.branchName
      },
      sources: builtPrompt.sources,
      branchResolution,
      promptReview,
      planArtifact: context.approvedPlanArtifact
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedExecution = await executionRepository.update(execution.id, {
      status: "failed",
      logs: [...executionLogs, `Branch preparation failed: ${message}`]
    });

    return {
      status: "failed",
      execution: failedExecution,
      executionPlan: builtPrompt.executionPlan,
      sources: builtPrompt.sources,
      branchResolution,
      error: message,
      promptReview,
      planArtifact: context.approvedPlanArtifact
    };
  }
}

export async function listExecutions(repository: ExecutionRepository): Promise<Execution[]> {
  return repository.list();
}

export async function resolveStoredTicket(
  ticketRepository: TicketRepository,
  executionRepository: ExecutionRepository,
  ticketId: string,
  input: {
    resolutionType: "done" | "manual_pr" | "no_pr";
    resolutionNote?: string;
  }
): Promise<Ticket> {
  const ticket = await getRequiredTicket(ticketRepository, ticketId);
  const latestExecution = await getLatestExecutionForTicket(executionRepository, ticketId);

  if (latestExecution?.status === "planned" || latestExecution?.status === "queued" || latestExecution?.status === "running") {
    throw new Error("You cannot close a ticket while its latest execution is still active.");
  }

  if (latestExecution?.status === "succeeded" && latestExecution.reviewStatus === "pending") {
    throw new Error("Review the latest successful execution before marking this ticket as done.");
  }

  return ticketRepository.update(ticket.id, {
    status: "done",
    resolutionType: input.resolutionType,
    resolutionNote: input.resolutionNote,
    resolvedAt: new Date().toISOString(),
    reopenedAt: undefined
  });
}

export async function reopenStoredTicket(
  ticketRepository: TicketRepository,
  executionRepository: ExecutionRepository,
  config: OpenTopConfig,
  ticketId: string
): Promise<Ticket> {
  const ticket = await getRequiredTicket(ticketRepository, ticketId);
  const latestExecution = await getLatestExecutionForTicket(executionRepository, ticketId);
  const classification = classifyTicket(ticket, config);

  return ticketRepository.update(ticket.id, {
    status: deriveActiveTicketStatus(classification.approvalRequired, latestExecution),
    resolutionType: undefined,
    resolutionNote: undefined,
    resolvedAt: undefined,
    reopenedAt: new Date().toISOString()
  });
}

export async function getExecution(repository: ExecutionRepository, executionId: string): Promise<Execution> {
  const execution = await repository.findById(executionId);

  if (!execution) {
    throw new Error(`Execution "${executionId}" was not found in the local OpenTop store.`);
  }

  return execution;
}

export async function listCheckRunsForStoredExecution(
  checkRunRepository: CheckRunRepository,
  executionId: string
): Promise<import("./types.js").CheckRun[]> {
  return checkRunRepository.listByExecutionId(executionId);
}

export async function approveExecutionReview(
  executionRepository: ExecutionRepository,
  checkRunRepository: CheckRunRepository,
  executionId: string,
  reviewerComment?: string,
  overrideFailedChecks = false
): Promise<Execution> {
  const execution = await getExecution(executionRepository, executionId);
  const checkRuns = await checkRunRepository.listByExecutionId(executionId);
  const failedChecks = checkRuns.filter((checkRun) => checkRun.status === "failed");

  if (execution.status !== "succeeded") {
    throw new Error("Only successful workspace-changing executions can be approved for review.");
  }

  if (execution.reviewStatus === "not_required") {
    throw new Error("This execution does not require a review approval step.");
  }

  if (failedChecks.length > 0 && !overrideFailedChecks) {
    throw new Error(
      `Checks are still failing for this execution: ${failedChecks.map((checkRun) => checkRun.name).join(", ")}.`
    );
  }

  return executionRepository.update(executionId, {
    reviewStatus: "approved",
    reviewerComment,
    reviewedAt: new Date().toISOString()
  });
}

export async function rejectExecutionReview(
  executionRepository: ExecutionRepository,
  executionId: string,
  reviewerComment?: string
): Promise<Execution> {
  const execution = await getExecution(executionRepository, executionId);

  if (execution.status !== "succeeded") {
    throw new Error("Only successful workspace-changing executions can be rejected from review.");
  }

  if (execution.reviewStatus === "not_required") {
    throw new Error("This execution does not require a review approval step.");
  }

  return executionRepository.update(executionId, {
    reviewStatus: "rejected",
    reviewerComment,
    reviewedAt: new Date().toISOString()
  });
}

export async function createDraftPullRequestForExecution(
  ticketRepository: TicketRepository,
  executionRepository: ExecutionRepository,
  checkRunRepository: CheckRunRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  pullRequestService: PullRequestService,
  executionId: string,
  options: { overrideFailedChecks?: boolean } = {}
): Promise<Execution> {
  const execution = await getExecution(executionRepository, executionId);
  const ticket = await getRequiredTicket(ticketRepository, execution.ticketId);
  const checkRuns = await checkRunRepository.listByExecutionId(executionId);
  const failedChecks = checkRuns.filter((checkRun) => checkRun.status === "failed");

  if (execution.artifactKind !== "workspace_changes" || execution.changedFiles.length === 0) {
    throw new Error("Only workspace-changing executions can be turned into pull requests.");
  }

  if (execution.status !== "succeeded") {
    throw new Error("Only successful executions can be turned into pull requests.");
  }

  if (execution.reviewStatus !== "approved") {
    throw new Error("Approve the execution review before creating a pull request.");
  }

  if (!execution.branchName || execution.branchName === "none") {
    throw new Error("This execution does not have a branch that can be used for a pull request.");
  }

  if (execution.pullRequest?.url) {
    throw new Error(`A pull request already exists for this execution: ${execution.pullRequest.url}`);
  }

  if (failedChecks.length > 0 && !options.overrideFailedChecks) {
    throw new Error(
      `Checks are still failing for this execution: ${failedChecks.map((checkRun) => checkRun.name).join(", ")}.`
    );
  }

  const title = buildPullRequestTitle(ticket, execution);
  const body = renderPullRequestBody({
    template: projectContext.pullRequestTemplate,
    ticket,
    execution,
    checkRuns,
    defaultBranch: config.project.defaultBranch
  });
  const pullRequest = await pullRequestService.createDraft({
    repositoryPath: execution.workspacePath || projectContext.rootDirectory,
    baseBranch: config.project.defaultBranch,
    headBranch: execution.branchName,
    title,
    body
  });
  await ticketRepository.update(ticket.id, {
    status: "done",
    resolutionType: "done",
    resolutionNote: `Draft PR #${pullRequest.number ?? "?"} created in ${pullRequest.repositoryFullName}.`,
    resolvedAt: new Date().toISOString(),
    reopenedAt: undefined
  });

  return executionRepository.update(execution.id, {
    pullRequest,
    pullRequestUrl: pullRequest.url,
    logs: [
      ...execution.logs,
      `Draft pull request created: ${pullRequest.url}`
    ]
  });
}

async function runPlanningExecutionForStoredTicket(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  planArtifactRepository: PlanArtifactRepository,
  executionRepository: ExecutionRepository,
  executionWorkspace: ExecutionWorkspace,
  executionProvider: ExecutionProvider,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  repositoryState: RepositoryState,
  reviewerComment?: string
): Promise<ExecutionRunResult> {
  const context = await resolveExecutionContext(ticketRepository, planArtifactRepository, config, ticketId, {
    forcePlanningPhase: true
  });
  const { promptReview, builtPrompt } = await preparePromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    projectContext,
    ticketId,
    {
      planArtifactRepository,
      forcePlanningPhase: true
    }
  );
  const branchResolution = resolveExecutionBranch(context.executionPlan, config, repositoryState);
  const executionPlan = {
    ...context.executionPlan,
    branchName: branchResolution.branchName ?? "none"
  };

  if (branchResolution.decision === "blocked") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "branch_policy",
      reason: branchResolution.reason,
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  if (promptReview.status === "rejected") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "prompt_review",
      reason: "The latest prompt version was rejected. Regenerate or approve a new prompt before running.",
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  if (context.classification.approvalRequired && promptReview.status !== "approved") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution,
      blocker: "prompt_review",
      reason: "Prompt approval is required before execution can start.",
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }

  const execution = await executionRepository.create({
    ticketId: executionPlan.ticket.id,
    profileId: executionPlan.profile.id,
    providerId: executionPlan.providerId,
    modelId: executionPlan.modelId,
    status: "planned",
    runKind: "planning",
    branchName: executionPlan.branchName,
    workspacePath: projectContext.rootDirectory,
    promptSnapshot: builtPrompt.prompt,
    classificationSnapshot: executionPlan.classification,
    artifactKind: "review_output",
    outputKind: "plan",
    reviewStatus: "not_required",
    logs: [],
    changedFiles: []
  });

  const executionLogs = [
    `Planning execution created for ticket ${executionPlan.ticket.id}.`,
    `Branch policy "${branchResolution.policy}" resolved to decision "${branchResolution.decision}".`,
    branchResolution.reason
  ];

  try {
    const queuedExecution = await executionRepository.update(execution.id, {
      status: "queued",
      branchName: "none",
      logs: [...executionLogs, "No working branch was required for planning mode."]
    });
    const runningExecution = await executionRepository.update(queuedExecution.id, {
      status: "running",
      logs: [
        ...queuedExecution.logs,
        `Starting planner provider "${queuedExecution.providerId}" with model "${queuedExecution.modelId}".`
      ]
    });
    const providerResult = await executionProvider.run({
      ticketTitle: executionPlan.ticket.title,
      ticketDescription: executionPlan.ticket.description,
      repositoryPath: projectContext.rootDirectory,
      branchName: "none",
      agentProfile: executionPlan.profile.id,
      model: executionPlan.modelId,
      mode: "plan_only",
      projectRules: projectContext.rules ?? "",
      prompt: builtPrompt.prompt
    });
    const finalExecutionBase = await executionRepository.update(runningExecution.id, {
      status: providerResult.success ? "output_ready" : "failed",
      artifactKind: "review_output",
      outputKind: providerResult.outputKind ?? "plan",
      outputText: providerResult.outputText,
      changedFiles: [],
      logs: [
        ...runningExecution.logs,
        ...normalizeLogEntries(providerResult.logs),
        `Provider summary: ${providerResult.summary}`
      ]
    });

    if (!providerResult.success) {
      return {
        status: "failed",
        execution: finalExecutionBase,
        executionPlan,
        sources: builtPrompt.sources,
        branchResolution,
        error: providerResult.summary,
        promptReview,
        planArtifact: context.latestPlanArtifact
      };
    }

    const rawPlanOutput = providerResult.outputText?.trim() ?? providerResult.summary.trim();
    const structuredPlan = parseStructuredPlan(rawPlanOutput, executionPlan.classification);

    if ((providerResult.outputKind && providerResult.outputKind !== "plan") || !isStructuredPlanUsable(structuredPlan)) {
      const invalidPlanExecution = await executionRepository.update(finalExecutionBase.id, {
        status: "failed",
        logs: [
          ...finalExecutionBase.logs,
          "OpenTop expected a structured plan artifact, but the provider output could not be validated as a usable plan."
        ]
      });

      return {
        status: "failed",
        execution: invalidPlanExecution,
        executionPlan,
        sources: builtPrompt.sources,
        branchResolution,
        error: "Planner output did not produce a usable structured plan.",
        promptReview,
        planArtifact: context.latestPlanArtifact
      };
    }

    const planArtifact = await createPlanArtifactFromExecution(
      planArtifactRepository,
      executionPlan,
      finalExecutionBase.id,
      promptReview.id,
      rawPlanOutput,
      structuredPlan,
      reviewerComment
    );

    return {
      status: "output_ready",
      execution: finalExecutionBase,
      executionPlan,
      sources: builtPrompt.sources,
      branchResolution,
      promptReview,
      planArtifact
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedExecution = await executionRepository.update(execution.id, {
      status: "failed",
      logs: [...executionLogs, `Planning execution failed: ${message}`]
    });

    return {
      status: "failed",
      execution: failedExecution,
      executionPlan,
      sources: builtPrompt.sources,
      branchResolution,
      error: message,
      promptReview,
      planArtifact: context.latestPlanArtifact
    };
  }
}

async function createPlanArtifactFromExecution(
  planArtifactRepository: PlanArtifactRepository,
  executionPlan: ExecutionPlan,
  sourceExecutionId: string,
  sourcePromptReviewId: string,
  rawOutput: string,
  structuredPlan: NonNullable<ReturnType<typeof parseStructuredPlan>>,
  reviewerComment?: string
): Promise<PlanArtifact> {
  const existingArtifacts = await planArtifactRepository.listByTicketId(executionPlan.ticket.id);
  const latestArtifact = existingArtifacts[0];

  if (latestArtifact?.status === "draft") {
    await planArtifactRepository.update(latestArtifact.id, { status: "superseded" });
  }

  return planArtifactRepository.create({
    ticketId: executionPlan.ticket.id,
    sourceExecutionId,
    sourcePromptReviewId,
    version: (latestArtifact?.version ?? 0) + 1,
    status: "draft",
    rawOutput,
    structuredPlan,
    classificationSnapshot: executionPlan.classification,
    executionPlanSnapshot: executionPlan,
    reviewerComment
  });
}

async function resolveExecutionContext(
  ticketRepository: TicketRepository,
  planArtifactRepository: PlanArtifactRepository | undefined,
  config: OpenTopConfig,
  ticketId: string,
  options: PromptBuildOptions = {}
): Promise<ExecutionContext> {
  const ticket = await getRequiredTicket(ticketRepository, ticketId);
  const classification = classifyTicket(ticket, config);
  const baseExecutionPlan = createExecutionPlan({ ...ticket, classification }, config);
  const planArtifacts = planArtifactRepository ? await planArtifactRepository.listByTicketId(ticketId) : [];
  const latestPlanArtifact = planArtifacts[0];
  const approvedPlanArtifact = planArtifacts.find((artifact) => artifact.status === "approved");
  const planningPhase =
    options.forcePlanningPhase === true ||
    baseExecutionPlan.profile.mode === "plan_only" ||
    (baseExecutionPlan.profile.mode === "plan_then_implement" && !approvedPlanArtifact);
  const effectiveMode: ExecutionMode = planningPhase ? "plan_only" : baseExecutionPlan.profile.mode;
  const executionPlan: ExecutionPlan = {
    ...baseExecutionPlan,
    profile: {
      ...baseExecutionPlan.profile,
      mode: effectiveMode
    }
  };

  return {
    ticket,
    classification,
    baseExecutionPlan,
    executionPlan,
    executionPhase: planningPhase ? "planning" : "implementation",
    latestPlanArtifact,
    approvedPlanArtifact
  };
}

function promptReviewMatchesBuiltPrompt(promptReview: PromptReview, builtPrompt: BuiltPrompt): boolean {
  return (
    promptReview.promptSnapshot === builtPrompt.prompt &&
    JSON.stringify(promptReview.sources) === JSON.stringify(builtPrompt.sources) &&
    JSON.stringify(promptReview.contextSummary) === JSON.stringify(builtPrompt.contextSummary) &&
    JSON.stringify(promptReview.classificationSnapshot) === JSON.stringify(builtPrompt.executionPlan.classification) &&
    JSON.stringify(promptReview.executionPlanSnapshot) === JSON.stringify(builtPrompt.executionPlan)
  );
}

function buildPullRequestTitle(ticket: Ticket, execution: Execution): string {
  const prefix = ticket.externalId ? `[${ticket.externalId}] ` : "";
  const suffix = execution.runKind === "work_item" ? " (work item)" : "";
  return `${prefix}${ticket.title}${suffix}`;
}

function renderPullRequestBody(input: {
  template?: string;
  ticket: Ticket;
  execution: Execution;
  checkRuns: import("./types.js").CheckRun[];
  defaultBranch: string;
}): string {
  const sections = {
    Summary: buildPullRequestSummary(input.ticket, input.execution, input.defaultBranch),
    Ticket: buildTicketSection(input.ticket),
    Classification: buildClassificationSection(input.execution),
    Checks: buildChecksSection(input.checkRuns),
    "Changed Files": buildChangedFilesSection(input.execution),
    Risks: buildRisksSection(input.execution)
  };

  if (!input.template) {
    return Object.entries(sections)
      .map(([title, content]) => `# ${title}\n\n${content}`.trimEnd())
      .join("\n\n");
  }

  const blocks = input.template
    .split(/^# /m)
    .filter((block) => block.trim().length > 0)
    .map((block) => `# ${block.trim()}`);

  if (blocks.length === 0) {
    return Object.entries(sections)
      .map(([title, content]) => `# ${title}\n\n${content}`.trimEnd())
      .join("\n\n");
  }

  const rendered = blocks.map((block) => {
    const lines = block.split("\n");
    const heading = lines[0]?.replace(/^#\s+/, "").trim() ?? "";
    const replacement = sections[heading as keyof typeof sections];

    if (!replacement) {
      return block;
    }

    return `# ${heading}\n\n${replacement}`;
  });

  return rendered.join("\n\n");
}

function buildPullRequestSummary(ticket: Ticket, execution: Execution, defaultBranch: string): string {
  const firstLine = `This draft PR captures the OpenTop execution for ticket #${ticket.id} and is ready for human review.`;
  const branchLine = `Head branch: \`${execution.branchName}\` -> Base branch: \`${defaultBranch}\``;
  const outputLine =
    execution.outputKind && execution.outputText
      ? `Provider output hint: ${execution.outputKind.replace("_", " ")}.`
      : "Execution produced local workspace changes.";

  return [firstLine, branchLine, outputLine].join("\n\n");
}

function buildTicketSection(ticket: Ticket): string {
  const lines = [
    `- Ticket ID: ${ticket.id}`,
    `- Source: ${ticket.source}`,
    ticket.externalId ? `- External ID: ${ticket.externalId}` : undefined,
    `- Title: ${ticket.title}`,
    ticket.description ? `- Description: ${ticket.description}` : undefined,
    ticket.labels.length > 0 ? `- Labels: ${ticket.labels.join(", ")}` : undefined
  ];

  return lines.filter(Boolean).join("\n");
}

function buildClassificationSection(execution: Execution): string {
  const classification = execution.classificationSnapshot;
  return [
    `- Task type: ${classification.taskType}`,
    `- Risk: ${classification.risk}`,
    `- Complexity: ${classification.complexity}`,
    `- Suggested profile: ${classification.suggestedProfile}`,
    `- Suggested provider: ${classification.suggestedProviderId}`,
    `- Suggested model: ${classification.suggestedModel}`,
    `- Signals: ${classification.detectedSignals.join(", ") || "none"}`
  ].join("\n");
}

function buildChecksSection(checkRuns: import("./types.js").CheckRun[]): string {
  if (checkRuns.length === 0) {
    return "- No post-run checks were recorded.";
  }

  return checkRuns
    .map((checkRun) => {
      const command = checkRun.command ? ` (\`${checkRun.command}\`)` : "";
      const exit = typeof checkRun.exitCode === "number" ? `, exit ${checkRun.exitCode}` : "";
      return `- ${checkRun.name}: ${checkRun.status}${command}${exit}`;
    })
    .join("\n");
}

function buildChangedFilesSection(execution: Execution): string {
  if (!execution.diffSummary || execution.diffSummary.files.length === 0) {
    return execution.changedFiles.length > 0
      ? execution.changedFiles.map((filePath) => `- ${filePath}`).join("\n")
      : "- No changed files were recorded.";
  }

  return execution.diffSummary.files
    .map(
      (file) =>
        `- ${file.path}: ${file.changeType}, +${file.additions} / -${file.deletions}`
    )
    .join("\n");
}

function buildRisksSection(execution: Execution): string {
  if (!execution.riskSummary) {
    return "- No additional risks were recorded.";
  }

  const reasons = execution.riskSummary.reasons.map((reason) => `- ${reason}`);
  const suggestedActions = execution.riskSummary.suggestedActions.map((action) => `- Follow-up: ${action}`);
  return [`- Risk level: ${execution.riskSummary.level}`, ...reasons, ...suggestedActions].join("\n");
}

function normalizeLogEntries(logs: string[]): string[] {
  return logs
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.length > 0);
}

async function finalizeExecutionArtifacts(input: {
  execution: Execution;
  executionRepository: ExecutionRepository;
  checkRunRepository: CheckRunRepository;
  config: OpenTopConfig;
  workspace: ExecutionWorkspace;
  workspacePath: string;
  classification: Classification;
  providerResult: { summary: string; logs: string[]; outputKind?: Execution["outputKind"]; outputText?: string };
  artifactKind: Execution["artifactKind"];
  successStatus: "succeeded" | "output_ready";
  changedFiles: string[];
}): Promise<Execution> {
  const requiresReview = input.artifactKind === "workspace_changes" && input.changedFiles.length > 0;
  const checkRuns = requiresReview
    ? await runConfiguredChecks(input.checkRunRepository, input.execution.id, input.config, input.workspacePath)
    : [];
  const diffSummary = requiresReview ? await input.workspace.getDiffSummary(input.changedFiles) : undefined;
  const riskSummary = requiresReview
    ? buildExecutionRiskSummary(input.classification, checkRuns, diffSummary, input.changedFiles)
    : undefined;
  const checkLogs = summarizeCheckRuns(checkRuns, diffSummary);

  return input.executionRepository.update(input.execution.id, {
    status: input.successStatus,
    artifactKind: input.artifactKind,
    outputKind: input.providerResult.outputKind,
    outputText: input.providerResult.outputText,
    changedFiles: input.changedFiles,
    reviewStatus: requiresReview ? "pending" : "not_required",
    diffSummary,
    riskSummary,
    logs: [
      ...input.execution.logs,
      ...normalizeLogEntries(input.providerResult.logs),
      `Provider summary: ${input.providerResult.summary}`,
      ...checkLogs
    ]
  });
}

async function runConfiguredChecks(
  checkRunRepository: CheckRunRepository,
  executionId: string,
  config: OpenTopConfig,
  workspacePath: string
): Promise<import("./types.js").CheckRun[]> {
  const configuredChecks = [
    {
      name: "build",
      command: typeof config.commands.build === "string" ? config.commands.build : undefined
    },
    {
      name: "test",
      command: typeof config.commands.test === "string" ? config.commands.test : undefined
    }
  ];
  const checkRuns: import("./types.js").CheckRun[] = [];

  for (const check of configuredChecks) {
    if (!check.command) {
      checkRuns.push(
        await checkRunRepository.create({
          executionId,
          name: check.name,
          status: "skipped",
          output: `No ${check.name} command is configured for this project.`
        })
      );
      continue;
    }

    const result = await runShellCommand(check.command, workspacePath);
    checkRuns.push(
      await checkRunRepository.create({
        executionId,
        name: check.name,
        command: check.command,
        status: result.exitCode === 0 ? "passed" : "failed",
        exitCode: result.exitCode,
        output: result.output
      })
    );
  }

  return checkRuns;
}

async function runShellCommand(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        output: truncateOutput([stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n\n"))
      });
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        output: truncateOutput(`Failed to start "${command}": ${error.message}`)
      });
    });
  });
}

function summarizeCheckRuns(
  checkRuns: import("./types.js").CheckRun[],
  diffSummary?: ExecutionDiffSummary
): string[] {
  const lines = checkRuns.map((checkRun) => {
    const commandSuffix = checkRun.command ? ` (${checkRun.command})` : "";
    const exitCodeSuffix = typeof checkRun.exitCode === "number" ? `, exit ${checkRun.exitCode}` : "";
    return `Check ${checkRun.name}${commandSuffix}: ${checkRun.status}${exitCodeSuffix}.`;
  });

  if (diffSummary) {
    lines.push(
      `Diff summary: ${diffSummary.totalFiles} file(s), +${diffSummary.totalAdditions} / -${diffSummary.totalDeletions}.`
    );
  }

  return lines;
}

function buildExecutionRiskSummary(
  classification: Classification,
  checkRuns: import("./types.js").CheckRun[],
  diffSummary: ExecutionDiffSummary | undefined,
  changedFiles: string[]
): ExecutionRiskSummary {
  const failedChecks = checkRuns.filter((checkRun) => checkRun.status === "failed").map((checkRun) => checkRun.name);
  const reasons = ["Local workspace changes require human review before they can be treated as done."];
  const suggestedActions = ["Review the changed files and diff summary before approving this execution."];
  let level = classification.risk;

  if (failedChecks.length > 0) {
    level = elevateRiskLevel(level, "high");
    reasons.push(`Checks failed: ${failedChecks.join(", ")}.`);
    suggestedActions.push("Fix or explicitly override failing checks before approving these changes.");
  }

  if (diffSummary && diffSummary.totalFiles >= 10) {
    level = elevateRiskLevel(level, "high");
    reasons.push(`This execution changed ${diffSummary.totalFiles} files, which increases review scope.`);
  }

  if (diffSummary && diffSummary.totalAdditions + diffSummary.totalDeletions >= 400) {
    level = elevateRiskLevel(level, "critical");
    reasons.push("The diff is large enough to warrant a slower, more deliberate review.");
  }

  if (changedFiles.some((filePath) => /package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|schema|migration/i.test(filePath))) {
    level = elevateRiskLevel(level, "high");
    reasons.push("Dependency or schema-adjacent files changed and should be checked carefully.");
    suggestedActions.push("Review dependency, lockfile, and schema-related changes with extra care.");
  }

  if (classification.taskType === "security" || classification.risk === "critical") {
    level = elevateRiskLevel(level, "critical");
    suggestedActions.push("Consider a second human reviewer because this task is inherently sensitive.");
  }

  return {
    level,
    reviewRequired: true,
    reasons,
    suggestedActions: uniqueStrings(suggestedActions),
    failedChecks
  };
}

function elevateRiskLevel(current: ExecutionRiskSummary["level"], candidate: ExecutionRiskSummary["level"]) {
  const order: Record<ExecutionRiskSummary["level"], number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
  };

  return order[candidate] > order[current] ? candidate : current;
}

function truncateOutput(value: string, maxLength = 12000): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n\n[output truncated]`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

async function collectDependencyExecutions(
  executionRepository: ExecutionRepository,
  workItems: WorkItem[],
  dependencyKeys: string[]
): Promise<Execution[]> {
  const dependencyExecutions: Execution[] = [];

  for (const dependencyKey of dependencyKeys) {
    const dependency = workItems.find(
      (entry) => entry.key === dependencyKey || entry.sourcePlanWorkItemId === dependencyKey
    );

    if (!dependency) {
      continue;
    }

    const executions = await executionRepository.listByWorkItemId(dependency.id);
    const latestExecution = executions[0];

    if (latestExecution) {
      dependencyExecutions.push(latestExecution);
    }
  }

  return dependencyExecutions;
}

async function unblockDependentWorkItems(
  workItemRepository: WorkItemRepository,
  workItems: WorkItem[],
  completedWorkItem: WorkItem
): Promise<void> {
  const refreshedWorkItems = await workItemRepository.listByWorkerPlanId(completedWorkItem.workerPlanId);
  const allItems = mergeWorkItems(workItems, refreshedWorkItems);

  for (const candidate of allItems) {
    if (candidate.status !== "blocked") {
      continue;
    }

    const dependenciesSatisfied = candidate.dependsOn.every((dependencyKey) => {
      const dependency = allItems.find(
        (entry) => entry.key === dependencyKey || entry.sourcePlanWorkItemId === dependencyKey
      );
      return dependency?.status === "done";
    });

    if (dependenciesSatisfied) {
      await workItemRepository.update(candidate.id, { status: "ready" });
    }
  }
}

function mergeWorkItems(original: WorkItem[], refreshed: WorkItem[]): WorkItem[] {
  const byId = new Map<string, WorkItem>();

  for (const workItem of original) {
    byId.set(workItem.id, workItem);
  }

  for (const workItem of refreshed) {
    byId.set(workItem.id, workItem);
  }

  return [...byId.values()];
}

async function getRequiredWorkerPlan(workerPlanRepository: WorkerPlanRepository, workerPlanId: string): Promise<WorkerPlan> {
  const workerPlan = await workerPlanRepository.findById(workerPlanId);

  if (!workerPlan) {
    throw new Error(`Worker plan "${workerPlanId}" was not found in the local OpenTop store.`);
  }

  return workerPlan;
}

async function getApprovedPlanArtifactForWorkerPlan(
  planArtifactRepository: PlanArtifactRepository,
  ticketId: string,
  workerPlan: WorkerPlan
): Promise<PlanArtifact> {
  const planArtifacts = await planArtifactRepository.listByTicketId(ticketId);
  const approvedPlanArtifact = planArtifacts.find((artifact) => artifact.status === "approved");

  if (!approvedPlanArtifact) {
    throw new Error("An approved plan artifact is required before executing worker plans.");
  }

  return approvedPlanArtifact;
}

async function getRequiredTicket(repository: TicketRepository, ticketId: string): Promise<Ticket> {
  const ticket = await repository.findById(ticketId);

  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" was not found in the local OpenTop store.`);
  }

  return ticket;
}

async function getLatestExecutionForTicket(
  executionRepository: ExecutionRepository,
  ticketId: string
): Promise<Execution | undefined> {
  const executions = await executionRepository.listByTicketId(ticketId);
  return [...executions].sort((left, right) => Number(right.id) - Number(left.id))[0];
}

function deriveActiveTicketStatus(
  approvalRequired: boolean,
  latestExecution: Execution | undefined
): Ticket["status"] {
  if (!latestExecution) {
    return approvalRequired ? "ready" : "classified";
  }

  if (latestExecution.status === "planned" || latestExecution.status === "queued" || latestExecution.status === "running") {
    return "running";
  }

  if (latestExecution.status === "output_ready") {
    return "review";
  }

  if (latestExecution.status === "succeeded") {
    return latestExecution.reviewStatus === "approved" || latestExecution.reviewStatus === "not_required"
      ? "ready"
      : "review";
  }

  return "classified";
}
