import type { Ticket, TicketCreateInput } from "./types.js";

export interface TicketRepository {
  create(input: TicketCreateInput): Promise<Ticket>;
  findById(id: string): Promise<Ticket | null>;
  list(): Promise<Ticket[]>;
}
