# Provider Recipes

This page collects the shortest reliable setups for common OpenTop provider paths.

## Codex CLI

Use this when you want local workspace execution through the installed Codex CLI.

```yaml
providers:
  codex:
    type: codex-cli
    connection:
      method: local_cli
      command: codex

models:
  cheap:
    provider: codex
    model: gpt-5-codex
  strong:
    provider: codex
    model: gpt-5-codex
```

Notes:

- Run `codex login` outside OpenTop first.
- Prefer `gpt-5-codex` over generic model IDs such as `gpt-5.3`.
- `opentop providers doctor` will warn when routed model IDs are unlikely to work with the local CLI.

## OpenAI API

Use this when you want OpenAI-compatible API access through environment variables.

```bash
export OPENAI_API_KEY=...
```

```yaml
providers:
  openai:
    type: openai-api
    connection:
      method: api_key
      apiKeyEnv: OPENAI_API_KEY

models:
  cheap:
    provider: openai
    model: gpt-4.1-mini
  strong:
    provider: openai
    model: gpt-5
```

Notes:

- OpenTop currently stores model output as reviewable artifacts for API providers.
- Local patch application is still a later step.

## OpenRouter OAuth

Use this when you want hosted provider access without storing a project-local secret.

```yaml
providers:
  openrouter:
    type: openrouter-api
    connection:
      method: oauth
      oauthProvider: openrouter

models:
  cheap:
    provider: openrouter
    model: openai/gpt-4.1-mini
  strong:
    provider: openrouter
    model: openai/gpt-5
```

Flow:

1. Save the provider in `/settings`.
2. Click `Connect provider`.
3. Complete the OpenRouter OAuth screen.
4. Return to `/settings` and confirm the provider shows `connected`.

Notes:

- Credentials are stored under `~/.opentop/auth/`, not in project config.
- OAuth support is implemented today for `openrouter-api`.

## OpenAI Codex OAuth

Use this when you want to connect a ChatGPT/Codex subscription account without putting a secret in project config.
Today this is a connection and inspection path, not a supported execution runtime.

```yaml
providers:
  openaiCodex:
    type: openai-codex
    connection:
      method: oauth
      oauthProvider: openai-codex

models:
  cheap:
    provider: openaiCodex
    model: gpt-5-codex
  strong:
    provider: openaiCodex
    model: gpt-5-codex
```

Flow:

1. Save the provider in `/settings`.
2. Click `Connect provider`.
3. Complete the ChatGPT / Codex sign-in flow.
4. Return to `/settings` and confirm the provider shows a connected OAuth state.

Notes:

- Credentials are stored under `~/.opentop/auth/`, not in project config.
- OpenTop starts a local OAuth callback listener on `http://localhost:1455/auth/callback` for this flow.
- OpenTop does not currently execute tickets through this provider.
- Prefer `codex-cli` for ChatGPT/Codex subscription access.
- Prefer `openai-api` with `OPENAI_API_KEY` for direct OpenAI API usage.
- If OpenAI changes its OAuth client or redirect requirements, set `OPENAI_CODEX_OAUTH_CLIENT_ID` before starting OpenTop.

## DeepSeek API

```bash
export DEEPSEEK_API_KEY=...
```

```yaml
providers:
  deepseek:
    type: deepseek-api
    connection:
      method: api_key
      apiKeyEnv: DEEPSEEK_API_KEY

models:
  cheap:
    provider: deepseek
    model: deepseek-chat
  strong:
    provider: deepseek
    model: deepseek-reasoner
```

## Anthropic API

```bash
export ANTHROPIC_API_KEY=...
```

```yaml
providers:
  anthropic:
    type: anthropic-api
    connection:
      method: api_key
      apiKeyEnv: ANTHROPIC_API_KEY

models:
  cheap:
    provider: anthropic
    model: claude-3-5-haiku-latest
  strong:
    provider: anthropic
    model: claude-sonnet-4-0
```

Notes:

- Anthropic is currently API-key only in OpenTop.
- If configured as OAuth, OpenTop will show it as unsupported rather than pretending to connect.

## Diagnose Any Provider

Use:

```bash
opentop providers doctor
```

That command surfaces:

- routed model tiers
- auth method
- connection state
- compatibility warnings
- unsupported OAuth configurations
