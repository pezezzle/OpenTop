import { AnthropicProvider } from "./anthropic.js";
import { CodexCliProvider } from "./codex-cli.js";
import { CustomShellProvider } from "./custom-shell.js";
import { OpenAiCompatibleProvider, defaultApiKeyEnv, defaultBaseUrl } from "./openai-compatible.js";
import { isOpenAiCompatibleProvider } from "./capabilities.js";
import type { AiProviderAdapter } from "./types.js";
import { getOauthSupport, loadOauthAccessToken } from "./oauth.js";

export interface ProviderDefinition {
  type: string;
  connection: {
    method: string;
    command?: string;
    apiKeyEnv?: string;
    oauthProvider?: string;
    baseUrl?: string;
  };
  command?: string;
  apiKeyEnv?: string;
  oauthProvider?: string;
  baseUrl?: string;
}

export interface ProviderAdapterContext {
  repositoryPath?: string;
}

export async function createProviderAdapter(
  providerId: string,
  definition: ProviderDefinition,
  context: ProviderAdapterContext = {}
): Promise<AiProviderAdapter> {
  if (definition.type === "codex-cli") {
    if (definition.connection.method !== "local_cli") {
      throw new Error(
        `Provider "${providerId}" uses connection method "${definition.connection.method}", but codex-cli currently supports local_cli only.`
      );
    }

    return new CodexCliProvider({
      id: providerId,
      command: definition.command
    });
  }

  if (definition.type === "custom-shell") {
    if (!definition.command) {
      throw new Error(`Provider "${providerId}" is missing a shell command.`);
    }

    return new CustomShellProvider({
      id: providerId,
      command: definition.command
    });
  }

  if (definition.type === "openai-codex" && definition.connection.method === "oauth") {
    const support = getOauthSupport(definition);

    if (!support.supported) {
      throw new Error(support.reason ?? `Provider "${providerId}" does not support OAuth.`);
    }

    throw new Error(
      `Provider "${providerId}" can connect through OpenAI Codex OAuth, but OpenTop does not support it as an execution runtime yet. Use codex-cli for ChatGPT/Codex subscription access or openai-api with an API key for direct OpenAI API usage.`
    );
  }

  if (isOpenAiCompatibleProvider(definition.type) && definition.connection.method === "api_key") {
    return new OpenAiCompatibleProvider({
      id: providerId,
      type: definition.type,
      apiKeyEnv: definition.apiKeyEnv ?? definition.connection.apiKeyEnv ?? defaultApiKeyEnv(definition.type),
      baseUrl: definition.baseUrl ?? definition.connection.baseUrl ?? defaultBaseUrl(definition.type)
    });
  }

  if (isOpenAiCompatibleProvider(definition.type) && definition.connection.method === "oauth") {
    const repositoryPath = context.repositoryPath ?? process.cwd();
    const support = getOauthSupport(definition);

    if (!support.supported) {
      throw new Error(support.reason ?? `Provider "${providerId}" does not support OAuth.`);
    }

    const token = await loadOauthAccessToken(providerId, repositoryPath);

    if (!token) {
      throw new Error(
        `Provider "${providerId}" is configured for OAuth, but no connected credentials were found for repository "${repositoryPath}".`
      );
    }

    return new OpenAiCompatibleProvider({
      id: providerId,
      type: definition.type,
      apiKeyEnv: definition.apiKeyEnv ?? definition.connection.apiKeyEnv ?? defaultApiKeyEnv(definition.type),
      apiKeyValue: token,
      baseUrl: definition.baseUrl ?? definition.connection.baseUrl ?? defaultBaseUrl(definition.type)
    });
  }

  if (definition.type === "anthropic-api" && definition.connection.method === "api_key") {
    return new AnthropicProvider({
      id: providerId,
      apiKeyEnv: definition.apiKeyEnv ?? definition.connection.apiKeyEnv ?? "ANTHROPIC_API_KEY",
      baseUrl: definition.baseUrl ?? definition.connection.baseUrl ?? "https://api.anthropic.com/v1"
    });
  }

  if (definition.type === "anthropic-api" && definition.connection.method === "oauth") {
    const support = getOauthSupport(definition);
    throw new Error(support.reason ?? `Provider "${providerId}" does not support OAuth.`);
  }

  throw new Error(`Provider type "${definition.type}" is not supported yet.`);
}
