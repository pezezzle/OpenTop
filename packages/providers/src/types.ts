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
