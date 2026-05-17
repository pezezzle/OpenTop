import type { ExecutionMode } from "@opentop/shared";

export type ProviderAuthMethod = "api_key" | "oauth" | "external_cli" | "local_model" | "custom_command";
export type ReviewOutputKind = "plan" | "patch_proposal" | "review_note" | "general";
export type ProviderConnectionStateStatus = "not_applicable" | "connected" | "disconnected" | "expired" | "unsupported";

export interface ProviderCapabilities {
  authMethods: ProviderAuthMethod[];
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsToolCalls: boolean;
  supportsLocalWorkspace: boolean;
  supportsCostTracking: boolean;
  supportsMultiRunOrchestration: boolean;
  supportedModelFamilies: string[];
}

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
  artifactKind?: "workspace_changes" | "review_output";
  outputKind?: ReviewOutputKind;
  outputText?: string;
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

export interface ProviderConnectionState {
  status: ProviderConnectionStateStatus;
  supported: boolean;
  label: string;
  repositoryScoped: boolean;
  supportsRefresh: boolean;
  supportsDisconnect: boolean;
  connectedAt?: string;
  expiresAt?: string;
  lastError?: string;
}

export interface ProviderInspectionResult {
  available: boolean;
  version?: string;
  issues: ProviderIssue[];
  capabilities?: ProviderCapabilities;
  connectionState?: ProviderConnectionState;
  metadata?: Record<string, string>;
}
