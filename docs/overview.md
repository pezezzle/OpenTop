# OpenTop Overview

OpenTop means:

```text
Open Ticket Orchestrator Platform
```

OpenTop is an open-source control plane for agentic software development. It sits between ticket systems and AI coding agents and turns tickets into controlled, reviewable executions.

OpenTop is not another coding agent. It decides how agentic work should be classified, routed, constrained, executed, and reviewed.

## Product Idea

```text
Ticket
-> Classification
-> Model route
-> Agent profile
-> Controlled prompt
-> Execution
-> Branch / PR
-> Human review
```

The product claim is:

```text
The control plane for agentic software development.
```

## What OpenTop Controls

OpenTop controls:

- which ticket is being executed
- which agent profile should handle it
- which model tier should be used
- which execution mode applies
- whether approval is required
- which branch policy is used
- which prompt context is sent to the agent
- which logs, changed files, and review outputs are stored
- whether the result is finished manually or handed off to GitHub

## User Interfaces

OpenTop has three entry points:

- Web UI: primary daily interface for tickets, executions, settings, and review.
- CLI: setup, automation, quick inspection, and power-user commands.
- API: local HTTP boundary used by the Web UI and future integrations.

## Current MVP Direction

The current MVP is local-first:

- local repository
- local `.opentop/` project context
- local SQLite state under `.opentop/state/opentop.db`
- local API and Web UI
- local CLI
- future provider execution through adapters

The MVP does not push directly to the default branch. The intended workflow is isolated branches, checks, human review, and then either GitHub handoff or explicit manual closure.

In practice, the current product cut is:

- `codex-cli` for Codex subscription-backed local execution
- API-key providers such as `openai-api` for direct hosted model access
- optional draft PR creation when GitHub auth is available
- explicit `Done, PR handled manually` and `Done without PR` flows when you want to finish outside OpenTop
