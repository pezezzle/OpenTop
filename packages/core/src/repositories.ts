import type { Execution, ExecutionCreateInput, Ticket, TicketCreateInput } from "./types.js";

export interface TicketRepository {
  create(input: TicketCreateInput): Promise<Ticket>;
  findById(id: string): Promise<Ticket | null>;
  list(): Promise<Ticket[]>;
}

export interface ExecutionRepository {
  create(input: ExecutionCreateInput): Promise<Execution>;
  findById(id: string): Promise<Execution | null>;
  list(): Promise<Execution[]>;
  listByTicketId(ticketId: string): Promise<Execution[]>;
}
