# Data Model

OpenTop currently stores local state in SQLite under:

```text
.opentop/state/opentop.db
```

The state file is ignored by Git.

## Ticket

A ticket is normalized work input.

Fields:

- `id`
- `source`
- `externalId`
- `title`
- `description`
- `labels`
- `status`
- optional `classification`

Supported sources:

```text
manual
github
linear
jira
trello
azure-devops
```

Current implemented source:

```text
manual
```

Supported ticket statuses:

```text
inbox
classified
ready
running
review
done
```

## Classification

Classification is the structured assessment of a ticket.

Fields:

- `taskType`
- `risk`
- `complexity`
- `affectedAreas`
- `detectedSignals`
- `suggestedProfile`
- `suggestedProviderId`
- `suggestedModelTier`
- `suggestedModel`
- `suggestedMode`
- `approvalRequired`
- `reason`

Risk levels:

```text
low
medium
high
critical
```

Complexity levels:

```text
low
medium
high
```

Classification is currently rule-based from labels, keywords, and config.

## Agent Profile

An agent profile defines how a ticket should be handled.

Fields:

- `id`
- `description`
- `mode`
- `modelTier`
- `requiresApproval`
- `allowedCommands`

Execution modes:

```text
plan_only
implement_only
implement_and_test
plan_then_implement
review_only
fix_build
draft_pr
```

## Execution Plan

An execution plan is computed before an execution is stored.

Fields:

- `ticket`
- `classification`
- `profile`
- `providerId`
- `modelId`
- `branchName`

## Context Settings

Context settings control how project and profile context are resolved before prompt generation.

Fields:

- `learnedProfiles`
- `userProfiles`
- `profileMode`
- `maxPromptProfileWords`
- `maxProfileSections`

Supported `profileMode` values:

```text
project-first
profile-first
project-only
profile-only
manual
```

## Execution

An execution is a stored run record.

Fields:

- `id`
- `ticketId`
- `profileId`
- `providerId`
- `modelId`
- `status`
- `branchName`
- `promptSnapshot`
- `classificationSnapshot`
- `artifactKind`
- `outputKind`
- `outputText`
- `logs`
- `changedFiles`
- `pullRequestUrl`
- `createdAt`
- `updatedAt`

Execution statuses:

```text
planned
queued
running
succeeded
output_ready
failed
cancelled
```

Current `run` behavior creates an execution record, prepares or reuses a branch when needed, runs the configured provider, and leaves the execution in `succeeded`, `output_ready`, or `failed`.

`output_ready` means the provider returned reviewable output such as a plan, patch proposal, or review note without applying local workspace changes.

`runKind` distinguishes whether an execution belongs to the ticket-level flow, the planning flow, or a worker-plan work item:

```text
ticket
planning
work_item
```

Additional execution linkage fields:

- `workerPlanId`
- `workItemId`
- `workspacePath`

`artifactKind` distinguishes whether an execution produced local repository changes or reviewable output only:

```text
workspace_changes
review_output
```

`outputText` stores provider output for review-oriented executions such as plan or patch proposals that do not modify local files.

`outputKind` further distinguishes review-oriented output:

```text
plan
patch_proposal
review_note
general
```

Additional execution review fields:

- `reviewStatus`
- `reviewerComment`
- `reviewedAt`
- `diffSummary`
- `riskSummary`
- `pullRequest`

Execution review statuses:

```text
not_required
pending
approved
rejected
```

`diffSummary` stores:

- total changed files
- total additions
- total deletions
- per-file change type
- per-file patch preview when one was available

`riskSummary` stores:

- overall review risk level
- whether human review is required
- reasons that raised review risk
- suggested reviewer actions
- failed check names

Current behavior:

- successful workspace-changing runs are stored as `reviewStatus: pending`
- `output_ready` and other non-code-changing runs stay `reviewStatus: not_required`
- approved executions can move the ticket workflow to `Done`
- rejected executions remain review items until superseded or replaced

`pullRequest` stores:

- PR URL
- PR number
- PR title
- rendered PR body
- base branch
- head branch
- repository full name
- draft state
- PR creation timestamp

Current behavior:

- draft PR metadata is persisted on the execution that created it
- one execution currently owns at most one stored draft PR link
- PR creation requires a successful, approved workspace-changing execution

## Check Run

A check run is one stored post-execution command result linked to an execution.

Fields:

- `id`
- `executionId`
- `name`
- `command`
- `status`
- `exitCode`
- `output`
- `createdAt`
- `updatedAt`

Check-run statuses:

```text
passed
failed
skipped
```

Current behavior:

- successful workspace-changing executions run configured `build` and `test` commands
- check results are stored even when one of the commands fails
- failed checks raise execution risk and block review approval unless explicitly overridden

## Prompt Review

A prompt review is the stored review state for one generated prompt version.

Fields:

- `id`
- `ticketId`
- `version`
- `status`
- `promptSnapshot`
- `sources`
- `contextSummary`
- `classificationSnapshot`
- `executionPlanSnapshot`
- `reviewerComment`
- `createdAt`
- `updatedAt`

Prompt review statuses:

```text
draft
approved
rejected
superseded
```

Current behavior:

- building or refreshing a ticket prompt creates a `draft` review version when the prompt content changed
- approving a prompt marks the latest version `approved`
- rejecting a prompt marks the latest version `rejected`
- regenerating a prompt creates a new `draft` version and supersedes an older draft
- execution for approval-required work is blocked until the latest prompt version is `approved`

## Plan Artifact

A plan artifact is the stored planning result for a plan-first ticket.

Fields:

- `id`
- `ticketId`
- `sourceExecutionId`
- `sourcePromptReviewId`
- `version`
- `status`
- `rawOutput`
- `structuredPlan`
- `classificationSnapshot`
- `executionPlanSnapshot`
- `reviewerComment`
- `createdAt`
- `updatedAt`

Plan artifact statuses:

```text
draft
approved
rejected
superseded
```

`structuredPlan` currently stores:

- `summary`
- `assumptions`
- `implementationSteps`
- `risks`
- `openQuestions`
- `workItems`

Current behavior:

- `plan_only` and the planning phase of `plan_then_implement` store structured plan artifacts
- a plan-first ticket blocks further execution when the latest plan artifact is still `draft`
- approving a plan artifact allows `plan_then_implement` to move into implementation mode
- regenerating a plan creates a new draft version while preserving history

## Worker Plan

A worker plan is the stored decomposition of an approved plan artifact into executable work slices.

Fields:

- `id`
- `ticketId`
- `sourcePlanArtifactId`
- `version`
- `status`
- `summary`
- `classificationSnapshot`
- `executionPlanSnapshot`
- `reviewerComment`
- `createdAt`
- `updatedAt`

Worker plan statuses:

```text
draft
ready
running
integration_ready
failed
superseded
```

Current behavior:

- worker plans can only be generated from an approved plan artifact
- generating a new worker plan supersedes older worker-plan versions for the same ticket
- the latest worker plan preserves the classification and execution-plan snapshot from the source plan

## Work Item

A work item is one planned implementation slice inside a worker plan.

Fields:

- `id`
- `workerPlanId`
- `ticketId`
- `sourcePlanArtifactId`
- `sourcePlanWorkItemId`
- `key`
- `title`
- `summary`
- `integrationSummary`
- `role`
- `status`
- `affectedAreas`
- `dependsOn`
- `suggestedProviderId`
- `suggestedModelTier`
- `suggestedModelId`
- `suggestedMode`
- `branchStrategy`
- `reviewNotes`
- `createdAt`
- `updatedAt`

Work item statuses:

```text
planned
ready
blocked
in_progress
done
failed
cancelled
superseded
```

Worker roles:

```text
backend
frontend
data
integration
test
docs
security
reviewer
generalist
```

Branch strategies:

```text
isolated_worktree
shared_ticket_branch
reuse_parent_branch
```

Current behavior:

- work items are derived from structured plan work items when available, otherwise from implementation steps
- work items inherit routing and review context from the approved plan artifact
- dependency-free work items start in `ready`
- work items with dependencies start in `blocked`
- work-item executions can move items through `in_progress`, `done`, and `failed`
- sequential worker-plan runs unblock dependent work items once all of their prerequisites are `done`

## Branch Policy

Branch policy controls how OpenTop decides where execution work should happen.

Supported values:

```text
new
reuse-current
manual
none
```

Resolution order:

```text
CLI override
-> project config
-> user config
-> built-in default
```

Project config:

```text
.opentop/opentop.yml
```

User config:

```text
C:\Users\<user>\.opentop\config.yml
```

Current built-in default:

```text
reuse-current
```

## SQLite Tables

Current tables:

```text
tickets
executions
prompt_reviews
plan_artifacts
worker_plans
work_items
```

The `tickets` table stores normalized ticket input.

The `executions` table stores execution snapshots, including prompt snapshots, classification snapshots, branch names, logs, and later changed-file or PR metadata.

The `prompt_reviews` table stores versioned prompt snapshots, context summaries, classification and execution-plan snapshots, review status, and reviewer comments.

The `plan_artifacts` table stores versioned raw planner output plus parsed plan structure, review state, execution linkage, and reviewer comments.

The `worker_plans` table stores versioned decompositions of approved plan artifacts together with classification and execution-plan snapshots.

The `work_items` table stores per-slice routing, dependency, branch-strategy, and review metadata for one worker plan.
