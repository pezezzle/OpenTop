import { spawn } from "node:child_process";
import type {
  ProviderInspectionResult,
  ProviderIssue,
  ProviderModelReference
} from "./types.js";
import type { ProviderDefinition } from "./factory.js";
import { resolveExecutable } from "./command-resolution.js";

export async function inspectProviderRuntime(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  if (definition.connection.method === "oauth") {
    return inspectOauthProvider(providerId, definition, modelTiers);
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
    ]
  };
}

async function inspectCodexCliProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
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
  const apiKeyEnv = definition.apiKeyEnv ?? definition.connection.apiKeyEnv;
  const apiKeyAvailable = typeof apiKeyEnv === "string" && apiKeyEnv.length > 0 && Boolean(process.env[apiKeyEnv]);

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

  if (definition.type === "openai-api") {
    issues.push({
      severity: "info",
      code: "runtime_adapter_pending",
      message: `OpenTop can store and validate this OpenAI API connection, but the runtime adapter is not implemented yet.`
    });
  }

  return {
    available: apiKeyAvailable,
    issues,
    metadata: {
      apiKeyEnv: apiKeyEnv ?? "(missing)",
      connectionMethod: definition.connection.method,
      providerType: definition.type,
      ...(definition.baseUrl ? { baseUrl: definition.baseUrl } : {})
    }
  };
}

async function inspectOauthProvider(
  providerId: string,
  definition: ProviderDefinition,
  modelTiers: ProviderModelReference[]
): Promise<ProviderInspectionResult> {
  const issues: ProviderIssue[] = [
    {
      severity: "warning",
      code: "oauth_flow_pending",
      message: `Provider "${providerId}" is configured for OAuth, but the interactive OAuth connect flow is not implemented yet. Store only non-secret metadata in project config.`
    }
  ];

  if (modelTiers.length === 0) {
    issues.push({
      severity: "warning",
      code: "no_model_tiers",
      message: `Provider "${providerId}" is configured, but no model tiers currently route to it.`
    });
  }

  return {
    available: false,
    issues,
    metadata: {
      oauthProvider: definition.oauthProvider ?? definition.connection.oauthProvider ?? "(not set)",
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
