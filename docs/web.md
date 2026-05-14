# Web UI

The Web UI is the primary user interface for OpenTop.

The Web app lives in `apps/web` and uses Next.js. It reads data through the local API, not directly from SQLite.

## Start

The normal user command is:

```powershell
cd C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox
opentop dashboard
```

This starts API, starts Web, and opens:

```text
http://127.0.0.1:3000
```

For development, API and Web can be started separately:

```powershell
$env:OPENTOP_REPO_PATH = "C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox"
pnpm api
pnpm web
```

## Screens

### Board

Path:

```text
/
```

Shows:

- repository summary
- current branch
- effective branch policy
- working tree status
- ticket lanes
- ticket cards
- latest workflow stage

Board lanes:

```text
Inbox | Classified | Ready | Running | Review | Done
```

### Ticket Detail

Path:

```text
/tickets/[ticketId]
```

Shows:

- ticket title and description
- labels
- workflow stage
- suggested branch name
- classification
- prompt preview
- execution history
- `Plan execution` action

### Execution Detail

Path:

```text
/executions/[executionId]
```

Shows:

- execution status
- ticket ID
- branch name
- agent profile
- provider and model
- classification snapshot
- prompt snapshot

### Settings

Path:

```text
/settings
```

Shows and updates:

- effective branch policy
- project branch policy
- user branch policy

Supported policies:

```text
new
reuse-current
manual
none
```

## Web/API Boundary

The Web UI calls `apps/web/lib/opentop-api.ts`, which talks to the API at:

```text
http://127.0.0.1:4317
```

The Web app can target a repository through:

```text
OPENTOP_REPO_PATH
```

That value is passed to the API as `repoPath`.

## Current Web Limitations

The Web UI does not yet:

- import GitHub Issues
- show live execution logs
- show changed file diffs
- approve or reject runs
- open draft pull requests
- manage providers and model tiers
- display multi-project state

