const API_BASE_URL = process.env.OPENTOP_API_URL ?? "http://127.0.0.1:4317";
const TARGET_REPO = process.env.OPENTOP_REPO_PATH;

export interface StatusResponse {
  repository: string;
  project: string;
  defaultBranch: string;
  branchPolicy: string;
  currentBranch: string;
  isClean: boolean;
  changedFiles: string[];
  storedTickets: number;
  storedExecutions: number;
}

export interface ExecutionSummary {
  id: string;
  ticketId: string;
  workerPlanId?: string;
  workItemId?: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: string;
  runKind: "ticket" | "planning" | "work_item";
  branchName: string;
  workspacePath: string;
  promptSnapshot: string;
  artifactKind: "workspace_changes" | "review_output";
  outputKind?: "plan" | "patch_proposal" | "review_note" | "general";
  outputText?: string;
  reviewStatus: "not_required" | "pending" | "approved" | "rejected";
  reviewerComment?: string;
  reviewedAt?: string;
  diffSummary?: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
    files: Array<{
      path: string;
      changeType: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unknown";
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  };
  riskSummary?: {
    level: "low" | "medium" | "high" | "critical";
    reviewRequired: boolean;
    reasons: string[];
    suggestedActions: string[];
    failedChecks: string[];
  };
  pullRequest?: {
    url: string;
    number?: number;
    title: string;
    body: string;
    baseBranch: string;
    headBranch: string;
    repositoryFullName: string;
    isDraft: boolean;
    createdAt: string;
  };
  classificationSnapshot: {
    taskType: string;
    risk: string;
    complexity: string;
    affectedAreas: string[];
    detectedSignals: string[];
    suggestedProfile: string;
    suggestedProviderId: string;
    suggestedModelTier: string;
    suggestedModel: string;
    suggestedMode: string;
    approvalRequired: boolean;
    reason: string;
  };
  logs: string[];
  changedFiles: string[];
  pullRequestUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckRun {
  id: string;
  executionId: string;
  name: string;
  command?: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  output: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketSummary {
  id: string;
  source: string;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status: string;
  resolutionType?: "done" | "manual_pr" | "no_pr";
  resolutionNote?: string;
  resolvedAt?: string;
  classification: {
    taskType: string;
    risk: string;
    complexity: string;
    affectedAreas: string[];
    detectedSignals: string[];
    suggestedProfile: string;
    suggestedProviderId: string;
    suggestedModelTier: string;
    suggestedModel: string;
    suggestedMode: string;
    approvalRequired: boolean;
    reason: string;
  };
  executionPlan: {
    branchName: string;
    providerId: string;
    modelId: string;
    profile: {
      id: string;
      mode: string;
    };
  };
  latestExecution?: ExecutionSummary;
  workflowStage: "Inbox" | "Classified" | "Ready" | "Running" | "Review" | "Done";
}

export interface PromptContextSummaryResponse {
  profileMode: string;
  activeProfiles: Array<{
    id: string;
    type: string;
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

export interface ExecutionPlanDetailResponse {
  branchName: string;
  providerId: string;
  modelId: string;
  profile: {
    id: string;
    description?: string;
    modelTier: string;
    mode: string;
    requiresApproval: boolean;
    allowedCommands: string[];
  };
}

export interface PromptReview {
  id: string;
  ticketId: string;
  version: number;
  status: "draft" | "approved" | "rejected" | "superseded";
  promptSnapshot: string;
  sources: string[];
  contextSummary: PromptContextSummaryResponse;
  classificationSnapshot: TicketSummary["classification"];
  executionPlanSnapshot: ExecutionPlanDetailResponse;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

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
  suggestedMode: string;
  dependsOn: string[];
}

export interface PlanArtifact {
  id: string;
  ticketId: string;
  sourceExecutionId: string;
  sourcePromptReviewId: string;
  version: number;
  status: "draft" | "approved" | "rejected" | "superseded";
  rawOutput: string;
  structuredPlan: {
    summary?: string;
    assumptions: string[];
    implementationSteps: StructuredPlanStep[];
    risks: string[];
    openQuestions: string[];
    workItems: StructuredPlanWorkItem[];
  };
  classificationSnapshot: TicketSummary["classification"];
  executionPlanSnapshot: ExecutionPlanDetailResponse;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerPlan {
  id: string;
  ticketId: string;
  sourcePlanArtifactId: string;
  version: number;
  status: "draft" | "ready" | "running" | "integration_ready" | "failed" | "superseded";
  summary?: string;
  integrationSummary?: string;
  classificationSnapshot: TicketSummary["classification"];
  executionPlanSnapshot: ExecutionPlanDetailResponse;
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
  role: "backend" | "frontend" | "data" | "integration" | "test" | "docs" | "security" | "reviewer" | "generalist";
  status: "planned" | "ready" | "blocked" | "in_progress" | "done" | "failed" | "cancelled" | "superseded";
  affectedAreas: string[];
  dependsOn: string[];
  suggestedProviderId: string;
  suggestedModelTier: string;
  suggestedModelId: string;
  suggestedMode: string;
  branchStrategy: "isolated_worktree" | "shared_ticket_branch" | "reuse_parent_branch";
  reviewNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetailResponse {
  ticket: TicketSummary;
  classification: TicketSummary["classification"];
  executionPlan: ExecutionPlanDetailResponse;
  prompt: {
    prompt: string;
    sources: string[];
    contextSummary: PromptContextSummaryResponse;
  };
  promptReview: PromptReview;
  promptReviews: PromptReview[];
  planArtifact: PlanArtifact | null;
  planArtifacts: PlanArtifact[];
  workerPlan: WorkerPlan | null;
  workerPlans: WorkerPlan[];
  workItems: WorkItem[];
  executions: ExecutionSummary[];
}

export interface ConfigResponse {
  repository: string;
  project: string;
  execution: {
    defaultBranchPolicy: {
      effective?: string;
      project?: string;
      user?: string;
    };
  };
}

export interface ContextResponse {
  repository: string;
  context: {
    effective: {
      learnedProfiles: string[];
      userProfiles: string[];
      profileMode: "project-first" | "profile-first" | "project-only" | "profile-only" | "manual";
      maxPromptProfileWords: number;
      maxProfileSections: number;
    };
    project: {
      learnedProfiles: string[];
      userProfiles: string[];
      profileMode?: string;
      maxPromptProfileWords?: number;
      maxProfileSections?: number;
    } | null;
    user: {
      learnedProfiles?: string[];
      userProfiles?: string[];
      profileMode?: string;
      maxPromptProfileWords?: number;
      maxProfileSections?: number;
    } | null;
    activeProfiles: Array<{
      id: string;
      type: string;
      displayName: string;
      description?: string;
    }>;
    availableProfiles: Array<{
      id: string;
      type: string;
      displayName: string;
      description?: string;
    }>;
  };
}

export interface ProviderIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface ProviderConnectionState {
  status: "not_applicable" | "connected" | "disconnected" | "expired" | "unsupported";
  supported: boolean;
  label: string;
  repositoryScoped: boolean;
  supportsRefresh: boolean;
  supportsDisconnect: boolean;
  connectedAt?: string;
  expiresAt?: string;
  lastError?: string;
}

export interface ProviderStatus {
  providerId: string;
  type: string;
  connectionMethod: "local_cli" | "api_key" | "oauth" | "custom_command" | "local_model";
  command?: string;
  apiKeyEnv?: string;
  oauthProvider?: string;
  baseUrl?: string;
  modelTiers: Array<{
    tier: string;
    model: string;
  }>;
  available: boolean;
  version?: string;
  status: "ready" | "warning" | "error";
  issues: ProviderIssue[];
  capabilities: {
    authMethods: Array<"api_key" | "oauth" | "external_cli" | "local_model" | "custom_command">;
    supportsStreaming: boolean;
    supportsStructuredOutput: boolean;
    supportsToolCalls: boolean;
    supportsLocalWorkspace: boolean;
    supportsCostTracking: boolean;
    supportsMultiRunOrchestration: boolean;
    supportedModelFamilies: string[];
  };
  connectionState: ProviderConnectionState;
  metadata: Record<string, string>;
}

export interface CreateTicketResponse {
  ticket: {
    id: string;
    source: string;
    externalId?: string;
    title: string;
    description: string;
    labels: string[];
    status: string;
  };
}

export type RunTicketResult =
  | {
      status: "blocked";
      blocker: "branch_policy" | "prompt_review" | "plan_review" | "provider_runtime";
      reason: string;
      promptReview?: PromptReview;
      planArtifact?: PlanArtifact;
      branchResolution: {
        policy: string;
        decision: string;
        branchName?: string;
        reason: string;
      };
    }
  | {
      status: "succeeded" | "output_ready" | "failed";
      execution: ExecutionSummary;
      branchResolution: {
        policy: string;
        decision: string;
        branchName?: string;
        reason: string;
      };
      error?: string;
    };

export interface WorkerPlanRunResult {
  status: "blocked" | "running" | "integration_ready" | "failed";
  workerPlan: WorkerPlan;
  workItems: WorkItem[];
  executions: ExecutionSummary[];
  summary: string;
  integrationSummary: string;
  integrationIssues: string[];
  blockedWorkItemIds: string[];
  failedWorkItemIds: string[];
}

export interface WorkItemRunResult {
  status: "blocked" | "succeeded" | "output_ready" | "failed";
  workerPlan: WorkerPlan;
  workItem: WorkItem;
  execution?: ExecutionSummary;
  reason?: string;
  repositoryPath?: string;
}

export async function getStatus(): Promise<StatusResponse> {
  return apiFetch("/status");
}

export async function getTickets(): Promise<{ tickets: TicketSummary[] }> {
  return apiFetch("/tickets");
}

export async function getTicket(ticketId: string): Promise<TicketDetailResponse> {
  return apiFetch(`/tickets/${ticketId}`);
}

export async function getExecutions(): Promise<{ executions: ExecutionSummary[] }> {
  return apiFetch("/executions");
}

export async function getExecution(executionId: string): Promise<{ execution: ExecutionSummary; checkRuns: CheckRun[] }> {
  return apiFetch(`/executions/${executionId}`);
}

export async function getConfig(): Promise<ConfigResponse> {
  return apiFetch("/config");
}

export async function getContext(): Promise<ContextResponse> {
  return apiFetch("/context");
}

export async function getProviders(): Promise<{ repository: string; providers: ProviderStatus[] }> {
  return apiFetch("/providers");
}

export async function updateProvider(input: {
  providerId: string;
  type: string;
  connectionMethod: "local_cli" | "api_key" | "oauth" | "custom_command" | "local_model";
  command?: string;
  apiKeyEnv?: string;
  oauthProvider?: string;
  baseUrl?: string;
  modelMappings?: Record<string, string>;
}): Promise<{ ok: true; targetPath: string; provider: ProviderStatus | null }> {
  return apiFetch(`/providers/${input.providerId}`, {
    method: "PUT",
    body: JSON.stringify({
      type: input.type,
      connectionMethod: input.connectionMethod,
      command: input.command,
      apiKeyEnv: input.apiKeyEnv,
      oauthProvider: input.oauthProvider,
      baseUrl: input.baseUrl,
      modelMappings: input.modelMappings ?? {}
    })
  });
}

export async function startProviderOauth(providerId: string): Promise<{
  ok: true;
  authorizationUrl: string;
  callbackUrl: string;
  sessionId: string;
  provider: string;
}> {
  return apiFetch(`/providers/${providerId}/oauth/start`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function completeProviderOauth(
  providerId: string,
  input: {
    sessionId: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }
): Promise<{
  ok: true;
  connection: {
    providerId: string;
    oauthProvider: string;
    createdAt: string;
    expiresAt?: string;
  };
  provider: ProviderStatus | null;
}> {
  return apiFetch(`/providers/${providerId}/oauth/exchange`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function disconnectProviderOauth(
  providerId: string
): Promise<{ ok: true; provider: ProviderStatus | null }> {
  return apiFetch(`/providers/${providerId}/oauth/disconnect`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function createTicket(input: {
  title: string;
  description: string;
  labels: string[];
  source?: string;
  externalId?: string;
}): Promise<CreateTicketResponse> {
  return apiFetch("/tickets", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      description: input.description,
      labels: input.labels,
      source: input.source ?? "manual",
      externalId: input.externalId
    })
  });
}

export async function runTicket(ticketId: string): Promise<RunTicketResult> {
  return apiFetch(`/tickets/${ticketId}/run`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function approvePromptReview(
  ticketId: string,
  promptReviewId: string,
  reviewerComment?: string
): Promise<{ promptReview: PromptReview }> {
  return apiFetch(`/tickets/${ticketId}/prompt/${promptReviewId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function rejectPromptReview(
  ticketId: string,
  promptReviewId: string,
  reviewerComment?: string
): Promise<{ promptReview: PromptReview }> {
  return apiFetch(`/tickets/${ticketId}/prompt/${promptReviewId}/reject`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function regeneratePromptReview(
  ticketId: string,
  reviewerComment?: string
): Promise<{ promptReview: PromptReview }> {
  return apiFetch(`/tickets/${ticketId}/prompt/regenerate`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function approvePlanArtifact(
  ticketId: string,
  planArtifactId: string,
  reviewerComment?: string
): Promise<{ planArtifact: PlanArtifact }> {
  return apiFetch(`/tickets/${ticketId}/plan/${planArtifactId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function rejectPlanArtifact(
  ticketId: string,
  planArtifactId: string,
  reviewerComment?: string
): Promise<{ planArtifact: PlanArtifact }> {
  return apiFetch(`/tickets/${ticketId}/plan/${planArtifactId}/reject`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function regeneratePlanArtifact(
  ticketId: string,
  reviewerComment?: string
): Promise<RunTicketResult> {
  return apiFetch(`/tickets/${ticketId}/plan/regenerate`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function generateWorkerPlan(
  ticketId: string,
  reviewerComment?: string
): Promise<{ workerPlan: WorkerPlan; workItems: WorkItem[] }> {
  return apiFetch(`/tickets/${ticketId}/worker-plan/generate`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function runWorkerPlan(ticketId: string): Promise<WorkerPlanRunResult> {
  return apiFetch(`/tickets/${ticketId}/worker-plan/run`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function approveExecutionReview(
  executionId: string,
  reviewerComment?: string,
  overrideFailedChecks = false
): Promise<{ execution: ExecutionSummary; checkRuns: CheckRun[] }> {
  return apiFetch(`/executions/${executionId}/review/approve`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment,
      overrideFailedChecks
    })
  });
}

export async function rejectExecutionReview(
  executionId: string,
  reviewerComment?: string
): Promise<{ execution: ExecutionSummary }> {
  return apiFetch(`/executions/${executionId}/review/reject`, {
    method: "POST",
    body: JSON.stringify({
      reviewerComment
    })
  });
}

export async function createDraftPullRequest(
  executionId: string,
  overrideFailedChecks = false
): Promise<{ execution: ExecutionSummary; checkRuns: CheckRun[] }> {
  return apiFetch(`/executions/${executionId}/pull-request`, {
    method: "POST",
    body: JSON.stringify({
      overrideFailedChecks
    })
  });
}

export async function resolveTicket(
  ticketId: string,
  input: { resolutionType: "done" | "manual_pr" | "no_pr"; resolutionNote?: string }
): Promise<{ ticket: TicketSummary }> {
  return apiFetch(`/tickets/${ticketId}/resolve`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function reopenTicket(ticketId: string): Promise<{ ticket: TicketSummary }> {
  return apiFetch(`/tickets/${ticketId}/reopen`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function runWorkItem(workItemId: string): Promise<WorkItemRunResult> {
  return apiFetch(`/work-items/${workItemId}/run`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function updateBranchPolicy(scope: "project" | "user", value: string): Promise<unknown> {
  return apiFetch("/config", {
    method: "PUT",
    body: JSON.stringify({
      key: "execution.defaultBranchPolicy",
      value,
      scope
    })
  });
}

export async function updateContextSettings(input: {
  scope: "project" | "user";
  learnedProfiles: string[];
  userProfiles: string[];
  profileMode: "project-first" | "profile-first" | "project-only" | "profile-only" | "manual";
  maxPromptProfileWords: number;
  maxProfileSections: number;
}): Promise<unknown> {
  return apiFetch("/context", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(path, API_BASE_URL);

  if (TARGET_REPO) {
    url.searchParams.set("repoPath", TARGET_REPO);
  }

  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    const detail = payload?.error ? `: ${payload.error}` : "";
    throw new Error(`OpenTop API request failed: ${response.status} ${response.statusText}${detail}`);
  }

  return (await response.json()) as T;
}
