import type { AgentRunRequest, AgentRunResult, AiProviderAdapter } from "./types.js";
import { environmentSecretResolver, type SecretResolver } from "./secrets.js";
import { classifyReviewOutput } from "./review-output.js";

export interface OpenAiCompatibleProviderOptions {
  id: string;
  type: string;
  apiKeyEnv?: string;
  apiKeyValue?: string;
  baseUrl?: string;
  secretResolver?: SecretResolver;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

interface ResponsesApiResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export class OpenAiCompatibleProvider implements AiProviderAdapter {
  readonly id: string;
  private readonly type: string;
  private readonly apiKeyEnv: string;
  private readonly apiKeyValue?: string;
  private readonly baseUrl: string;
  private readonly secretResolver: SecretResolver;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.id = options.id;
    this.type = options.type;
    this.apiKeyEnv = options.apiKeyEnv ?? defaultApiKeyEnv(options.type);
    this.apiKeyValue = options.apiKeyValue;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? defaultBaseUrl(options.type));
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

    const operation = prefersResponsesApi(this.type)
      ? await this.runResponsesRequest(request, apiKey)
      : await this.runChatCompletionsRequest(request, apiKey);

    if (!operation.ok) {
      return {
        success: false,
        summary: `Provider "${this.id}" failed: ${describeProviderFailure(this.type, operation.message)}`,
        changedFiles: [],
        logs: [operation.failureLog, describeProviderFailure(this.type, operation.message), operation.message]
      };
    }

    return {
      success: operation.content.length > 0,
      summary: operation.content.length > 0 ? operation.content : `Provider "${this.id}" returned no message content.`,
      artifactKind: "review_output",
      outputKind: classifyReviewOutput(request.prompt, operation.content, request.mode),
      outputText: operation.content || undefined,
      changedFiles: [],
      logs: [
        operation.successLog,
        operation.usageLog,
        "This API provider currently returns model output only; local patch application is not implemented yet.",
        ...(operation.content.length > 0 ? [operation.content] : [])
      ]
    };
  }

  private async runChatCompletionsRequest(
    request: AgentRunRequest,
    apiKey: string
  ): Promise<
    | { ok: false; message: string; failureLog: string }
    | { ok: true; content: string; usageLog: string; successLog: string }
  > {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeadersForProvider(this.type)
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          {
            role: "system",
            content:
              "You are running under OpenTop. Return a concise, reviewable result. Do not claim to have edited files unless the requested output explicitly includes a patch."
          },
          {
            role: "user",
            content: request.prompt
          }
        ]
      })
    });

    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

    if (!response.ok) {
      return {
        ok: false,
        message: payload.error?.message ?? `${response.status} ${response.statusText}`,
        failureLog: `POST ${this.baseUrl}/chat/completions failed.`
      };
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const usageLog = payload.usage
      ? `Token usage: prompt=${payload.usage.prompt_tokens ?? "?"}, completion=${payload.usage.completion_tokens ?? "?"}, total=${payload.usage.total_tokens ?? "?"}.`
      : "Token usage was not returned by the provider.";

    return {
      ok: true,
      content,
      usageLog,
      successLog: `Provider "${this.id}" completed an OpenAI-compatible chat completion.`
    };
  }

  private async runResponsesRequest(
    request: AgentRunRequest,
    apiKey: string
  ): Promise<
    | { ok: false; message: string; failureLog: string }
    | { ok: true; content: string; usageLog: string; successLog: string }
  > {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeadersForProvider(this.type)
      },
      body: JSON.stringify({
        model: request.model,
        instructions:
          "You are running under OpenTop. Return a concise, reviewable result. Do not claim to have edited files unless the requested output explicitly includes a patch.",
        input: request.prompt
      })
    });

    const payload = (await response.json().catch(() => ({}))) as ResponsesApiResponse;

    if (!response.ok) {
      return {
        ok: false,
        message: payload.error?.message ?? `${response.status} ${response.statusText}`,
        failureLog: `POST ${this.baseUrl}/responses failed.`
      };
    }

    const content = extractResponsesText(payload);
    const usageLog = payload.usage
      ? `Token usage: input=${payload.usage.input_tokens ?? "?"}, output=${payload.usage.output_tokens ?? "?"}, total=${payload.usage.total_tokens ?? "?"}.`
      : "Token usage was not returned by the provider.";

    return {
      ok: true,
      content,
      usageLog,
      successLog: `Provider "${this.id}" completed an OpenAI Responses API request.`
    };
  }
}

export function defaultApiKeyEnv(type: string): string {
  if (type === "openrouter-api") {
    return "OPENROUTER_API_KEY";
  }

  if (type === "deepseek-api") {
    return "DEEPSEEK_API_KEY";
  }

  return "OPENAI_API_KEY";
}

export function defaultBaseUrl(type: string): string {
  if (type === "openrouter-api") {
    return "https://openrouter.ai/api/v1";
  }

  if (type === "deepseek-api") {
    return "https://api.deepseek.com/v1";
  }

  return "https://api.openai.com/v1";
}

function extraHeadersForProvider(type: string): Record<string, string> {
  if (type === "openrouter-api") {
    return {
      "HTTP-Referer": "https://opentop.local",
      "X-Title": "OpenTop"
    };
  }

  return {};
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function prefersResponsesApi(type: string): boolean {
  return type === "openai-codex";
}

function extractResponsesText(payload: ResponsesApiResponse): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  const segments =
    payload.output
      ?.flatMap((item) =>
        item.content?.flatMap((content) =>
          content.type === "output_text" || content.type === "text"
            ? [content.text?.trim() ?? ""]
            : []
        ) ?? []
      )
      .filter((entry) => entry.length > 0) ?? [];

  return segments.join("\n\n");
}

function describeProviderFailure(type: string, message: string): string {
  if (type === "openai-codex" && message.includes("api.responses.write")) {
    return [
      "OpenAI Codex OAuth is connected, but this token cannot call the OpenAI Responses API.",
      'Missing scope: "api.responses.write".',
      "This usually means the connected ChatGPT/Codex login does not currently grant API execution rights for this endpoint."
    ].join(" ");
  }

  return message;
}
