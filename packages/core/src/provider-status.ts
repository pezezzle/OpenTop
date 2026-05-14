import type { OpenTopConfig, OpenTopProviderConfig } from "./config.js";

export type ProviderIssueSeverity = "error" | "warning" | "info";
export type ProviderHealthStatus = "ready" | "warning" | "error";

export interface ProviderModelReference {
  tier: string;
  model: string;
}

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

export interface ProviderStatus {
  providerId: string;
  type: string;
  command?: string;
  apiKeyEnv?: string;
  modelTiers: ProviderModelReference[];
  available: boolean;
  version?: string;
  status: ProviderHealthStatus;
  issues: ProviderIssue[];
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
        command: definition.command,
        apiKeyEnv: definition.apiKeyEnv,
        modelTiers,
        available: inspection.available,
        version: inspection.version,
        status: deriveProviderHealthStatus(inspection.issues),
        issues: inspection.issues,
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
