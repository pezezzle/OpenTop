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
-> resolve branch policy
-> store execution record
-> prepare or reuse branch
-> queue execution
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
- execution logs
- empty changed files

Current behavior:

- `blocked` if the branch policy or working tree prevents a safe run
- `queued` when branch preparation succeeds or no branch is needed
- `failed` when branch preparation itself fails after the execution record was created

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
-> create draft PR
-> store final execution result
-> human review
```

## Current Gap

The current execution flow stops at `queued`.

Still missing:

- provider execution
- test/build command execution
- changed-file capture
- draft PR creation
- log streaming
- approval gates in Web
