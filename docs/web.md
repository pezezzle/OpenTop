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
- provider readiness summary
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
- prompt review status and approval requirement
- approve, reject, and regenerate prompt actions
- prompt version history and reviewer comments
- prompt diff between the latest and previous version
- plan review status for `plan_only` and `plan_then_implement`
- approve, reject, and regenerate plan actions
- plan summary, implementation steps, work items, risks, and open questions
- plan version history and plan diff between versions
- worker-plan generation action after plan approval
- worker-plan summary, version history, and stale-plan notice
- worker-plan run action and integration summary
- per-work-item role, dependency, routing, branch-strategy, and review-note inspection
- per-work-item run action and latest linked execution
- prompt context summary, influences, included sections, and sources
- execution history
- `Start execution` action
- latest execution review status when code changes are waiting for approval

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
- review guidance and structured review output when a run produced a plan, patch proposal, or review note
- execution review status and approval/rejection actions for successful workspace-changing runs
- stored build/test checks with captured command output
- execution logs
- changed files
- diff review with per-file patch previews
- risk summary and suggested reviewer actions
- draft pull-request creation and stored draft PR output for approved executions

### Settings

Path:

```text
/settings
```

Shows and updates:

- effective branch policy
- project branch policy
- user branch policy
- effective context profiles, loaded profile IDs, and prompt budget
- configured providers
- connection method per provider
- routed model tiers
- runtime availability warnings
- common model/provider compatibility warnings
- OAuth connection state, connect, and disconnect actions for hosted providers
- provider setup form for command, API-key env, base URL, OAuth metadata, and model tiers
- context settings form for learned profile IDs, user profile IDs, profile mode, scope, and prompt budget

The Settings surface now supports a full local OAuth callback round-trip for supported providers. Today:

- `openrouter-api` is a supported hosted OAuth runtime path
- `openai-codex` can connect and show connection state, but OpenTop intentionally does not treat it as a supported execution runtime

Other providers still show explicit unsupported status until they have a real OAuth implementation.

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
- execute worker plans in parallel
- display multi-project state
