import type {
  CheckRun,
  CheckRunCreateInput,
  CheckRunUpdateInput,
  Execution,
  ExecutionBranchResolution,
  ExecutionCreateInput,
  ExecutionProviderRequest,
  ExecutionProviderResult,
  WorkItem,
  WorkItemCreateInput,
  WorkItemUpdateInput,
  PlanArtifact,
  PlanArtifactCreateInput,
  PlanArtifactUpdateInput,
  PromptReview,
  PromptReviewCreateInput,
  PromptReviewUpdateInput,
  ExecutionUpdateInput,
  ExecutionWorkspacePreparation,
  PullRequestDraftInput,
  RepositoryState,
  Ticket,
  TicketCreateInput
} from "./types.js";
import type {
  WorkerPlan,
  WorkerPlanCreateInput,
  WorkerPlanUpdateInput
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
  listByWorkerPlanId(workerPlanId: string): Promise<Execution[]>;
  listByWorkItemId(workItemId: string): Promise<Execution[]>;
  update(id: string, input: ExecutionUpdateInput): Promise<Execution>;
}

export interface CheckRunRepository {
  create(input: CheckRunCreateInput): Promise<CheckRun>;
  findById(id: string): Promise<CheckRun | null>;
  listByExecutionId(executionId: string): Promise<CheckRun[]>;
  update(id: string, input: CheckRunUpdateInput): Promise<CheckRun>;
}

export interface PromptReviewRepository {
  create(input: PromptReviewCreateInput): Promise<PromptReview>;
  findById(id: string): Promise<PromptReview | null>;
  listByTicketId(ticketId: string): Promise<PromptReview[]>;
  update(id: string, input: PromptReviewUpdateInput): Promise<PromptReview>;
}

export interface PlanArtifactRepository {
  create(input: PlanArtifactCreateInput): Promise<PlanArtifact>;
  findById(id: string): Promise<PlanArtifact | null>;
  listByTicketId(ticketId: string): Promise<PlanArtifact[]>;
  update(id: string, input: PlanArtifactUpdateInput): Promise<PlanArtifact>;
}

export interface WorkerPlanRepository {
  create(input: WorkerPlanCreateInput): Promise<WorkerPlan>;
  findById(id: string): Promise<WorkerPlan | null>;
  listByTicketId(ticketId: string): Promise<WorkerPlan[]>;
  update(id: string, input: WorkerPlanUpdateInput): Promise<WorkerPlan>;
}

export interface WorkItemRepository {
  create(input: WorkItemCreateInput): Promise<WorkItem>;
  findById(id: string): Promise<WorkItem | null>;
  listByTicketId(ticketId: string): Promise<WorkItem[]>;
  listByWorkerPlanId(workerPlanId: string): Promise<WorkItem[]>;
  update(id: string, input: WorkItemUpdateInput): Promise<WorkItem>;
}

export interface ExecutionWorkspace {
  prepareBranch(resolution: ExecutionBranchResolution): Promise<ExecutionWorkspacePreparation>;
  getRepositoryState(): Promise<RepositoryState>;
  getDiffSummary(changedFiles: string[]): Promise<import("./types.js").ExecutionDiffSummary | undefined>;
}

export interface ExecutionProvider {
  run(request: ExecutionProviderRequest): Promise<ExecutionProviderResult>;
}

export interface PullRequestService {
  createDraft(input: PullRequestDraftInput): Promise<import("./types.js").ExecutionPullRequest>;
}
