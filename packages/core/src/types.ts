import type {
  ComplexityLevel,
  ExecutionBranchPolicy,
  ExecutionMode,
  ExecutionStatus,
  RiskLevel,
  TicketSource,
  TicketStatus
} from "@opentop/shared";

export interface Ticket {
  id: string;
  source: TicketSource;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status: TicketStatus;
  classification?: Classification;
}

export interface TicketCreateInput {
  source: TicketSource;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status?: TicketStatus;
}

export interface Classification {
  risk: RiskLevel;
  complexity: ComplexityLevel;
  affectedAreas: string[];
  suggestedProfile: string;
  suggestedModelTier: string;
  suggestedMode: ExecutionMode;
  approvalRequired: boolean;
  reason: string;
}

export interface AgentProfile {
  id: string;
  description?: string;
  mode: ExecutionMode;
  modelTier: string;
  requiresApproval: boolean;
  allowedCommands: string[];
}

export interface Execution {
  id: string;
  ticketId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: ExecutionStatus;
  branchName: string;
  promptSnapshot: string;
  classificationSnapshot: Classification;
  logs: string[];
  changedFiles: string[];
  pullRequestUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionCreateInput {
  ticketId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: ExecutionStatus;
  branchName: string;
  promptSnapshot: string;
  classificationSnapshot: Classification;
  logs?: string[];
  changedFiles?: string[];
  pullRequestUrl?: string;
}

export interface ExecutionUpdateInput {
  status?: ExecutionStatus;
  branchName?: string;
  logs?: string[];
  changedFiles?: string[];
  pullRequestUrl?: string;
}

export interface ExecutionPlan {
  ticket: Ticket;
  classification: Classification;
  profile: AgentProfile;
  providerId: string;
  modelId: string;
  branchName: string;
}

export type ExecutionBranchDecision = "new" | "reuse-current" | "none" | "blocked";

export interface RepositoryState {
  currentBranch: string;
  isClean: boolean;
  changedFiles: string[];
}

export interface ExecutionBranchResolution {
  policy: ExecutionBranchPolicy;
  decision: ExecutionBranchDecision;
  branchName?: string;
  reason: string;
  repositoryState: RepositoryState;
}

export interface ExecutionWorkspacePreparation {
  branchName: string;
  logs: string[];
}

export interface OpenTopProjectContext {
  rootDirectory: string;
  projectContext?: string;
  rules?: string;
  memory: Record<string, string>;
  prompts: Record<string, string>;
  pullRequestTemplate?: string;
}

export interface PromptBuildInput {
  ticket: Ticket;
  config: import("./config.js").OpenTopConfig;
  projectContext: OpenTopProjectContext;
  executionPlan?: ExecutionPlan;
}

export interface BuiltPrompt {
  prompt: string;
  executionPlan: ExecutionPlan;
  sources: string[];
}

export type ExecutionRunResult =
  | {
      status: "blocked";
      executionPlan: ExecutionPlan;
      branchResolution: ExecutionBranchResolution;
    }
  | {
      status: "queued";
      execution: Execution;
      executionPlan: ExecutionPlan;
      sources: string[];
      branchResolution: ExecutionBranchResolution;
    }
  | {
      status: "failed";
      execution: Execution;
      executionPlan: ExecutionPlan;
      sources: string[];
      branchResolution: ExecutionBranchResolution;
      error: string;
    };
