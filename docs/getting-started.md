# Getting Started

## Prerequisites

- Node.js 22 or newer
- pnpm 9 or newer
- Git
- A local repository you want OpenTop to orchestrate

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Check Status

```bash
pnpm --filter @opentop/cli dev -- status
```

## Create and List Tickets

```bash
pnpm --filter @opentop/cli dev -- tickets create \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

```bash
pnpm --filter @opentop/cli dev -- tickets list
```

## Classify a Ticket

Stored ticket by ID:

```bash
pnpm --filter @opentop/cli dev -- classify 1
```

Manual command-line input:

```bash
pnpm --filter @opentop/cli dev -- classify \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

## Build a Controlled Prompt

Stored ticket by ID:

```bash
pnpm --filter @opentop/cli dev -- prompt 1
```

Manual command-line input:

```bash
pnpm --filter @opentop/cli dev -- prompt \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

This reads `.opentop/opentop.yml`, `.opentop/project-context.md`, `.opentop/rules.md`, `.opentop/memory/*`, and the matching prompt template from `.opentop/prompts/`.

Use JSON output when you want the execution plan and source list as structured data:

```bash
pnpm --filter @opentop/cli dev -- prompt \
  --title "Fix login button layout" \
  --labels bug \
  --json
```

## Create a Planned Execution

```bash
pnpm --filter @opentop/cli dev -- run 1
```

This stores a planned execution in `.opentop/state/opentop.db`, including the execution status, branch name, prompt snapshot, classification snapshot, and placeholders for logs and changed files.

Inspect stored executions:

```bash
pnpm --filter @opentop/cli dev -- executions list
pnpm --filter @opentop/cli dev -- executions show 1 --json
```

## Start the API

```bash
pnpm --filter @opentop/api dev
```

The API listens on port `4317` by default.

## Start the Web UI

```bash
pnpm --filter @opentop/web dev
```

## Configuration

OpenTop reads `.opentop/opentop.yml` from the working directory. The starter config includes provider definitions, model tiers, agent profiles, routing rules, and build/test commands.
