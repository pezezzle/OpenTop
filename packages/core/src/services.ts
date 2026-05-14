import type { ExecutionBranchPolicy } from "@opentop/shared";
import { resolveExecutionBranch } from "./branch-policy.js";
import { classifyTicket } from "./classifier.js";
import type { OpenTopConfig } from "./config.js";
import { createExecutionPlan } from "./execution.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import type { ExecutionProvider, ExecutionRepository, ExecutionWorkspace, TicketRepository } from "./repositories.js";
import type {
  BuiltPrompt,
  Classification,
  Execution,
  ExecutionRunResult,
  ExecutionPlan,
  OpenTopProjectContext,
  RepositoryState,
  Ticket,
  TicketCreateInput
} from "./types.js";

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
  ticketId: string
): Promise<BuiltPrompt> {
  const ticket = await getRequiredTicket(repository, ticketId);
  const classification = classifyTicket(ticket, config);

  return buildAgentPrompt({
    ticket: { ...ticket, classification },
    config,
    projectContext
  });
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
  executionRepository: ExecutionRepository,
  executionWorkspace: ExecutionWorkspace,
  executionProvider: ExecutionProvider,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  repositoryState: RepositoryState,
  branchPolicyOverride?: ExecutionBranchPolicy
): Promise<ExecutionRunResult> {
  const ticket = await getRequiredTicket(ticketRepository, ticketId);
  const classification = classifyTicket(ticket, config);
  const baseExecutionPlan = createExecutionPlan({ ...ticket, classification }, config);
  const branchResolution = resolveExecutionBranch(baseExecutionPlan, config, repositoryState, branchPolicyOverride);
  const executionPlan = {
    ...baseExecutionPlan,
    branchName: branchResolution.branchName ?? "none"
  };

  if (branchResolution.decision === "blocked") {
    return {
      status: "blocked",
      executionPlan,
      branchResolution
    };
  }

  const builtPrompt = buildAgentPrompt({
    ticket: { ...ticket, classification },
    config,
    projectContext,
    executionPlan
  });
  const execution = await executionRepository.create({
    ticketId: executionPlan.ticket.id,
    profileId: executionPlan.profile.id,
    providerId: executionPlan.providerId,
    modelId: executionPlan.modelId,
    status: "planned",
    branchName: executionPlan.branchName,
    promptSnapshot: builtPrompt.prompt,
    classificationSnapshot: executionPlan.classification,
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
    const changedFiles = uniqueStrings([
      ...providerResult.changedFiles,
      ...repositoryStateAfterRun.changedFiles
    ]);
    const finalStatus = providerResult.success ? "succeeded" : "failed";
    const finalExecution = await executionRepository.update(runningExecution.id, {
      status: finalStatus,
      changedFiles,
      logs: [
        ...runningExecution.logs,
        ...normalizeLogEntries(providerResult.logs),
        `Provider summary: ${providerResult.summary}`
      ]
    });

    if (!providerResult.success) {
      return {
        status: "failed",
        execution: finalExecution,
        executionPlan: {
          ...builtPrompt.executionPlan,
          branchName: workspacePreparation.branchName
        },
        sources: builtPrompt.sources,
        branchResolution,
        error: providerResult.summary
      };
    }

    return {
      status: "succeeded",
      execution: finalExecution,
      executionPlan: {
        ...builtPrompt.executionPlan,
        branchName: workspacePreparation.branchName
      },
      sources: builtPrompt.sources,
      branchResolution
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
      error: message
    };
  }
}

function normalizeLogEntries(logs: string[]): string[] {
  return logs
    .flatMap((entry) => entry.split(/\r?\n/))
    .map((entry) => entry.trimEnd())
    .filter((entry) => entry.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export async function listExecutions(repository: ExecutionRepository): Promise<Execution[]> {
  return repository.list();
}

export async function getExecution(repository: ExecutionRepository, executionId: string): Promise<Execution> {
  const execution = await repository.findById(executionId);

  if (!execution) {
    throw new Error(`Execution "${executionId}" was not found in the local OpenTop store.`);
  }

  return execution;
}

async function getRequiredTicket(repository: TicketRepository, ticketId: string): Promise<Ticket> {
  const ticket = await repository.findById(ticketId);

  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" was not found in the local OpenTop store.`);
  }

  return ticket;
}
