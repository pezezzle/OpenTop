import { CodexCliProvider } from "./codex-cli.js";
import { CustomShellProvider } from "./custom-shell.js";
import type { AiProviderAdapter } from "./types.js";

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

export function createProviderAdapter(providerId: string, definition: ProviderDefinition): AiProviderAdapter {
  if (definition.type === "codex-cli") {
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

  throw new Error(`Provider type "${definition.type}" is not supported yet.`);
}
