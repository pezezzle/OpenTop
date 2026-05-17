import { spawn } from "node:child_process";
import type {
  ProviderInspectionResult,
  ProviderIssue,
  ProviderModelReference
} from "./types.js";
import type { ProviderDefinition } from "./factory.js";
import { resolveExecutable } from "./command-resolution.js";
import { getProviderCapabilities, isOpenAiCompatibleProvider } from "./capabilities.js";
import { defaultApiKeyEnv, defaultBaseUrl } from "./openai-compatible.js";
import { environmentSecretResolver } from "./secrets.js";
import { getOauthSupport, inspectOauthConnection, resolveOauthProviderName } from "./oauth.js";

export interface ProviderInspectionContext {
  repositoryPath?: string;
}

export async function inspectProviderRuntime(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[],
  context: ProviderInspectionContext = {}
): Promise<ProviderInspectionResult> {
  if (definition.connection.method === "oauth") {
    return inspectOauthProvider(providerId, definition, modelTiers, context);
  }

  if (definition.type === "codex-cli") {
    return inspectCodexCliProvider(providerId, definition, modelTiers);
  }

  if (definition.type === "custom-shell") {
    return inspectCustomShellProvider(providerId, definition, modelTiers);
  }

  if (definition.connection.method === "api_key") {
    return inspectApiKeyProvider(providerId, definition, modelTiers);
  }

  if (definition.connection.method === "local_model") {
    return inspectLocalModelProvider(providerId, definition, modelTiers);
  }

  return {
    available: false,
    issues: [
      {
        severity: "error",
        code: "provider_type_unsupported",
        message: `Provider type "${definition.type}" is not supported yet.`
      }
    ],
    capabilities: getProviderCapabilities(definition)
  };
}

async function inspectCodexCliProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  if (definition.connection.method !== "local_cli") {
    return {
      available: false,
      issues: [
        {
          severity: "warning",
          code: "codex_cli_connection_pending",
          message: `Provider "${providerId}" uses connection method "${definition.connection.method}", but codex-cli currently supports local_cli only. OAuth and API-key connection flows are planned separately from the local Codex CLI adapter.`
        },
        ...(modelTiers.length === 0
          ? [
              {
                severity: "warning" as const,
                code: "no_model_tiers",
                message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
              }
            ]
          : [])
      ],
      capabilities: getProviderCapabilities(definition),
      metadata: {
        command: definition.command ?? "codex",
        connectionMethod: definition.connection.method,
        providerType: definition.type
      }
    };
  }

  const command = definition.command ?? "codex";
  const issues: ProviderIssue[] = [];
  const executable = await resolveExecutable(command);
  const commandCheck = await runCommand(executable, ["--version"]);

  if (!commandCheck.ok) {
    issues.push({
      severity: "error",
      code: "command_unavailable",
      message: `Provider "${providerId}" could not start "${command}". ${commandCheck.error ?? "Install Codex CLI or fix the command path."}`
    });
  }

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  for (const modelTier of modelTiers) {
    if (!modelTier.model.includes("codex")) {
      issues.push({
        severity: "warning",
        code: "model_may_not_be_supported",
        message: `Model tier "${modelTier.tier}" uses "${modelTier.model}" with codex-cli. ChatGPT-backed Codex accounts often reject non-Codex models such as "gpt-5.3" or "gpt-5.5-thinking". Prefer a Codex-supported model such as "gpt-5-codex".`
      });
    }
  }

  return {
    available: commandCheck.ok,
    version: commandCheck.ok ? extractFirstLine(commandCheck.stdout) : undefined,
    issues,
    capabilities: getProviderCapabilities(definition),
    metadata: {
      command,
      resolvedCommand: executable,
      connectionMethod: definition.connection.method,
      providerType: definition.type
    }
  };
}

async function inspectCustomShellProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  const issues: ProviderIssue[] = [];

  if (!definition.command) {
    issues.push({
      severity: "error",
      code: "command_missing",
      message: `Provider "${providerId}" is missing its shell command.`
    });
  } else {
    issues.push({
      severity: "info",
      code: "shell_runtime_not_verified",
      message: `Provider "${providerId}" uses an arbitrary shell command. OpenTop can run it, but cannot statically verify the full command before execution.`
    });
  }

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  return {
    available: Boolean(definition.command),
    issues,
    capabilities: getProviderCapabilities(definition),
    metadata: {
      command: definition.command ?? "(missing)",
      connectionMethod: definition.connection.method,
      providerType: definition.type
    }
  };
}

async function inspectApiKeyProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  const issues: ProviderIssue[] = [];
  const apiKeyEnv = definition.apiKeyEnv ?? definition.connection.apiKeyEnv ?? defaultApiKeyEnv(definition.type);
  const apiKeyAvailable = Boolean(await environmentSecretResolver.resolve(apiKeyEnv));

  if (!apiKeyEnv) {
    issues.push({
      severity: "error",
      code: "api_key_env_missing",
      message: `Provider "${providerId}" uses API key authentication, but no apiKeyEnv is configured.`
    });
  } else if (!apiKeyAvailable) {
    issues.push({
      severity: "error",
      code: "api_key_not_available",
      message: `Provider "${providerId}" expects environment variable "${apiKeyEnv}", but it is not available in the current process.`
    });
  }

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  if (isOpenAiCompatibleProvider(definition.type)) {
    issues.push({
      severity: "info",
      code: "api_provider_output_only",
      message:
        definition.type === "openai-codex"
          ? `Provider "${providerId}" can run OpenAI Responses API review-output requests, but local patch application is not implemented yet.`
          : `Provider "${providerId}" can run OpenAI-compatible chat completions, but local patch application is not implemented yet.`
    });
  } else if (definition.type === "anthropic-api") {
    issues.push({
      severity: "info",
      code: "api_provider_output_only",
      message: `Provider "${providerId}" can run Anthropic messages requests, but local patch application is not implemented yet.`
    });
  } else {
    issues.push({
      severity: "warning",
      code: "runtime_adapter_pending",
      message: `OpenTop can store and validate this API-key connection, but the runtime adapter for provider type "${definition.type}" is not implemented yet.`
    });
  }

  return {
    available: apiKeyAvailable,
    issues,
    capabilities: getProviderCapabilities(definition),
    metadata: {
      apiKeyEnv: apiKeyEnv ?? "(missing)",
      connectionMethod: definition.connection.method,
      providerType: definition.type,
      baseUrl: definition.baseUrl ?? definition.connection.baseUrl ?? defaultBaseUrl(definition.type)
    }
  };
}

async function inspectOauthProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[],
  context: ProviderInspectionContext
): Promise<ProviderInspectionResult> {
  const connectionState = await inspectOauthConnection(providerId, definition, context.repositoryPath ?? process.cwd());
  const issues: ProviderIssue[] = [];
  const support = getOauthSupport(definition);

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  if (!support.supported) {
    issues.push({
      severity: "error",
      code: "oauth_unsupported",
      message:
        support.reason ??
        `Provider "${providerId}" is configured for OAuth, but provider type "${definition.type}" does not support it yet.`
    });
  } else if (connectionState.status === "connected") {
    issues.push({
      severity: "info",
      code: "oauth_connected",
      message: `Provider "${providerId}" is connected through ${support.provider} OAuth. Secrets stay in the user-scoped OpenTop auth store.`
    });
  } else if (connectionState.status === "expired") {
    issues.push({
      severity: "error",
      code: "oauth_expired",
      message: connectionState.lastError ?? `Provider "${providerId}" has expired OAuth credentials and needs to reconnect.`
    });
  } else {
    issues.push({
      severity: "warning",
      code: "oauth_not_connected",
      message: `Provider "${providerId}" is configured for OAuth, but no active connection exists yet. Connect it from OpenTop Settings before running tickets.`
    });
  }

  if (definition.type === "openai-codex") {
    issues.push({
      severity: "warning",
      code: "runtime_disabled",
      message:
        `Provider "${providerId}" can connect through OpenAI Codex OAuth, but OpenTop does not currently support it as an execution runtime. ` +
        `Use codex-cli for ChatGPT/Codex subscription access or openai-api with an API key for direct OpenAI API usage.`
    });
  } else if (isOpenAiCompatibleProvider(definition.type) && support.supported) {
    issues.push({
      severity: "info",
      code: "api_provider_output_only",
      message:
        definition.type === "openai-codex"
          ? `Provider "${providerId}" can run OpenAI Responses API review-output requests after OAuth connect, but local patch application is not implemented yet. The connected token must also have the Responses API scope "api.responses.write".`
          : `Provider "${providerId}" can run OpenAI-compatible chat completions after OAuth connect, but local patch application is not implemented yet.`
    });
  }

  return {
    available: definition.type === "openai-codex" ? false : connectionState.status === "connected",
    issues,
    capabilities: getProviderCapabilities(definition),
    connectionState,
    metadata: {
      oauthProvider: resolveOauthProviderName(definition) || "(not set)",
      connectionMethod: definition.connection.method,
      providerType: definition.type
    }
  };
}

async function inspectLocalModelProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  const issues: ProviderIssue[] = [];

  if (!definition.baseUrl && !definition.connection.baseUrl) {
    issues.push({
      severity: "warning",
      code: "base_url_missing",
      message: `Provider "${providerId}" uses a local model connection, but no baseUrl is configured yet.`
    });
  }

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  issues.push({
    severity: "info",
    code: "runtime_adapter_pending",
    message: `OpenTop can store this local-model connection, but the runtime adapter is not implemented yet.`
  });

  return {
    available: issues.every((issue) => issue.severity !== "error"),
    issues,
    capabilities: getProviderCapabilities(definition),
    metadata: {
      baseUrl: definition.baseUrl ?? definition.connection.baseUrl ?? "(not set)",
      connectionMethod: definition.connection.method,
      providerType: definition.type
    }
  };
}

async function runCommand(
  command: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("error", (error) => {
      resolve({
        ok: false,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        error: error.message
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: stdout.join(""),
        stderr: stderr.join("")
      });
    });
  });
}

function extractFirstLine(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.split(/\r?\n/u)[0];
}
