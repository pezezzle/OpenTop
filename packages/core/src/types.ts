import type {
  ComplexityLevel,
  ExecutionBranchPolicy,
  ExecutionMode,
  ExecutionStatus,
  RiskLevel,
  TicketResolutionType,
  TicketSource,
  TicketStatus
} from "@opentop/shared";

export type TaskCategory =
  | "bugfix"
  | "small_change"
  | "feature"
  | "architecture"
  | "refactor"
  | "test"
  | "docs"
  | "security"
  | "migration"
  | "integration";

export type ContextProfileMode = "project-first" | "profile-first" | "project-only" | "profile-only" | "manual";

export interface ContextSettings {
  learnedProfiles: string[];
  userProfiles: string[];
  profileMode: ContextProfileMode;
  maxPromptProfileWords: number;
  maxProfileSections: number;
}

export interface LoadedContextProfile {
  id: string;
  type: "user" | "learned-project" | "team" | "organization";
  displayName: string;
  description?: string;
  sourcePath: string;
  promptBudget: {
    maxProfileSections?: number;
    maxProfileWords?: number;
  };
  sections: Record<string, string>;
}

export interface PromptContextSummary {
  profileMode: ContextProfileMode;
  activeProfiles: Array<{
    id: string;
    type: LoadedContextProfile["type"];
    displayName: string;
  }>;
  includedSections: string[];
  skippedSections: string[];
  influences: string[];
  budget: {
    maxPromptProfileWords: number;
    maxProfileSections: number;
    usedProfileWords: number;
    usedProfileSections: number;
  };
}

export interface Ticket {
  id: string;
  source: TicketSource;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status: TicketStatus;
  resolutionType?: TicketResolutionType;
  resolutionNote?: string;
  resolvedAt?: string;
  classification?: Classification;
}

export interface TicketCreateInput {
  source: TicketSource;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status?: TicketStatus;
  resolutionType?: TicketResolutionType;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface TicketUpdateInput {
  status?: TicketStatus;
  resolutionType?: TicketResolutionType;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface Classification {
  taskType: TaskCategory;
  risk: RiskLevel;
  complexity: ComplexityLevel;
  affectedAreas: string[];
  detectedSignals: string[];
  suggestedProfile: string;
  suggestedProviderId: string;
  suggestedModelTier: string;
  suggestedModel: string;
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

export type ExecutionArtifactKind = "workspace_changes" | "review_output";
export type ExecutionOutputKind = "plan" | "patch_proposal" | "review_note" | "general";
export type ExecutionRunKind = "ticket" | "planning" | "work_item";
export type ExecutionReviewStatus = "not_required" | "pending" | "approved" | "rejected";
export type CheckRunStatus = "passed" | "failed" | "skipped";
export type PromptReviewStatus = "draft" | "approved" | "rejected" | "superseded";
export type PlanArtifactStatus = "draft" | "approved" | "rejected" | "superseded";
export type WorkerPlanStatus =
  | "draft"
  | "ready"
  | "running"
  | "integration_ready"
  | "failed"
  | "superseded";
export type WorkItemStatus =
  | "planned"
  | "ready"
  | "blocked"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled"
  | "superseded";
export type WorkerRole =
  | "backend"
  | "frontend"
  | "data"
  | "integration"
  | "test"
  | "docs"
  | "security"
  | "reviewer"
  | "generalist";
export type WorkItemBranchStrategy = "isolated_worktree" | "shared_ticket_branch" | "reuse_parent_branch";

export interface StructuredPlanStep {
  id: string;
  title: string;
  summary?: string;
  acceptanceCriteria: string[];
  affectedAreas: string[];
}

export interface StructuredPlanWorkItem {
  id: string;
  title: string;
  summary: string;
  affectedAreas: string[];
  suggestedMode: ExecutionMode;
  dependsOn: string[];
}

export interface StructuredPlan {
  summary?: string;
  assumptions: string[];
  implementationSteps: StructuredPlanStep[];
  risks: string[];
  openQuestions: string[];
  workItems: StructuredPlanWorkItem[];
}

export interface Execution {
  id: string;
  ticketId: string;
  workerPlanId?: string;
  workItemId?: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: ExecutionStatus;
  runKind: ExecutionRunKind;
  branchName: string;
  workspacePath: string;
  promptSnapshot: string;
  classificationSnapshot: Classification;
  artifactKind: ExecutionArtifactKind;
  outputKind?: ExecutionOutputKind;
  outputText?: string;
  reviewStatus: ExecutionReviewStatus;
  reviewerComment?: string;
  reviewedAt?: string;
  diffSummary?: ExecutionDiffSummary;
  riskSummary?: ExecutionRiskSummary;
  pullRequest?: ExecutionPullRequest;
  logs: string[];
  changedFiles: string[];
  pullRequestUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionDiffFileSummary {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unknown";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ExecutionDiffSummary {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: ExecutionDiffFileSummary[];
}

export interface ExecutionRiskSummary {
  level: "low" | "medium" | "high" | "critical";
  reviewRequired: boolean;
  reasons: string[];
  suggestedActions: string[];
  failedChecks: string[];
}

export interface ExecutionPullRequest {
  url: string;
  number?: number;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  repositoryFullName: string;
  isDraft: boolean;
  createdAt: string;
}

export interface CheckRun {
  id: string;
  executionId: string;
  name: string;
  command?: string;
  status: CheckRunStatus;
  exitCode?: number;
  output: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptReview {
  id: string;
  ticketId: string;
  version: number;
  status: PromptReviewStatus;
  promptSnapshot: string;
  sources: string[];
  contextSummary: PromptContextSummary;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanArtifact {
  id: string;
  ticketId: string;
  sourceExecutionId: string;
  sourcePromptReviewId: string;
  version: number;
  status: PlanArtifactStatus;
  rawOutput: string;
  structuredPlan: StructuredPlan;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerPlan {
  id: string;
  ticketId: string;
  sourcePlanArtifactId: string;
  version: number;
  status: WorkerPlanStatus;
  summary?: string;
  integrationSummary?: string;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItem {
  id: string;
  workerPlanId: string;
  ticketId: string;
  sourcePlanArtifactId: string;
  sourcePlanWorkItemId?: string;
  key: string;
  title: string;
  summary: string;
  role: WorkerRole;
  status: WorkItemStatus;
  affectedAreas: string[];
  dependsOn: string[];
  suggestedProviderId: string;
  suggestedModelTier: string;
  suggestedModelId: string;
  suggestedMode: ExecutionMode;
  branchStrategy: WorkItemBranchStrategy;
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PromptReviewCreateInput {
  ticketId: string;
  version: number;
  status: PromptReviewStatus;
  promptSnapshot: string;
  sources: string[];
  contextSummary: PromptContextSummary;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
}

export interface PromptReviewUpdateInput {
  status?: PromptReviewStatus;
  promptSnapshot?: string;
  sources?: string[];
  contextSummary?: PromptContextSummary;
  classificationSnapshot?: Classification;
  executionPlanSnapshot?: ExecutionPlan;
  reviewerComment?: string;
}

export interface PlanArtifactCreateInput {
  ticketId: string;
  sourceExecutionId: string;
  sourcePromptReviewId: string;
  version: number;
  status: PlanArtifactStatus;
  rawOutput: string;
  structuredPlan: StructuredPlan;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
}

export interface PlanArtifactUpdateInput {
  status?: PlanArtifactStatus;
  rawOutput?: string;
  structuredPlan?: StructuredPlan;
  classificationSnapshot?: Classification;
  executionPlanSnapshot?: ExecutionPlan;
  reviewerComment?: string;
}

export interface WorkerPlanCreateInput {
  ticketId: string;
  sourcePlanArtifactId: string;
  version: number;
  status: WorkerPlanStatus;
  summary?: string;
  integrationSummary?: string;
  classificationSnapshot: Classification;
  executionPlanSnapshot: ExecutionPlan;
  reviewerComment?: string;
}

export interface WorkerPlanUpdateInput {
  status?: WorkerPlanStatus;
  summary?: string;
  integrationSummary?: string;
  classificationSnapshot?: Classification;
  executionPlanSnapshot?: ExecutionPlan;
  reviewerComment?: string;
}

export interface WorkItemCreateInput {
  workerPlanId: string;
  ticketId: string;
  sourcePlanArtifactId: string;
  sourcePlanWorkItemId?: string;
  key: string;
  title: string;
  summary: string;
  role: WorkerRole;
  status: WorkItemStatus;
  affectedAreas: string[];
  dependsOn: string[];
  suggestedProviderId: string;
  suggestedModelTier: string;
  suggestedModelId: string;
  suggestedMode: ExecutionMode;
  branchStrategy: WorkItemBranchStrategy;
  reviewNotes: string[];
}

export interface WorkItemUpdateInput {
  title?: string;
  summary?: string;
  role?: WorkerRole;
  status?: WorkItemStatus;
  affectedAreas?: string[];
  dependsOn?: string[];
  suggestedProviderId?: string;
  suggestedModelTier?: string;
  suggestedModelId?: string;
  suggestedMode?: ExecutionMode;
  branchStrategy?: WorkItemBranchStrategy;
  reviewNotes?: string[];
}

export interface ExecutionCreateInput {
  ticketId: string;
  workerPlanId?: string;
  workItemId?: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: ExecutionStatus;
  runKind: ExecutionRunKind;
  branchName: string;
  workspacePath: string;
  promptSnapshot: string;
  classificationSnapshot: Classification;
  artifactKind?: ExecutionArtifactKind;
  outputKind?: ExecutionOutputKind;
  outputText?: string;
  reviewStatus?: ExecutionReviewStatus;
  reviewerComment?: string;
  reviewedAt?: string;
  diffSummary?: ExecutionDiffSummary;
  riskSummary?: ExecutionRiskSummary;
  pullRequest?: ExecutionPullRequest;
  logs?: string[];
  changedFiles?: string[];
  pullRequestUrl?: string;
}

export interface ExecutionUpdateInput {
  status?: ExecutionStatus;
  workerPlanId?: string;
  workItemId?: string;
  runKind?: ExecutionRunKind;
  branchName?: string;
  workspacePath?: string;
  artifactKind?: ExecutionArtifactKind;
  outputKind?: ExecutionOutputKind;
  outputText?: string;
  reviewStatus?: ExecutionReviewStatus;
  reviewerComment?: string;
  reviewedAt?: string;
  diffSummary?: ExecutionDiffSummary;
  riskSummary?: ExecutionRiskSummary;
  pullRequest?: ExecutionPullRequest;
  logs?: string[];
  changedFiles?: string[];
  pullRequestUrl?: string;
}

export interface CheckRunCreateInput {
  executionId: string;
  name: string;
  command?: string;
  status: CheckRunStatus;
  exitCode?: number;
  output: string;
}

export interface CheckRunUpdateInput {
  status?: CheckRunStatus;
  exitCode?: number;
  output?: string;
}

export interface PullRequestDraftInput {
  repositoryPath: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
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

export interface ExecutionProviderRequest {
  ticketTitle: string;
  ticketDescription: string;
  repositoryPath: string;
  branchName: string;
  agentProfile: string;
  model: string;
  mode: ExecutionMode;
  projectRules: string;
  prompt: string;
}

export interface ExecutionProviderResult {
  success: boolean;
  summary: string;
  artifactKind?: ExecutionArtifactKind;
  outputKind?: ExecutionOutputKind;
  outputText?: string;
  changedFiles: string[];
  logs: string[];
}

export interface PreparedWorkItemWorkspace {
  branchName: string;
  repositoryPath: string;
  repositoryState: RepositoryState;
  logs: string[];
  strategy: WorkItemBranchStrategy;
  workspace: import("./repositories.js").ExecutionWorkspace;
}

export interface WorkItemExecutionResult {
  status: "blocked" | "succeeded" | "output_ready" | "failed";
  workerPlan: WorkerPlan;
  workItem: WorkItem;
  execution?: Execution;
  reason?: string;
  repositoryPath?: string;
}

export interface WorkerPlanRunResult {
  status: "blocked" | "running" | "integration_ready" | "failed";
  workerPlan: WorkerPlan;
  workItems: WorkItem[];
  executions: Execution[];
  summary: string;
  integrationSummary: string;
  integrationIssues: string[];
  blockedWorkItemIds: string[];
  failedWorkItemIds: string[];
}

export interface OpenTopProjectContext {
  rootDirectory: string;
  projectContext?: string;
  rules?: string;
  memory: Record<string, string>;
  prompts: Record<string, string>;
  pullRequestTemplate?: string;
  settings: ContextSettings;
  activeProfiles: LoadedContextProfile[];
}

export interface PromptBuildInput {
  ticket: Ticket;
  config: import("./config.js").OpenTopConfig;
  projectContext: OpenTopProjectContext;
  executionPlan?: ExecutionPlan;
  approvedPlanArtifact?: PlanArtifact;
  executionPhase?: "planning" | "implementation";
}

export interface BuiltPrompt {
  prompt: string;
  executionPlan: ExecutionPlan;
  sources: string[];
  contextSummary: PromptContextSummary;
}

export type ExecutionRunResult =
  | {
      status: "blocked";
      executionPlan: ExecutionPlan;
      branchResolution: ExecutionBranchResolution;
      blocker: "branch_policy" | "prompt_review" | "plan_review" | "provider_runtime";
      reason: string;
      promptReview?: PromptReview;
      planArtifact?: PlanArtifact;
    }
  | {
      status: "succeeded" | "output_ready";
      execution: Execution;
      executionPlan: ExecutionPlan;
      sources: string[];
      branchResolution: ExecutionBranchResolution;
      promptReview: PromptReview;
      planArtifact?: PlanArtifact;
    }
  | {
      status: "failed";
      execution: Execution;
      executionPlan: ExecutionPlan;
      sources: string[];
      branchResolution: ExecutionBranchResolution;
      error: string;
      promptReview: PromptReview;
      planArtifact?: PlanArtifact;
    };
