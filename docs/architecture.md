# OpenTop Target Architecture

OpenTop is the control plane between ticket systems and AI coding agents. Its architecture is built around one rule:

```text
CLI, API, and Web contain no business logic.
```

They are entry points. The product logic belongs in `packages/core` and is exposed through application services.

## System Flow

```text
Ticket Sources
GitHub / Manual / Linear / Jira
        |
        v
Ticket Repository
SQLite first, PostgreSQL later
        |
        v
Classifier
Rules first, optional AI later
        |
        v
Router
Agent profile, model tier, approval policy
        |
        v
Prompt Builder
Controlled agent prompt from ticket, profile, rules, and project context
        |
        v
Execution Engine
Branch, provider run, logs, checks
        |
        v
Review Output
Changed files, draft PR, human approval
```

## Package Boundaries

```text
apps/cli
apps/api
apps/web
        |
        v
packages/core
        |
        v
packages/db
packages/providers
packages/git
packages/github
packages/shared
```

The dependency direction should stay simple: apps depend on core services, and core depends on interfaces. Technical adapters implement those interfaces.

## Applications

### `apps/cli`

The CLI is a terminal entry point for setup, automation, power-user workflows, and local operator commands.

It may:

- Parse command-line arguments.
- Load configuration.
- Call core application services.
- Print human-readable output or JSON.
- Offer optional operator-only dashboard or shell modes.

It must not:

- Classify tickets directly.
- Build prompts directly.
- Decide routing or approval rules directly.
- Talk to SQLite, GitHub, or providers without going through the intended service boundary.

The CLI is not the primary product surface. It exists for setup, scripting, quick inspection, and direct operator control.

### `apps/api`

The API is the local HTTP entry point for the Web UI and future integrations.

It may:

- Expose Fastify routes.
- Validate HTTP input.
- Call core application services.
- Return JSON responses.

It must not own domain decisions. The same operation should behave the same whether it is triggered through CLI, API, or Web.

### `apps/web`

The Web app is the primary visual control plane.

It may:

- Show tickets, classifications, approvals, executions, logs, and pull request links.
- Trigger API calls.
- Let humans approve or override suggested routes.
- Own the main daily interface for board, detail pages, settings, and review flows.

It must not duplicate classifier, router, or execution behavior.

OpenTop should prefer new user-facing interface work in the Web app first. CLI dashboards or TUIs are optional secondary surfaces.

## Core Package

`packages/core` contains the OpenTop domain and orchestration logic. It should stay independent from SQLite, GitHub, Next.js, Fastify, and concrete provider SDKs.

It owns:

- `Ticket`
- `Classification`
- `AgentProfile`
- `Execution`
- `ExecutionPlan`
- `Classifier`
- `Router`
- `PromptBuilder`
- `ExecutionPolicy`
- Application service interfaces

Core should define what the system needs, not how infrastructure implements it.

## Application Services

OpenTop should introduce application services early so CLI, API, and Web share the same workflows.

Initial services:

- `TicketService`
- `ClassificationService`
- `ExecutionService`
- `PromptService`

Example operations:

```ts
classificationService.classifyTicket(ticketId);
executionService.planExecution(ticketId);
executionService.runExecution(ticketId);
promptService.buildPrompt(ticketId);
```

These services coordinate domain logic and call infrastructure through interfaces.

## Ports and Adapters

OpenTop follows a ports-and-adapters shape.

```text
Core says what is needed.
Adapters say how it is done.
```

Example core interface:

```ts
export interface TicketRepository {
  findById(id: string): Promise<Ticket | null>;
  save(ticket: Ticket): Promise<void>;
}
```

The core package can use `TicketRepository` without knowing whether tickets are stored in SQLite, PostgreSQL, or imported from GitHub.

This keeps later changes contained:

- SQLite can become PostgreSQL.
- GitHub can be joined by Linear or Jira.
- Codex CLI can be joined by OpenAI API, Claude Code, OpenRouter, or Ollama.
- Local execution can later move to workers.

## Infrastructure Packages

### `packages/db`

Database access lives here, not in apps.

It will contain:

- SQLite connection.
- Drizzle schema.
- Migrations.
- `TicketRepository` implementation.
- `ExecutionRepository` implementation.

`packages/core` should not import Drizzle or know SQLite exists.

### `packages/providers`

Provider adapters execute AI coding agents.

It contains:

- Provider adapter interface.
- Provider capability definitions.
- Secret resolution boundaries.
- Codex CLI adapter as an external CLI provider.
- Custom shell adapter.
- Later OpenAI-compatible API adapter.
- Later Anthropic API adapter.
- Later DeepSeek API adapter.
- Later OpenRouter API adapter.
- Later Claude Code adapter.
- Later Ollama or local-model adapters.

All providers should return normalized results: success, summary, logs, changed files, and risks.

OpenTop is provider-neutral. Codex CLI is a useful local adapter, but it must not become the product foundation. The core orchestration model owns ticket analysis, model routing, prompt creation, approval policy, planner and worker orchestration, review output, and pull request flow.

One practical nuance from live testing: ChatGPT/Codex subscription OAuth and direct OpenAI API execution are not interchangeable. OpenTop therefore treats `codex-cli` as the preferred Codex-subscription runtime path, while `openai-api` remains the durable direct-API path. `openai-codex` can exist as a connection and inspection surface without being treated as a supported execution runtime.

Project config can store provider type, connection method, model routes, base URLs, and other non-secret metadata. API keys, OAuth tokens, refresh tokens, and user-specific credentials must stay in user scope, environment variables, or a secret store.

Provider adapters should advertise capabilities such as supported auth methods, streaming, structured output, tool calls, local workspace execution, cost tracking, and multi-run suitability. OpenTop should use those capabilities when selecting providers and models for work.

API-key provider runtimes should land before full OAuth connection flows. OAuth is a first-class target, but requires callback handling, token storage, refresh, revocation, and clear user-scope secret ownership.

See [0005: Provider auth and runtime architecture](decisions/0005-provider-auth-and-runtime-architecture.md).

### `packages/git`

Local Git operations live here.

It contains:

- Repository status.
- Clean working tree checks.
- Branch creation.
- Changed file detection.
- Diff summary helpers.

### `packages/github`

GitHub-specific integration lives here.

It contains:

- GitHub Issue import.
- Draft pull request creation.
- Pull request link updates.
- GitHub connection inspection through token or `gh` CLI auth.
- Live pull-request state reads.
- Draft-to-ready-for-review transitions.
- Later review/comment synchronization.

### `packages/shared`

Shared primitive types and constants live here. It should stay small and avoid becoming a dumping ground for business logic.

## Project Context and Memory

Project context is an architecture component, but it is not the whole architecture.

Each target project can provide OpenTop context through `.opentop/`:

```text
.opentop/
  opentop.yml
  project-context.md
  rules.md
  memory/
  prompts/
  templates/
```

The purpose is to help the `PromptBuilder` create controlled prompts from:

- Ticket content.
- Classification.
- Agent profile.
- Routing decision.
- Project rules.
- Relevant project documentation.
- Memory such as decisions, conventions, risks, and glossary terms.

OpenTop should not duplicate a project's full `docs/` folder. It should reference important documentation and carry the execution context agents need.

## Context Profiles

Context Profiles extend project context with optional learned and user-level style knowledge.

They support this goal:

```text
Ticket + Project Context + selected profiles -> project-specific controlled prompt
```

Context priority:

```text
Ticket Context
-> Project Context
-> Project Memory
-> Selected Learned Profile
-> Selected User Profile
-> OpenTop Defaults
```

Project rules must beat personal style by default. Profile context should fill gaps, especially in new projects or poorly documented projects.

See [context-profiles.md](context-profiles.md) for the detailed structure, settings model, and prompt budget rules.

## Execution Pipeline

The final execution pipeline should look like this:

```text
load config
-> load ticket
-> classify ticket
-> route profile/model/mode
-> build controlled prompt
-> require approval when needed
-> ensure repository state is acceptable
-> create isolated branch
-> run provider adapter
-> collect logs and changed files
-> run configured checks
-> create draft PR
-> store execution result
```

No direct pushes to the default branch are part of the MVP.

## MVP Implementation Status

Completed foundation:

- Monorepo with CLI, API, Web, and shared packages.
- `packages/db` with local SQLite persistence.
- Repository interfaces in `packages/core`.
- SQLite ticket and execution repositories.
- Stored local tickets.
- `classify <id>` backed by stored tickets.
- PromptBuilder based on ticket, classification, profile, rules, and project context.
- Stored executions with branch preparation, provider results, and changed files.
- Branch policy resolution.
- Web board, ticket detail, execution detail, and settings.

Next implementation steps:

1. Run configured checks.
2. Improve changed-file and diff reporting.
3. Create draft pull requests.
4. Add approval gates in the Web UI.

The implementation order keeps the architecture clean while moving toward a usable local MVP.

## MVP Constraints

Version `0.1` intentionally avoids:

- Multi-user SaaS.
- Billing.
- Role and permission systems.
- Cloud workers.
- Plugin marketplace complexity.
- Perfect sandboxing.

The first product must prove the local control-plane workflow before expanding outward.

## UI Strategy

OpenTop uses this product split:

```text
CLI = setup, automation, power-user operations
API = application boundary for Web and integrations
Web = primary user interface
```

That means:

- New ticket, execution, log, prompt-preview, approval, and settings flows should land in Web first.
- CLI dashboards or shell modes may stay available, but they are secondary and should not become the main product surface.
- API routes should expose the same workflows so Web does not reimplement orchestration logic.
