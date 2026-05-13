import type { ExecutionBranchPolicy } from "@opentop/shared";
import { resolveExecutionBranch } from "./branch-policy.js";
import { classifyTicket } from "./classifier.js";
import type { OpenTopConfig } from "./config.js";
import { createExecutionPlan } from "./execution.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import type { ExecutionRepository, TicketRepository } from "./repositories.js";
import type {
  BuiltPrompt,
  Classification,
  Execution,
  ExecutionPlan,
  OpenTopProjectContext,
  PreparedExecutionResult,
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

export async function createPlannedExecutionForStoredTicket(
  ticketRepository: TicketRepository,
  executionRepository: ExecutionRepository,
  config: OpenTopConfig,
  projectContext: OpenTopProjectContext,
  ticketId: string,
  repositoryState: RepositoryState,
  branchPolicyOverride?: ExecutionBranchPolicy
): Promise<PreparedExecutionResult> {
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

  return {
    status: "planned",
    execution,
    executionPlan: builtPrompt.executionPlan,
    sources: builtPrompt.sources,
    branchResolution
  };
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
