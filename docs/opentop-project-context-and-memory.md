# OpenTop Project Context and Memory

OpenTop needs project-specific context to build useful controlled prompts. That context must be explicit, versioned where appropriate, and separated from private data.

This document defines how `.opentop/` should be used for public project context, memory, prompt templates, and local private overrides.

## Purpose

The `.opentop/` directory gives OpenTop enough context to answer these questions before an agent runs:

- What project is this?
- Which documentation matters?
- Which architecture rules must be preserved?
- Which decisions should not be forgotten?
- Which commands are allowed?
- Which prompt template matches the selected agent profile?
- Which PR template should be used for review output?

OpenTop should not replace a project's normal `docs/` folder. It should point to the important documentation and hold the execution context agents need.

## Public Structure

The recommended public structure is:

```text
.opentop/
  opentop.yml
  project-context.md
  rules.md
  memory/
    decisions.md
    conventions.md
    risks.md
    glossary.md
    known-issues.md
  prompts/
    bugfix.md
    feature.md
    planner.md
    reviewer.md
  templates/
    pull-request.md
```

These files can be committed when they contain general project knowledge and no secrets.

## Private Structure

Private or local files should not be committed:

```text
.opentop/opentop.local.yml
.opentop/secrets.*
.opentop/private/
```

Use these files for local overrides, private project context, customer-specific details, or sensitive operational notes.

## File Responsibilities

### `opentop.yml`

The main committed OpenTop configuration. It contains providers, model tiers, agent profiles, routing rules, and project commands.

Secrets must be referenced by environment variable name, not stored directly.

### `project-context.md`

The project map for agents.

It should contain:

- Project purpose.
- Product positioning.
- Important documentation links.
- Architecture rules.
- Current MVP focus.
- Agent instructions.

It should not contain secrets, credentials, customer data, or large duplicated documentation.

### `rules.md`

Concrete execution rules.

It should contain:

- Engineering rules.
- Safety rules.
- Documentation rules.
- Prompt rules.

### `memory/decisions.md`

Important decisions that should be carried forward.

Good entries include:

- Date.
- Decision.
- Reason.
- Consequence.

### `memory/conventions.md`

Project conventions agents should follow consistently.

Examples:

- Package boundaries.
- Naming conventions.
- Configuration conventions.
- Documentation conventions.

### `memory/risks.md`

Known risk areas and controls.

This helps routing and prompt construction treat sensitive work with the right level of caution.

### `memory/glossary.md`

Domain and system terms.

This helps agents use the same vocabulary as the project.

### `memory/known-issues.md`

Known limitations, technical debt, or current incomplete areas.

This helps agents avoid assuming unfinished systems are already implemented.

### `prompts/*.md`

Prompt templates by agent role.

Templates should define:

- Agent role.
- Objective.
- Rules.
- Expected output format.

The PromptBuilder will combine these templates with ticket data, classification, routing, execution mode, project context, and allowed commands.

### `templates/pull-request.md`

The default draft pull request template for execution output.

## PromptBuilder Inputs

The future PromptBuilder should assemble controlled prompts from:

- Ticket title and description.
- Ticket labels and source metadata.
- Classification result.
- Selected agent profile.
- Selected model tier.
- Execution mode.
- Allowed commands.
- `.opentop/project-context.md`.
- `.opentop/rules.md`.
- Relevant `.opentop/memory/*.md` files.
- Matching `.opentop/prompts/*.md` template.

## Source of Truth

Use this split:

```text
docs/
```

Official project documentation for humans and agents.

```text
.opentop/
```

OpenTop execution context, routing configuration, prompt templates, and memory pointers.

Avoid copying full documentation from `docs/` into `.opentop/`. Link to it from `project-context.md`.

## Security Rules

- Do not commit API keys.
- Do not commit passwords.
- Do not commit customer secrets.
- Do not commit personal data.
- Do not commit exploit details or sensitive operational security notes.
- Use environment variables and ignored local files for private data.

## Implementation Plan

The technical implementation should proceed in this order:

1. Load project context files from `.opentop/`.
2. Add a `PromptBuilder` in `packages/core`.
3. Map agent profiles to prompt templates.
4. Include allowed commands and execution mode in generated prompts.
5. Add CLI output for generated prompts.
6. Use generated prompts in real executions.
