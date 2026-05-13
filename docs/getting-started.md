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

## Target a Repository

OpenTop works against the current working directory by default. Use `--repo` when you want to orchestrate a different repository, such as a sandbox:

```bash
pnpm cli:dev -- --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox status
```

## Check Status

```bash
pnpm cli:dev -- status
```

## Create and List Tickets

```bash
pnpm cli:dev -- tickets create \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

```bash
pnpm cli:dev -- tickets list
```

## Classify a Ticket

Stored ticket by ID:

```bash
pnpm cli:dev -- classify 1
```

Manual command-line input:

```bash
pnpm cli:dev -- classify \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

## Build a Controlled Prompt

Stored ticket by ID:

```bash
pnpm cli:dev -- prompt 1
```

Manual command-line input:

```bash
pnpm cli:dev -- prompt \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

This reads `.opentop/opentop.yml`, `.opentop/project-context.md`, `.opentop/rules.md`, `.opentop/memory/*`, and the matching prompt template from `.opentop/prompts/`.

Use JSON output when you want the execution plan and source list as structured data:

```bash
pnpm cli:dev -- prompt \
  --title "Fix login button layout" \
  --labels bug \
  --json
```

## Create a Planned Execution

```bash
pnpm cli:dev -- run 1
```

This stores a planned execution in `.opentop/state/opentop.db`, including the execution status, branch name, prompt snapshot, classification snapshot, and placeholders for logs and changed files.

Inspect stored executions:

```bash
pnpm cli:dev -- executions list
pnpm cli:dev -- executions show 1 --json
```

## Install a Local `opentop` Command

To expose a real local `opentop` command on your machine:

```bash
pnpm cli:link
```

Then you can call:

```bash
opentop --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox status
opentop --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox tickets list
```

Interactive CLI:

```bash
opentop start
opentop settings
```

## Configure Branch Policy

Project-wide policy belongs in `.opentop/opentop.yml`:

```yaml
execution:
  defaultBranchPolicy: reuse-current
```

Optional personal default on your machine:

```text
C:\Users\<you>\.opentop\config.yml
```

```yaml
execution:
  defaultBranchPolicy: new
```

Resolution order:

```text
--branch-policy
-> project config
-> user config
-> built-in default (reuse-current)
```

Behavior:

- `reuse-current` reuses your current branch when it is not the default branch.
- `reuse-current` falls back to a fresh execution branch when you are on the default branch.
- `manual` blocks `run` until you override it or change config.
- dirty working trees block `run`.

Scriptable config commands:

```bash
opentop config get execution.defaultBranchPolicy
opentop config set execution.defaultBranchPolicy new --scope project
opentop config set execution.defaultBranchPolicy reuse-current --scope user
```

## Start the API

```bash
pnpm api
```

The API listens on port `4317` by default.

## Start the Web UI

```bash
pnpm web
```

## Configuration

OpenTop reads `.opentop/opentop.yml` from the working directory. The starter config includes provider definitions, model tiers, agent profiles, routing rules, and build/test commands.
