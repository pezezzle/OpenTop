# OpenTop Decisions

## 2026-05-12: Use OpenTop as the product name

OpenTop means Open Ticket Orchestrator Platform.

Decision: Keep OpenTop as the project name instead of alternatives such as AgentPlane.

Reason: The name directly reflects the product concept: ticket orchestration for agentic software development.

## 2026-05-12: Keep apps free of business logic

Decision: `apps/cli`, `apps/api`, and `apps/web` are entry points only.

Reason: Core workflows must behave consistently no matter whether they are triggered from CLI, API, or Web.

## 2026-05-12: Use ports and adapters

Decision: Core defines interfaces; adapter packages implement technical details.

Reason: OpenTop must be able to swap SQLite for PostgreSQL, GitHub for Linear, and Codex CLI for other providers without rewriting the core.

## 2026-05-12: Start with transparent rule-based routing

Decision: MVP classification starts with labels, keywords, and explicit routing rules.

Reason: Routing should be explainable and testable before AI-assisted classification is added.
