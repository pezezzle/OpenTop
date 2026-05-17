# 0005: Provider Auth And Runtime Architecture

## Status

Accepted

## Context

OpenTop should be a control plane for agentic software development, not a thin wrapper around one coding agent.

The product needs to route human-written tickets to the right model and execution strategy. Small fixes may use cheaper models, while risky architecture work, full feature implementation, planning, review, and worker orchestration may require stronger models or different providers.

Providers may be accessed through different runtime and authentication methods:

- API keys for hosted model APIs.
- OAuth for user-connected hosted providers.
- External CLIs that manage their own authentication.
- Local model servers.
- Custom shell commands.

OpenTop must support these methods without leaking secrets into project configuration and without making provider-specific behavior part of the product core.

## Decision

OpenTop is provider-neutral by design.

Codex CLI is a supported local provider adapter, not the foundation of the product architecture.

The OpenTop core owns ticket analysis, project and user context selection, model routing, execution planning, branch policy, approval policy, worker planning, review workflow, and pull request output. Provider adapters execute specific model calls or agent runs through a normalized interface.

Project configuration may contain provider IDs, provider types, model routing, connection method metadata, base URLs, and non-secret identifiers. It must not contain API keys, OAuth access tokens, refresh tokens, or user secrets.

Secrets and user-specific authentication state belong in user scope, environment variables, or an operating-system-backed secret store.

Provider adapters should expose capabilities so OpenTop can route work safely. Examples include:

- `authMethods`: `api_key`, `oauth`, `external_cli`, `local_model`, or `custom_command`.
- `supportsStreaming`
- `supportsStructuredOutput`
- `supportsToolCalls`
- `supportsLocalWorkspace`
- `supportsCostTracking`
- `supportsMultiRunOrchestration`
- supported model families and model tiers

API-key providers should be implemented before full OAuth flows because they establish the provider runtime abstraction without requiring token lifecycle management. OAuth remains a first-class design target, but needs a complete user auth model, callback flow, token storage, refresh handling, and revocation behavior before it should be considered implemented.

## Consequences

OpenTop should not become coupled to Codex CLI behavior, model names, authentication, or output format.

The first durable provider runtime work should focus on:

- a stronger provider capability model
- a secret resolver abstraction
- API-key backed providers such as OpenAI-compatible APIs, DeepSeek, OpenRouter, and Anthropic
- keeping Codex CLI as an `external_cli` style adapter

OAuth UI may be displayed only as pending or not connected until the full connect flow exists.

Planner and worker orchestration must be OpenTop behavior. Providers may run the individual planner, worker, reviewer, or implementation tasks, but they should not define the orchestration model.

