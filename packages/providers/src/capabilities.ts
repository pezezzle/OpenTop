import type { ProviderCapabilities } from "./types.js";
import type { ProviderDefinition } from "./factory.js";

export function getProviderCapabilities(definition: ProviderDefinition): ProviderCapabilities {
  if (definition.type === "openai-codex") {
    return {
      authMethods: ["oauth"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: false,
      supportedModelFamilies: ["openai-codex", "codex"]
    };
  }

  if (definition.connection.method === "oauth" && isOpenAiCompatibleProvider(definition.type)) {
    return {
      authMethods: ["oauth"],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: [definition.type.replace(/-api$/u, "")]
    };
  }

  if (definition.connection.method === "oauth") {
    return {
      authMethods: ["oauth"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: false,
      supportedModelFamilies: [definition.type.replace(/-api$/u, "")]
    };
  }

  if (definition.connection.method === "local_model") {
    return {
      authMethods: ["local_model"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: ["local"]
    };
  }

  if (definition.type === "codex-cli") {
    return {
      authMethods: ["external_cli"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalls: false,
      supportsLocalWorkspace: true,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: ["codex"]
    };
  }

  if (definition.type === "custom-shell") {
    return {
      authMethods: ["custom_command"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalls: false,
      supportsLocalWorkspace: true,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: ["custom"]
    };
  }

  if (isOpenAiCompatibleProvider(definition.type) && definition.connection.method === "api_key") {
    return {
      authMethods: ["api_key"],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: [definition.type.replace(/-api$/u, "")]
    };
  }

  if (definition.type === "anthropic-api" && definition.connection.method === "api_key") {
    return {
      authMethods: ["api_key"],
      supportsStreaming: false,
      supportsStructuredOutput: true,
      supportsToolCalls: false,
      supportsLocalWorkspace: false,
      supportsCostTracking: false,
      supportsMultiRunOrchestration: true,
      supportedModelFamilies: ["anthropic", "claude"]
    };
  }

  return {
    authMethods: [mapConnectionMethod(definition.connection.method)],
    supportsStreaming: false,
    supportsStructuredOutput: false,
    supportsToolCalls: false,
    supportsLocalWorkspace: false,
    supportsCostTracking: false,
    supportsMultiRunOrchestration: false,
    supportedModelFamilies: []
  };
}

export function isOpenAiCompatibleProvider(type: string): boolean {
  return type === "openai-api" || type === "openrouter-api" || type === "deepseek-api";
}

function mapConnectionMethod(method: string): ProviderCapabilities["authMethods"][number] {
  if (method === "local_cli") {
    return "external_cli";
  }

  if (
    method === "api_key" ||
    method === "oauth" ||
    method === "local_model" ||
    method === "custom_command"
  ) {
    return method;
  }

  return "custom_command";
}
