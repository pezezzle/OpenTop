# Current State

This document describes what is implemented today. It is intentionally separate from the target architecture.

## Implemented

OpenTop currently has:

- a pnpm and Turborepo monorepo
- a local CLI package
- a local Fastify API
- a Next.js Web UI
- core domain types and services
- rule-based ticket classification
- prompt building from ticket, config, project context, memory, and prompt templates
- local SQLite persistence through `sql.js` and Drizzle
- stored tickets
- stored planned executions
- branch policy resolution
- project and user config reads/writes for `execution.defaultBranchPolicy`
- local CLI linking through `pnpm cli:link`
- a local sandbox repository for testing OpenTop against an external target repo

## Current User Flow

The working local flow is:

```text
create ticket
-> list ticket
-> classify ticket
-> build controlled prompt
-> create planned execution
-> inspect execution
```

The Web UI now shows the same stored data:

```text
Board
-> Ticket detail
-> Prompt preview
-> Execution history
-> Execution detail
-> Settings
```

## Primary Interface

The Web UI is the primary product surface.

Start it with:

```powershell
cd C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox
opentop dashboard
```

`opentop dashboard` starts the local API, starts the Web UI, and opens the browser at:

```text
http://127.0.0.1:3000
```

## CLI Status

The CLI is available through:

```powershell
opentop
```

The CLI is meant for setup, automation, and power-user workflows. It is not the main product UI.

Current commands include:

- `opentop init`
- `opentop status`
- `opentop dashboard`
- `opentop start`
- `opentop shell`
- `opentop settings`
- `opentop config get/set`
- `opentop tickets create/list`
- `opentop executions list/show`
- `opentop classify`
- `opentop prompt`
- `opentop run`

## API Status

The API exposes real local data for Web:

- repository status
- config
- tickets
- ticket detail
- prompt preview
- planned execution creation
- executions

The API listens on port `4317` by default.

## Web Status

The Web UI currently has:

- `/`: execution board
- `/tickets/[ticketId]`: ticket detail, classification, prompt preview, executions
- `/executions/[executionId]`: execution detail and prompt snapshot
- `/settings`: branch policy settings

## Not Implemented Yet

OpenTop does not yet:

- import real GitHub Issues into the local store
- create real Git branches during execution
- run a real AI provider during `run`
- run configured build/test commands as part of execution
- collect real changed files from provider output
- create draft pull requests
- stream execution logs
- support multi-user operation
- support cloud workers
- support Jira, Linear, Trello, or Azure DevOps imports

## Known Technical Notes

The local database lives in:

```text
.opentop/state/opentop.db
```

This state directory is ignored by Git and should not be committed.

The global `opentop` command is currently a local development link to the built CLI in this repo.

