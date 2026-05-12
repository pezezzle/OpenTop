# OpenTop Architecture

## System Boundary

OpenTop sits between issue trackers and coding agents.

```text
GitHub Issues / Manual Tickets
-> OpenTop CLI / API / Web
-> Core classifier and router
-> Provider adapter
-> Local repository branch
-> Checks and draft PR
```

## Monorepo Layout

```text
apps/
  cli/      User-facing local commands
  api/      Local Fastify API
  web/      Board and execution UI

packages/
  core/     Domain model, config, routing, classification, execution planning
  providers/ AI provider adapter contracts and starter adapters
  git/      Local repository operations
  github/   GitHub issue import and PR integration
  shared/   Shared constants and primitive types
```

## Core Domain

### Ticket

A ticket is the normalized unit of work. It can come from GitHub Issues, manual input, or later from Linear, Jira, Trello, or Azure DevOps.

### Classification

A classification describes how OpenTop understands the ticket:

- Risk
- Complexity
- Affected areas
- Suggested agent profile
- Suggested model tier
- Suggested execution mode
- Approval requirement
- Reason

### Agent Profile

An agent profile defines how an execution should behave. It includes the model tier, execution mode, approval requirement, and allowed commands.

### Execution

An execution is the controlled run of an agent against a ticket. It tracks branch name, provider, model, status, logs, changed files, and pull request URL.

## Routing Strategy

Version `0.1` starts with transparent rules:

- Labels can route simple work such as bugs to a cheaper profile.
- Keywords such as `auth`, `security`, and `migration` route to high-risk architecture profiles.
- A default rule handles everything else.

AI-assisted classification can be added later, but the first layer should stay testable and explainable.

## Provider Strategy

Provider adapters implement one contract:

```ts
export interface AiProviderAdapter {
  id: string;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
```

The first practical adapters are:

- `custom-shell`
- `codex-cli`

API-based providers can be added behind the same interface.

## Execution Pipeline

```text
load config
-> load ticket
-> classify ticket
-> build execution plan
-> require approval when needed
-> create branch
-> run provider
-> collect logs and changed files
-> run configured checks
-> create draft PR
```

## MVP Constraints

Version `0.1` intentionally avoids multi-user SaaS concerns, billing, role management, cloud workers, a plugin marketplace, and perfect sandboxing. The first product must prove the local control-plane workflow.
