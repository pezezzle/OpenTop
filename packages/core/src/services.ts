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
  ticketId: string
): Promise<{ execution: Execution; executionPlan: ExecutionPlan; sources: string[] }> {
  const builtPrompt = await buildPromptForStoredTicket(ticketRepository, config, projectContext, ticketId);
  const execution = await executionRepository.create({
    ticketId: builtPrompt.executionPlan.ticket.id,
    profileId: builtPrompt.executionPlan.profile.id,
    providerId: builtPrompt.executionPlan.providerId,
    modelId: builtPrompt.executionPlan.modelId,
    status: "planned",
    branchName: builtPrompt.executionPlan.branchName,
    promptSnapshot: builtPrompt.prompt,
    classificationSnapshot: builtPrompt.executionPlan.classification,
    logs: [],
    changedFiles: []
  });

  return {
    execution,
    executionPlan: builtPrompt.executionPlan,
    sources: builtPrompt.sources
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
