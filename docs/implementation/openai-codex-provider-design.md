# OpenAI Codex Provider Design

This note records the current OpenTop product cut for OpenAI Codex access after live testing against a real ChatGPT/Codex OAuth login.

## Outcome

OpenTop keeps three distinct OpenAI-related paths:

1. `openai-api`
   Direct OpenAI Platform API usage with an API key.

2. `codex-cli`
   Preferred path for ChatGPT/Codex subscription access.

3. `openai-codex`
   OAuth connection path for ChatGPT/Codex accounts, kept for connection state, inspection, and future native integration work, but not treated as a supported execution runtime today.

## Why We Changed Direction

OpenTop successfully implemented and tested the following:

- PKCE OAuth login against OpenAI Codex auth
- token storage in the user-scoped auth store
- repository-scoped connection inspection

However, live runtime tests showed that this OAuth path is not a dependable foundation for direct OpenAI API execution from OpenTop:

- `gpt-5-codex` requires the Responses API rather than Chat Completions
- the connected OAuth token did not carry the required Responses API scope `api.responses.write`
- this behavior matches similar reports in the OpenClaw ecosystem

The practical product conclusion is:

- OAuth login exists
- but that login should not currently be treated as a stable, supported OpenTop runtime credential for direct API execution

## Product Decision

### `openai-api`

Use this for:

- direct OpenAI Platform billing
- normal API-backed OpenTop provider execution
- clear, documented API behavior

### `codex-cli`

Use this for:

- ChatGPT/Codex subscription access
- local Codex-authenticated execution
- the least ambiguous path for users who already use Codex directly

### `openai-codex`

Use this for:

- connecting and inspecting a ChatGPT/Codex account inside OpenTop
- future native Codex-runtime exploration

Do not use this today for:

- normal ticket execution
- pretending that ChatGPT/Codex OAuth is equivalent to a full OpenAI API runtime token

## UX Expectations

OpenTop should present `openai-codex` honestly:

- it can connect
- it can show connected state
- it is not a supported execution runtime yet

Doctor, settings, and runtime errors should consistently point users toward:

- `codex-cli` for subscription access
- `openai-api` for API-key usage

## Non-Goals

This product cut does not:

- remove the `openai-codex` OAuth flow
- claim that OpenAI OAuth is fake or nonexistent
- block future native Codex-runtime support

It simply avoids treating the current OAuth token path as a production-ready execution transport.

## Recommendation

Keep `openai-codex` in OpenTop as a connected-but-non-runtime provider path until OpenTop has a native Codex-style integration that does not depend on ambiguous direct API token behavior.
