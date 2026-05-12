# OpenTop Conventions

## Package Boundaries

- Put shared primitive types and constants in `packages/shared`.
- Put domain types, classification, routing, prompt building, and application services in `packages/core`.
- Put database schemas and repository implementations in `packages/db`.
- Put Git operations in `packages/git`.
- Put GitHub-specific operations in `packages/github`.
- Put provider integrations in `packages/providers`.

## Naming

- Use `OpenTop` for the product name.
- Use `.opentop/` for project-specific OpenTop configuration and execution context.
- Use `opentop/issue-<id>-<slug>` for generated branch names.

## Configuration

- Keep committed defaults in `.opentop/opentop.yml`.
- Keep local overrides in `.opentop/opentop.local.yml`.
- Reference secrets through environment variable names.
- Do not commit secrets or private customer context.

## Documentation

- Prefer short, concrete documents.
- Link to source documentation instead of duplicating it.
- Keep architecture decisions close to the architecture document.
