import { classifyTicket } from "./classifier.js";
import type { OpenTopConfig } from "./config.js";
import { createExecutionPlan } from "./execution.js";
import { buildAgentPrompt } from "./prompt-builder.js";
import type { TicketRepository } from "./repositories.js";
import type {
  BuiltPrompt,
  Classification,
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

async function getRequiredTicket(repository: TicketRepository, ticketId: string): Promise<Ticket> {
  const ticket = await repository.findById(ticketId);

  if (!ticket) {
    throw new Error(`Ticket "${ticketId}" was not found in the local OpenTop store.`);
  }

  return ticket;
}
