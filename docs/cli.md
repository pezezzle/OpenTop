# CLI

The OpenTop CLI is the command-line entry point for setup, automation, quick inspection, and power-user workflows.

The CLI is not the primary product surface. The Web UI is the main interface for daily ticket and execution work.

## Install Local Command

From the OpenTop repository:

```powershell
pnpm cli:link
```

This exposes:

```powershell
opentop
```

## Target Repository

OpenTop works against the current directory by default.

From the sandbox repository:

```powershell
cd C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox
opentop status
```

From another directory, pass `--repo`:

```powershell
opentop --repo C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox status
```

## Core Commands

Show help:

```powershell
opentop
```

Initialize `.opentop/opentop.yml`:

```powershell
opentop init
```

Show repository and OpenTop status:

```powershell
opentop status
```

Start the Web dashboard:

```powershell
opentop dashboard
```

This starts API, starts Web, and opens the browser.

Start the terminal app:

```powershell
opentop start
```

Start the text shell:

```powershell
opentop shell
```

Open settings menu:

```powershell
opentop settings
```

## Ticket Commands

Create a local ticket:

```powershell
opentop tickets create --title "Fix login button" --description "Broken on mobile" --labels bug
```

List local tickets:

```powershell
opentop tickets list
opentop tickets list --json
```

Classify a stored ticket:

```powershell
opentop classify 1
```

Build a controlled prompt:

```powershell
opentop prompt 1
opentop prompt 1 --json
```

Create a planned execution:

```powershell
opentop run 1
```

Override branch policy for one run:

```powershell
opentop run 1 --branch-policy new
```

## Execution Commands

List executions:

```powershell
opentop executions list
opentop executions list --json
```

Show one execution:

```powershell
opentop executions show 1
opentop executions show 1 --json
```

## Config Commands

Read effective branch policy:

```powershell
opentop config get execution.defaultBranchPolicy
```

Read project or user scope:

```powershell
opentop config get execution.defaultBranchPolicy --scope project
opentop config get execution.defaultBranchPolicy --scope user
```

Set project policy:

```powershell
opentop config set execution.defaultBranchPolicy new --scope project
```

Set user policy:

```powershell
opentop config set execution.defaultBranchPolicy reuse-current --scope user
```

## Command Semantics

`opentop dashboard` is the Web product entry point.

`opentop start` is the terminal app.

`opentop` without a subcommand stays command-oriented and prints help.

