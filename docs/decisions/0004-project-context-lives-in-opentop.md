# 0004: Project Context Lives In `.opentop/`

## Status

Accepted

## Context

OpenTop needs project-specific execution context so agents can work with the right rules, conventions, and prompt templates.

Projects may already have normal documentation in `docs/`. OpenTop should not duplicate all of that documentation.

## Decision

OpenTop project execution context lives in `.opentop/`.

The current structure is:

```text
.opentop/
  opentop.yml
  project-context.md
  rules.md
  memory/
  prompts/
  templates/
```

`.opentop/project-context.md` acts as a map to important project documentation.

`.opentop/memory/` stores compact execution memory such as decisions, conventions, risks, glossary terms, and known issues.

## Consequences

The prompt builder has a stable context source.

Project docs can stay in normal `docs/` folders.

Sensitive or local data must stay out of committed OpenTop context files.

