# Web UI

The Web UI is the primary user interface for OpenTop.

The Web app lives in `apps/web` and uses Next.js. It reads data through the local API, not directly from SQLite.

The current UX and technical target structure for the Web app is documented separately in [Web UI Architecture](implementation/web-ui-architecture.md).

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

The dashboard launcher starts the Web app through the shared `pnpm web` entrypoint, clears the local `apps/web/.next`
cache before boot, and runs Next.js with Turbopack. That is intentional: it avoids the stale chunk/runtime errors that
showed up in the older Webpack-based dev startup path.

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
- top-level workflow summary for ready work, review work, and review-output runs
- ticket lanes
- ticket cards
- recent executions
- create-ticket form

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
- current workflow focus and next recommended action
- workflow progress strip from prompt through PR
- summary cards for task type, routing, and latest run
- labels, workflow stage, and suggested branch name
- explicit ticket-resolution status, note, and timestamp when work is manually closed or auto-closed after PR creation
- classification and routing rationale
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
- `Start execution` action plus quick link to the latest execution
- latest execution review status when code changes are waiting for approval
- `Done, PR handled manually`, `Done without PR`, and `Reopen ticket` actions so PR creation stays optional

The Web UI intentionally exposes only two explicit close modes in the ticket workflow:

- `Done, PR handled manually`
- `Done without PR`

The older generic `done` resolution value is still tolerated internally for compatibility, but it is no longer presented as a primary user choice.

When OpenTop itself creates a draft pull request, the ticket is automatically closed in OpenTop. To continue work after that point, reopen the ticket first.

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
- current workflow focus and next recommended action
- execution snapshot for status, review, and PR stage
- summary cards for changed files, checks, and risk level
- classification snapshot
- review guidance and structured review output when a run produced a plan, patch proposal, or review note
- execution review status and approval/rejection actions for successful workspace-changing runs
- stored build/test checks with captured command output
- changed files
- diff review with per-file patch previews
- risk summary and suggested reviewer actions
- prompt snapshot
- execution logs
- draft pull-request creation and stored draft PR output for approved executions
- live GitHub pull-request state such as draft, ready for review, merged, or closed
- `Mark ready for review` when the stored GitHub PR is still draft
- non-crashing blocked PR notice when neither API tokens nor an authenticated `gh` CLI session are available

OpenTop creates **draft** pull requests on purpose. They are intended as a handoff checkpoint and remain unmergeable until a human marks them ready for review on GitHub.

Approved executions can now be treated as ready for downstream work without forcing PR creation inside OpenTop. The ticket itself is only considered `Done` after an explicit resolution action on the ticket page.

### Settings

Path:

```text
/settings
```

Shows and updates:

- summary cards for branch policy, context mode, provider health, and GitHub handoff state
- GitHub connection details for repository remote, auth source, account, scopes, and PR capabilities
- effective branch policy
- project branch policy
- user branch policy
- provider setup form for command, API-key env, base URL, OAuth metadata, and model tiers
- configured providers and runtime health
- connection method per provider
- routed model tiers
- runtime availability warnings
- common model/provider compatibility warnings
- OAuth connection state, connect, and disconnect actions for hosted providers
- effective context profiles, loaded profile IDs, and prompt budget
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

## Current Technical Shape

Today the Web app is still relatively route-heavy:

- global styles come from [apps/web/app/styles.css](/Users/ronnybigler/Documents/Coding/opentop/OpenTop/apps/web/app/styles.css)
- the root layout imports that single stylesheet from [apps/web/app/layout.tsx](/Users/ronnybigler/Documents/Coding/opentop/OpenTop/apps/web/app/layout.tsx)
- most screen markup still lives directly in route files under `apps/web/app/...`

That is good enough for the current product surface, but it is not the long-term shape.

The intended direction is:

- thin route files
- shared app-shell and workflow components
- feature folders for board, tickets, executions, and settings
- global CSS only for tokens, base styles, and shell layout
- component-local CSS modules for feature styling

See [Web UI Architecture](implementation/web-ui-architecture.md) for the target file layout and migration plan.

## Current Web Limitations

The Web UI does not yet:

- import GitHub Issues
- show live execution logs
- execute worker plans in parallel
- display multi-project state
