# OpenTop Project Context

## Project

OpenTop stands for Open Ticket Orchestrator Platform.

OpenTop is an open-source control plane for agentic software development. It sits between ticket systems and AI coding agents. Its job is to turn tickets into controlled executions with classification, routing, prompt construction, branch isolation, logs, checks, draft pull requests, and human review.

## Product Positioning

OpenTop is not another coding agent. It orchestrates coding agents.

```text
Tickets become executable.
```

## Core Workflow

```text
Ticket
-> Classification
-> Agent profile and model route
-> Controlled prompt
-> Execution in isolated branch
-> Checks and logs
-> Draft PR
-> Human review
```

## Important Documentation

- `README.md`
- `docs/architecture.md`
- `docs/whitepaper.md`
- `docs/getting-started.md`
- `docs/agent-profiles.md`
- `docs/opentop-project-context-and-memory.md`
- `ROADMAP.md`

## Architectural Rules

- Keep business logic out of `apps/cli`, `apps/api`, and `apps/web`.
- Put domain logic and orchestration behavior in `packages/core`.
- Keep infrastructure in adapters such as `packages/db`, `packages/git`, `packages/github`, and `packages/providers`.
- Prefer transparent, testable routing before AI-assisted behavior.
- Do not push directly to the default branch as part of the MVP workflow.
- Do not store secrets in committed OpenTop config files.

## Current MVP Focus

- Local CLI.
- Local API.
- Lightweight Web UI.
- Rule-based ticket classification.
- Provider adapter contracts.
- Git and GitHub integration boundaries.
- Project context and memory structure.

## Agent Instructions

When working on OpenTop, read this file first, then read `docs/architecture.md` before making architectural changes.

For implementation work, preserve the package boundaries defined in the architecture document.
