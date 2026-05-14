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
  profileId: string;
  providerId: string;
  modelId: string;
  status: string;
  branchName: string;
  promptSnapshot: string;
  classificationSnapshot: {
    risk: string;
    complexity: string;
    affectedAreas: string[];
    suggestedProfile: string;
    suggestedModelTier: string;
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

export interface TicketSummary {
  id: string;
  source: string;
  externalId?: string;
  title: string;
  description: string;
  labels: string[];
  status: string;
  classification: {
    risk: string;
    complexity: string;
    affectedAreas: string[];
    suggestedProfile: string;
    suggestedModelTier: string;
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

export interface TicketDetailResponse {
  ticket: TicketSummary;
  classification: TicketSummary["classification"];
  executionPlan: TicketSummary["executionPlan"] & {
    profile: {
      id: string;
      description?: string;
      modelTier: string;
      mode: string;
      requiresApproval: boolean;
      allowedCommands: string[];
    };
  };
  prompt: {
    prompt: string;
    sources: string[];
  };
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
      branchResolution: {
        policy: string;
        decision: string;
        branchName?: string;
        reason: string;
      };
    }
  | {
      status: "succeeded" | "failed";
      execution: ExecutionSummary;
      branchResolution: {
        policy: string;
        decision: string;
        branchName?: string;
        reason: string;
      };
      error?: string;
    };

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

export async function getExecution(executionId: string): Promise<{ execution: ExecutionSummary }> {
  return apiFetch(`/executions/${executionId}`);
}

export async function getConfig(): Promise<ConfigResponse> {
  return apiFetch("/config");
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
    throw new Error(`OpenTop API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}
