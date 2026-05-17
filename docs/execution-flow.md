# Execution Flow

This document describes the OpenTop execution flow as implemented today and the intended next steps.

## Current Flow

The current working flow is:

```text
create ticket
-> load config
-> classify ticket
-> create execution plan
-> build controlled prompt
-> review, approve, reject, or regenerate prompt
-> generate and review plan when required
-> generate worker plan and inspect work items when a feature needs coordinated implementation slices
-> run worker items sequentially across isolated or shared workspaces
-> resolve branch policy
-> store execution record
-> prepare or reuse branch
-> start provider
-> collect logs, changed files, or review output artifacts
-> run configured checks when local files changed
-> store diff summary and risk summary
-> wait for explicit review approval when code changed
-> either close the ticket manually or hand off to GitHub
-> show execution in Web and CLI
```

## Step 1: Create Ticket

Tickets can currently be created manually:

```powershell
opentop tickets create --title "Fix login button" --description "Broken on mobile" --labels bug
```

Tickets are stored in:

```text
.opentop/state/opentop.db
```

## Step 2: Classify Ticket

Classification uses `.opentop/opentop.yml` routing rules.

It determines:

- risk
- complexity
- affected areas
- suggested profile
- suggested model tier
- suggested execution mode
- approval requirement
- reason

## Step 3: Build Execution Plan

The execution plan combines:

- ticket
- classification
- agent profile
- provider ID
- model ID
- generated branch name

## Step 4: Build Prompt

The prompt builder reads:

- `.opentop/opentop.yml`
- `.opentop/project-context.md`
- `.opentop/rules.md`
- `.opentop/memory/*`
- `.opentop/prompts/<profile>.md`
- `.opentop/templates/pull-request.md`

It produces a controlled prompt with:

- execution contract
- ticket content
- classification
- allowed commands
- role guidance
- relevant project guidance
- relevant project memory
- required response format

It also produces a prompt-review snapshot that can be versioned and approved before any provider run begins.

## Step 4.5: Prompt Review Gate

Prompt review is now a first-class gate in the execution flow.

Current behavior:

- generating a prompt for a stored ticket creates or refreshes a prompt-review version
- the latest version starts in `draft` unless it was already approved earlier and nothing changed
- users can approve, reject, or regenerate the latest prompt version from the Web UI
- approval-required tickets cannot start execution until the latest prompt version is `approved`
- rejected prompt versions block execution until a new version is generated and approved

## Step 4.6: Plan Review Gate

Plan-first work now has a dedicated planning stage.

Current behavior:

- `plan_only` tickets always run in planning mode and store plan artifacts
- `plan_then_implement` tickets run in planning mode until an approved plan artifact exists
- the latest plan artifact begins in `draft`
- users can approve, reject, or regenerate the latest plan version from ticket detail
- implementation is blocked while the latest plan artifact is still `draft` or `rejected`
- once approved, the plan is injected back into the implementation prompt as execution context

## Step 4.7: Worker Plan Generation

Feature work can now be decomposed into explicit worker items after plan approval.

Current behavior:

- worker plans are generated from the latest approved plan artifact
- generating a worker plan supersedes older worker-plan versions and older work items for the same ticket
- each work item captures role, dependency, model/provider routing, suggested mode, branch strategy, and review notes
- dependency-free items start in `ready`
- dependent items start in `blocked`
- worker plans are reviewable in Web and inspectable in CLI before Phase 8 begins executing them

## Step 4.8: Multi-Run Worker Execution

Phase 8 adds real sequential execution across worker-plan items.

Current behavior:

- OpenTop can run one work item explicitly or run all currently ready work items for a ticket
- each work-item execution stores `runKind: work_item`, `workerPlanId`, `workItemId`, and `workspacePath`
- isolated work items execute in separate Git worktrees on their own branches
- dependency-chained work items can reuse the same branch workspace
- successful work items move to `done`
- failed work items move to `failed`
- blocked dependents move to `ready` once all prerequisites are done
- the worker plan stores an integration summary and moves through `running`, `integration_ready`, or `failed`
- integration warnings are surfaced when isolated branches need manual consolidation or when multiple work items touched the same files

## Step 5: Resolve Branch Policy

Branch policy determines whether an execution should use a new branch, reuse the current branch, require manual choice, or avoid branch work.

Important current behavior:

- dirty working tree blocks `run`
- `manual` blocks `run`
- `reuse-current` on the default branch resolves to a new branch
- `plan_only` and `review_only` can avoid branch work

## Step 6: Store Execution and Prepare the Workspace

`opentop run <ticketId>` now creates an execution record and prepares the Git workspace when the selected mode needs one.

It stores:

- status
- ticket ID
- profile ID
- provider ID
- model ID
- branch name
- prompt snapshot
- classification snapshot
- artifact kind
- optional output kind
- optional review output text
- review status and reviewer metadata
- optional diff summary
- optional risk summary
- execution logs
- empty changed files

Current behavior:

- `blocked` if the branch policy or working tree prevents a safe run
- `blocked` if prompt approval is required and the latest prompt version is still draft
- `blocked` if the latest prompt version was explicitly rejected
- `blocked` if a generated plan is still waiting for review
- `blocked` if the latest plan version was explicitly rejected
- `succeeded` when branch preparation and provider execution complete successfully
- `output_ready` when provider execution succeeds with reviewable output but no local workspace changes
- `failed` when branch preparation or provider execution fails after the execution record was created

If a provider returns useful model output without changing local files, OpenTop stores that result as a `review_output` artifact and marks the execution `output_ready` instead of pretending that repository files changed.

The current Web and CLI review surfaces also try to make that output actionable by showing a clearer summary, extracted key points, referenced files when detectable, and suggested next steps for the reviewer.

When a successful execution changes local files, OpenTop also:

- runs configured `build` and `test` commands
- stores one check-run record per command
- captures a diff summary with per-file patch previews when possible
- derives a review risk summary from classification, failed checks, and diff size
- marks the execution `reviewStatus: pending`

Only once a human approves that execution does the ticket become ready for closure. Failed checks keep the execution reviewable but block approval unless the reviewer explicitly overrides them.

After approval, OpenTop can:

- mark the ticket `Done, PR handled manually`
- mark the ticket `Done without PR`
- render a draft PR body from `.opentop/templates/pull-request.md`, push the execution branch to `origin`, create a GitHub draft PR, and store the resulting PR metadata back on the execution

When OpenTop creates that draft PR itself, it closes the ticket automatically. A closed ticket blocks new executions until someone reopens it.

When the execution is a planning pass, OpenTop also parses the planner output into a structured plan artifact and stores it for explicit review before implementation begins.

## Intended Future Flow

The future full flow is:

```text
load ticket
-> classify
-> route profile/model/mode
-> build prompt
-> require approval if needed
-> ensure repo state
-> create or reuse branch
-> run provider adapter
-> collect logs
-> collect changed files
-> run configured checks
-> human review
-> create draft PR
-> store final execution result
```

## Current Gap

The current execution flow now reaches draft pull-request creation, but it still stops before richer PR lifecycle management.

Still missing:

- log streaming
- safe parallel execution across worker plans
- deeper GitHub review/comment synchronization beyond PR state and ready-for-review transitions
