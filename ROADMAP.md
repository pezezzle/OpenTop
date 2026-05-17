# OpenTop Roadmap

## 0.1

- Monorepo foundation with CLI, API, Web, and core packages.
- Public target architecture document.
- Documentation structure for architecture, current state, CLI, API, Web, data model, execution flow, and decisions.
- Provider auth and runtime architecture decision.
- Context Profiles architecture for user profiles, learned profiles, and prompt budget rules.
- Manual ticket classification.
- Rule-based classifier and model routing.
- Provider adapter interface.
- Provider capability model.
- Secret resolver boundary for environment and future user secret stores.
- OpenAI-compatible API-key provider runtime baseline.
- DeepSeek and OpenRouter API-key provider support through the OpenAI-compatible adapter where possible.
- Codex CLI and custom shell adapter baseline.
- Local ticket persistence.
- PromptBuilder based on project context and memory.
- Persistent executions with provider logs and changed files.
- Branch policy resolution.
- Web board, ticket detail, execution detail, and settings.
- CLI local linking and dashboard startup command.

## 0.2

- Codex CLI treated as an external CLI provider in the provider model.
- API-provider result review workflow for output-only runs.
- Configurable build and test checks.
- Draft PR creation through GitHub.
- GitHub issue import.
- Project analysis proposal command.
- Context profile settings in Web.

## 0.3

- Approval workflow in the Web UI.
- AI-assisted classifier explanations.
- Anthropic API-key provider runtime.
- Provider-aware model routing improvements.
- Structured planner output for large features.
- Worker plan data model for multi-step feature execution.
- Learned profile generation from existing repositories.
- Applying learned profiles to new projects.
- Linear import.
- Stronger command allowlist enforcement.

## Later

- Full OAuth connect flow with local callback handling, token storage, refresh, revocation, and user-scope secret ownership.
- Multi-worker execution orchestration.
- Provider cost and token tracking.
- Cloud or team worker execution.
