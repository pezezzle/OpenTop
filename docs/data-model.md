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

- `risk`
- `complexity`
- `affectedAreas`
- `suggestedProfile`
- `suggestedModelTier`
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
failed
cancelled
```

Current `run` behavior stores a `planned` execution.

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
```

The `tickets` table stores normalized ticket input.

The `executions` table stores planned execution snapshots, including prompt and classification snapshots.

