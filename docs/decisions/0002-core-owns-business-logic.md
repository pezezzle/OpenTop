# 0002: Core Owns Business Logic

## Status

Accepted

## Context

OpenTop has multiple entry points:

- CLI
- API
- Web

The same operation must behave the same no matter which entry point triggers it.

## Decision

Business logic belongs in `packages/core`.

Apps may parse inputs, call services, and render outputs. They should not own classification, routing, prompt building, branch policy resolution, or execution planning rules.

Infrastructure details belong in adapter packages:

- `packages/db`
- `packages/git`
- `packages/github`
- `packages/providers`

## Consequences

CLI, API, and Web should share core services.

Core should define repository interfaces.

Adapter packages should implement technical details without leaking them back into the domain model.

