import type { ExecutionMode } from "@opentop/shared";

export interface AgentRunRequest {
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

export interface AgentRunResult {
  success: boolean;
  summary: string;
  changedFiles: string[];
  logs: string[];
}

export interface AiProviderAdapter {
  id: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

export interface ProviderModelReference {
  tier: string;
  model: string;
}

export type ProviderIssueSeverity = "error" | "warning" | "info";

export interface ProviderIssue {
  severity: ProviderIssueSeverity;
  code: string;
  message: string;
}

export interface ProviderInspectionResult {
  available: boolean;
  version?: string;
  issues: ProviderIssue[];
  metadata?: Record<string, string>;
}
