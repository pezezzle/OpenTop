import type {
  Execution,
  ExecutionBranchResolution,
  ExecutionCreateInput,
  ExecutionProviderRequest,
  ExecutionProviderResult,
  ExecutionUpdateInput,
  ExecutionWorkspacePreparation,
  RepositoryState,
  Ticket,
  TicketCreateInput
} from "./types.js";

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
  update(id: string, input: ExecutionUpdateInput): Promise<Execution>;
}

export interface ExecutionWorkspace {
  prepareBranch(resolution: ExecutionBranchResolution): Promise<ExecutionWorkspacePreparation>;
  getRepositoryState(): Promise<RepositoryState>;
}

export interface ExecutionProvider {
  run(request: ExecutionProviderRequest): Promise<ExecutionProviderResult>;
}
