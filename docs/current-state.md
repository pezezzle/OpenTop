# Current State

This document describes what is implemented today. It is intentionally separate from the target architecture.

## Implemented

OpenTop currently has:

- a pnpm and Turborepo monorepo
- a local CLI package
- a local Fastify API
- a Next.js Web UI
- a compact app-shell Web layout with persistent navigation for Board, Tickets, Executions, and Settings
- core domain types and services
- rule-based ticket classification
- expanded ticket classification with task categories, detected signals, affected areas, risk/complexity scoring, and provider-aware model routing
- layered prompt context with project memory, active learned/user profiles, and prompt-budget limits
- prompt review versioning with approval, rejection, regeneration, and execution gating
- plan artifact versioning with approval, rejection, regeneration, and implementation gating
- worker-plan versioning with dependency-aware work-item decomposition from approved plans
- sequential worker-plan execution with per-work-item executions, dependency release, and integration summaries
- post-run build/test checks for successful workspace-changing executions
- execution review state with approve/reject decisions and optional failed-check override
- diff summaries with per-file patch previews and line counts
- risk summaries derived from classification, failed checks, diff size, and sensitive file changes
- draft pull-request creation from approved executions, with rendered PR body and stored PR metadata
- GitHub connection inspection through `GITHUB_TOKEN`, `GH_TOKEN`, or an authenticated `gh` CLI session
- live GitHub pull-request state reads for stored executions
- draft-to-ready-for-review transitions from the execution detail page
- prompt building from ticket, config, project context, memory, and prompt templates
- local SQLite persistence through `sql.js` and Drizzle
- stored tickets
- stored executions with prompt snapshots, provider logs, and changed files
- stored review-output artifacts with `output_ready`, output kind, and output text
- branch policy resolution
- project and user config reads/writes for `execution.defaultBranchPolicy`
- provider runtime inspection for configured providers and routed model tiers
- provider capability reporting for auth method, structured output, local workspace support, and multi-run suitability
- provider setup persisted as `provider type + connection method + model tier mapping`
- environment-variable based secret resolution boundary for API-key providers
- OpenAI-compatible API-key runtime baseline for providers such as OpenAI, DeepSeek, and OpenRouter
- repository-scoped OAuth credential storage under `~/.opentop/auth`
- real OpenRouter OAuth connect, exchange, and disconnect flow through the local Web UI
- real OpenAI Codex OAuth connect, exchange, and disconnect flow through the local Web UI
- schema-versioned local database migrations through `opentop_meta`
- automated package tests for core, providers, git, and db
- CI workflow that runs `pnpm verify`
- in-repo sandbox example and provider setup recipes
- local CLI linking through `pnpm cli:link`
- a local sandbox repository for testing OpenTop against an external target repo
- a dashboard Web launcher that clears stale `.next` output and starts Next.js with Turbopack to avoid chunk-corruption dev boots

## Current User Flow

The working local flow is:

```text
create ticket
-> list ticket
-> classify ticket
-> build controlled prompt
-> review and approve prompt when required
-> generate and review plan when the workflow is plan-first
-> generate worker plan and inspect work items when a feature is split into implementation slices
-> run ready work items sequentially across isolated or shared workspaces
-> start execution
-> prepare or reuse branch
-> run provider
-> inspect execution checks, diff, risk summary, and review status
-> review output and trigger follow-up execution when needed
-> approve or reject code-changing executions
-> either resolve the ticket manually or create a draft pull request
-> if a draft PR is created by OpenTop, treat the ticket as closed until it is reopened
```

The Web UI now shows the same stored data:

```text
Board
-> Ticket detail
-> Tickets list
-> Prompt preview
-> Prompt review, history, and diff
-> Plan review, history, and diff
-> Worker plan generation, history, and work-item inspection
-> Worker plan run controls, integration summary, and per-work-item latest executions
-> Execution history
-> Execution detail
-> Executions list
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
- `opentop providers setup`
- `opentop tickets create/list`
- `opentop executions list/show`
- `opentop worker-plans show`
- `opentop worker-plans run`
- `opentop work-items list/show`
- `opentop work-items run`
- `opentop classify`
- `opentop prompt`
- `opentop run`
- `opentop providers list/doctor`

## API Status

The API exposes real local data for Web:

- repository status
- config
- providers
- tickets
- ticket detail
- prompt preview
- prompt review state and mutation endpoints
- plan review state and mutation endpoints
- worker-plan generation and work-item inspection endpoints
- worker-plan and work-item execution endpoints
- execution start with branch preparation and provider run
- execution review approval/rejection endpoints
- ticket resolve/reopen endpoints for manual closure flows
- draft pull-request creation endpoint for approved executions
- GitHub handoff status endpoint for repository/auth visibility
- live GitHub pull-request status and ready-for-review endpoints for stored executions
- OAuth connect, exchange, and disconnect endpoints for hosted providers
- executions

The API listens on port `4317` by default.

## Web Status

The Web UI currently has:

- `/`: execution board
- `/tickets`: ticket list
- `/tickets/[ticketId]`: ticket detail, classification, prompt preview, prompt review status, prompt history, prompt diff, plan review status, plan history, plan diff, worker plan generation/history, work-item inspection, executions, and explicit ticket-resolution controls
- `/tickets/[ticketId]`: classification now includes task type, detected signals, provider/model suggestion, reasoning, and prompt approval requirement
- `/executions`: execution list
- `/executions/[executionId]`: execution detail, prompt snapshot, structured review output, checks, execution logs, changed files, diff review, risk summary, draft/ready/merged PR state, review decision actions, and draft PR creation/output
- `/settings`: branch policy settings plus provider health, GitHub handoff status, compatibility warnings, and OAuth connection status
- `/settings`: context profile mode, active profile IDs, and prompt budget settings
- `/settings`: provider setup form for type, connection method, and model tiers
- `/settings/oauth/callback`: local OAuth callback completion and redirect back into Settings

## Not Implemented Yet

OpenTop does not yet:

- import real GitHub Issues into the local store
- stream execution logs
- apply API-provider output as local workspace patches
- runtime adapters for local-model providers such as Ollama
- AI-assisted classifier pass on top of the deterministic routing baseline
- parallel worker execution across multiple work items
- support multi-user operation
- support cloud workers
- support Jira, Linear, Trello, or Azure DevOps imports

## Known Technical Notes

The local database lives in:

```text
.opentop/state/opentop.db
```

This state directory is ignored by Git and should not be committed.

Sequential worker-plan execution uses Git worktrees outside the target repository under a sibling `.opentop-worktrees/` directory so independent work-item branches can accumulate changes without dirtying the root working tree.

Successful workspace-changing executions no longer count as effectively done on their own. They enter review with stored check runs, diff summaries, and a `pending` execution review status until a human explicitly approves or rejects them. Once approved, OpenTop can either mark the ticket as done through an explicit manual-resolution step or push the execution branch and open a GitHub draft pull request using `GITHUB_TOKEN`, `GH_TOKEN`, or an authenticated `gh` CLI session. OpenTop can now also inspect the live GitHub PR state and move a stored draft to `ready for review` from the execution detail page. When OpenTop creates that draft PR itself, it also closes the ticket so no further executions start until someone explicitly reopens it.

The global `opentop` command is currently a local development link to the built CLI in this repo.

OAuth credentials now stay outside the repository in `~/.opentop/auth/`. OpenRouter is the fully supported hosted OAuth runtime path today. OpenAI Codex OAuth is implemented as a real connect/disconnect flow, but OpenTop intentionally keeps it out of the supported runtime set and points users toward `codex-cli` or `openai-api` instead. Providers that only support API keys today, such as Anthropic, remain explicitly unsupported for OAuth in OpenTop rather than appearing half-connected.

The local database now carries a tracked schema version in `opentop_meta`, and package-level tests cover the core orchestration path plus provider, git, and database hardening checks.

OpenAI Codex OAuth can now be connected and inspected, but OpenTop intentionally does not treat it as a supported execution runtime. For ChatGPT/Codex subscription access, prefer `codex-cli`. For direct OpenAI API execution, prefer `openai-api` with an API key.

The dashboard launcher now boots the Web app through the shared `pnpm web` entrypoint, clears `apps/web/.next`, and starts Next.js with Turbopack. That keeps the local board from getting stuck in the stale chunk/runtime errors seen in the older dev startup path.
