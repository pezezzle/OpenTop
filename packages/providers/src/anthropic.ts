import type { AgentRunRequest, AgentRunResult, AiProviderAdapter } from "./types.js";
import { environmentSecretResolver, type SecretResolver } from "./secrets.js";
import { classifyReviewOutput } from "./review-output.js";

export interface AnthropicProviderOptions {
  id: string;
  apiKeyEnv?: string;
  apiKeyValue?: string;
  baseUrl?: string;
  secretResolver?: SecretResolver;
}

interface AnthropicMessageResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class AnthropicProvider implements AiProviderAdapter {
  readonly id: string;
  private readonly apiKeyEnv: string;
  private readonly apiKeyValue?: string;
  private readonly baseUrl: string;
  private readonly secretResolver: SecretResolver;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id;
    this.apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
    this.apiKeyValue = options.apiKeyValue;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "https://api.anthropic.com/v1");
    this.secretResolver = options.secretResolver ?? environmentSecretResolver;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const apiKey = this.apiKeyValue ?? (await this.secretResolver.resolve(this.apiKeyEnv));

    if (!apiKey) {
      return {
        success: false,
        summary: `Missing API key environment variable "${this.apiKeyEnv}".`,
        changedFiles: [],
        logs: [`Provider "${this.id}" could not resolve "${this.apiKeyEnv}".`]
      };
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 4000,
        system:
          "You are running under OpenTop. Return a concise, reviewable result. Do not claim to have edited files unless the requested output explicitly includes a patch.",
        messages: [
          {
            role: "user",
            content: request.prompt
          }
        ]
      })
    });

    const payload = (await response.json().catch(() => ({}))) as AnthropicMessageResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `${response.status} ${response.statusText}`;
      return {
        success: false,
        summary: `Provider "${this.id}" failed: ${message}`,
        changedFiles: [],
        logs: [`POST ${this.baseUrl}/messages failed.`, message]
      };
    }

    const content = payload.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text?.trim() ?? "")
      .filter((block) => block.length > 0)
      .join("\n\n") ?? "";
    const usage = payload.usage
      ? `Token usage: input=${payload.usage.input_tokens ?? "?"}, output=${payload.usage.output_tokens ?? "?"}.`
      : "Token usage was not returned by the provider.";

    return {
      success: content.length > 0,
      summary: content.length > 0 ? content : `Provider "${this.id}" returned no message content.`,
      artifactKind: "review_output",
      outputKind: classifyReviewOutput(request.prompt, content, request.mode),
      outputText: content || undefined,
      changedFiles: [],
      logs: [
        `Provider "${this.id}" completed an Anthropic messages request.`,
        usage,
        "This API provider currently returns model output only; local patch application is not implemented yet.",
        ...(content.length > 0 ? [content] : [])
      ]
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
