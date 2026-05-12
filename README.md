# OpenTop

**Open Ticket Orchestrator Platform**

OpenTop is an open-source control plane for agentic software development. It turns software tickets into controlled AI executions by analyzing the work, selecting an agent profile and model route, running the agent in an isolated branch, and producing reviewable output such as logs, checks, diffs, and draft pull requests.

```text
Ticket
-> Classification
-> Model route
-> Agent profile
-> Controlled execution
-> Branch / PR
-> Human review
```

## Status

This repository is in the first `0.1` scaffold phase. The current focus is a local CLI, a small API, a lightweight web UI, and reusable packages for routing, providers, Git integration, and GitHub import.

## MVP Scope

- Import GitHub Issues and manual tickets.
- Classify tickets by risk, complexity, labels, keywords, and affected areas.
- Suggest an agent profile, model tier, and execution mode.
- Require approval for risky work.
- Run agent executions through provider adapters.
- Create isolated branches and draft pull requests.
- Keep logs, changed files, and check results visible.

## Repository Layout

```text
apps/
  api/      Fastify API for local orchestration
  cli/      OpenTop command line interface
  web/      Next.js web UI

packages/
  core/     Domain types, config, classifier, execution planning
  db/       SQLite and Drizzle persistence adapters
  providers/ Provider adapter contracts and implementations
  git/      Git helper utilities
  github/   GitHub issue and pull request integration
  shared/   Shared constants and primitive types

docs/       Product and architecture documentation
.opentop/   Example project configuration
```

## Architecture

OpenTop keeps business logic out of `apps/cli`, `apps/api`, and `apps/web`. Those apps are entry points only. The domain and orchestration logic live in `packages/core`, while database, provider, Git, and GitHub integrations are adapters around that core.

See [docs/architecture.md](docs/architecture.md) for the target architecture and MVP build order.

## Project Context

OpenTop projects can provide execution context through `.opentop/`: project context, rules, memory files, prompt templates, and pull request templates. Public defaults belong in the repository; local overrides and secrets stay ignored.

See [docs/opentop-project-context-and-memory.md](docs/opentop-project-context-and-memory.md) for the structure and rules.

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @opentop/cli dev -- status
pnpm --filter @opentop/cli dev -- tickets create --title "Fix login button" --labels bug
pnpm --filter @opentop/cli dev -- tickets list
pnpm --filter @opentop/cli dev -- classify 1
pnpm --filter @opentop/cli dev -- classify --title "Fix login button" --labels bug
pnpm --filter @opentop/cli dev -- prompt 1
pnpm --filter @opentop/cli dev -- prompt --title "Fix login button" --labels bug
```

## Claim

```text
The control plane for agentic software development.
```
