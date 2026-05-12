# OpenTop Project Rules

## Engineering Rules

- Keep CLI, API, and Web as entry points only.
- Do not duplicate business logic across apps.
- Add core workflows as services in `packages/core`.
- Add technical implementations as adapters.
- Keep provider-specific behavior behind provider interfaces.
- Keep database-specific behavior out of `packages/core`.
- Keep changes small and easy to review.

## Safety Rules

- Never require direct pushes to the default branch for MVP execution.
- Prefer isolated branches and draft pull requests.
- Treat auth, security, migrations, multi-tenant behavior, and provider execution as high-risk areas.
- Store secrets in environment variables or ignored local files, not committed config.

## Documentation Rules

- Architecture-level decisions belong in `docs/architecture.md`.
- Project context and memory rules belong in `docs/opentop-project-context-and-memory.md`.
- User-facing setup belongs in `docs/getting-started.md`.
- Agent profile behavior belongs in `docs/agent-profiles.md`.

## Prompt Rules

- Prompts must be built from ticket content, classification, agent profile, execution mode, project context, and relevant rules.
- Prompts must include allowed commands and output expectations.
- Prompts must ask for summary, changed files, checks run, and remaining risks.
- Prompts must not ask an agent to bypass approval or safety rules.
