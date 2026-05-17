import type { OpenTopConfig, OpenTopProviderConfig, ProviderConnectionMethod } from "./config.js";

export type ProviderIssueSeverity = "error" | "warning" | "info";
export type ProviderHealthStatus = "ready" | "warning" | "error";
export type ProviderAuthMethod = "api_key" | "oauth" | "external_cli" | "local_model" | "custom_command";
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

export interface ProviderModelReference {
  tier: string;
  model: string;
}

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

export interface ProviderStatus {
  providerId: string;
  type: string;
  connectionMethod: ProviderConnectionMethod;
  command?: string;
  apiKeyEnv?: string;
  oauthProvider?: string;
  baseUrl?: string;
  modelTiers: ProviderModelReference[];
  available: boolean;
  version?: string;
  status: ProviderHealthStatus;
  issues: ProviderIssue[];
  capabilities: ProviderCapabilities;
  connectionState: ProviderConnectionState;
  metadata: Record<string, string>;
}

export interface ProviderInspector {
  inspect(
    providerId: string,
    definition: OpenTopProviderConfig,
    modelTiers: ProviderModelReference[]
  ): Promise<ProviderInspectionResult>;
}

export async function inspectConfiguredProviders(
  config: OpenTopConfig,
  inspector: ProviderInspector
): Promise<ProviderStatus[]> {
  const providers = Object.entries(config.providers);

  return Promise.all(
    providers.map(async ([providerId, definition]) => {
      const modelTiers = Object.entries(config.models)
        .filter(([, model]) => model.provider === providerId)
        .map(([tier, model]) => ({
          tier,
          model: model.model
        }));
      const inspection = await inspector.inspect(providerId, definition, modelTiers);

      return {
        providerId,
        type: definition.type,
        connectionMethod: definition.connection.method,
        command: definition.command,
        apiKeyEnv: definition.apiKeyEnv,
        oauthProvider: definition.oauthProvider,
        baseUrl: definition.baseUrl,
        modelTiers,
        available: inspection.available,
        version: inspection.version,
        status: deriveProviderHealthStatus(inspection.issues),
        issues: inspection.issues,
        capabilities: inspection.capabilities ?? defaultProviderCapabilities(),
        connectionState: inspection.connectionState ?? defaultConnectionState(),
        metadata: inspection.metadata ?? {}
      };
    })
  );
}

export function deriveProviderHealthStatus(issues: ProviderIssue[]): ProviderHealthStatus {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }

  if (issues.some((issue) => issue.severity === "warning")) {
    return "warning";
  }

  return "ready";
}

function defaultProviderCapabilities(): ProviderCapabilities {
  return {
    authMethods: [],
    supportsStreaming: false,
    supportsStructuredOutput: false,
    supportsToolCalls: false,
    supportsLocalWorkspace: false,
    supportsCostTracking: false,
    supportsMultiRunOrchestration: false,
    supportedModelFamilies: []
  };
}

function defaultConnectionState(): ProviderConnectionState {
  return {
    status: "not_applicable",
    supported: false,
    label: "Not used for this connection method.",
    repositoryScoped: false,
    supportsRefresh: false,
    supportsDisconnect: false
  };
}
