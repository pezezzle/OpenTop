# API

The OpenTop API is the local HTTP boundary used by the Web UI.

The API is implemented in `apps/api` with Fastify. It validates HTTP input, opens the target repository state, calls core services, and returns JSON.

The API should not own business rules. Classification, prompt building, execution planning, and branch policy resolution belong in `packages/core`.

## Start

```powershell
pnpm api
```

The default port is:

```text
4317
```

To point the API at a target repo:

```powershell
$env:OPENTOP_REPO_PATH = "C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox"
pnpm api
```

Requests can also pass:

```text
?repoPath=C:\path\to\repo
```

## Endpoints

### `GET /health`

Returns a simple service health response.

### `GET /status`

Returns repository and OpenTop state.

Response includes:

- repository path
- project name
- default branch
- branch policy
- current branch
- clean or dirty working tree
- changed files
- stored ticket count
- stored execution count

### `GET /config`

Returns branch policy config values.

Response includes:

- effective value
- project value
- user value

### `GET /context`

Returns resolved context settings and available context profiles.

Response includes:

- effective context settings
- project context settings
- user context settings
- active loaded profiles
- available learned and user profiles found under `~/.opentop`

### `GET /providers`

Returns configured providers enriched with:

- provider type
- connection method
- command
- routed model tiers
- runtime availability
- CLI version when detectable
- OAuth connection state when applicable
- warnings or errors about provider compatibility

### `PUT /providers/:providerId`

Creates or updates provider setup in project config.

Request fields:

- `type`
- `connectionMethod`
- `command`
- `apiKeyEnv`
- `oauthProvider`
- `baseUrl`
- `modelMappings`

### `POST /providers/:providerId/oauth/start`

Starts an interactive OAuth connect flow for an OAuth-configured provider and returns:

- `authorizationUrl`
- `callbackUrl`
- `sessionId`

### `POST /providers/:providerId/oauth/exchange`

Completes the OAuth flow after the local Web callback receives a provider code.

Request fields:

- `sessionId`
- `code`
- `error`
- `errorDescription`

### `POST /providers/:providerId/oauth/disconnect`

Removes stored user-scope OAuth credentials for the provider in the current repository context.

OpenTop currently uses these endpoints for:

- `openrouter-api` as a supported hosted OAuth runtime path
- `openai-codex` as a real connect/disconnect path that is intentionally not treated as an execution runtime

### `PUT /config`

Updates supported config values.

Currently supported key:

```text
execution.defaultBranchPolicy
context.profileMode
```

Supported values:

```text
new
reuse-current
manual
none
```

Supported scopes:

```text
project
user
```

### `GET /tickets`

Returns stored tickets enriched with:

- classification
- execution plan
- latest execution
- workflow stage

Workflow stages are:

```text
Inbox
Classified
Ready
Running
Review
Done
```

### `POST /tickets`

Creates a local ticket.

Request fields:

- `title`
- `description`
- `labels`
- `source`
- `externalId`

### `GET /tickets/:ticketId`

Returns a ticket detail payload:

- enriched ticket
- classification
- execution plan
- built prompt
- current prompt review
- prompt review history
- latest plan artifact
- plan artifact history
- latest worker plan
- worker-plan history
- work items for the latest ticket decomposition
- executions for the ticket

The enriched ticket now also includes:

- `status`
- `resolutionType`
- `resolutionNote`
- `resolvedAt`

### `POST /tickets/:ticketId/classify`

Classifies a stored ticket and returns classification plus execution plan.

### `POST /tickets/:ticketId/resolve`

Explicitly closes a ticket after review, even when the PR step is handled outside OpenTop.

Request fields:

- `resolutionType` (`done`, `manual_pr`, or `no_pr`)
- `resolutionNote` (optional)

This route rejects the request when the latest execution is still running or when a successful code-changing execution still has a pending review decision.

### `POST /tickets/:ticketId/reopen`

Reopens a resolved ticket, clears the stored resolution metadata, and restores it to an actionable workflow state.

### `GET /tickets/:ticketId/prompt`

Builds and returns the controlled prompt for a stored ticket.

The prompt payload includes:

- `prompt`
- `sources`
- `contextSummary`
- `promptReview`

`contextSummary` shows which profiles and sections influenced the generated prompt and how much of the prompt budget was used.

### `POST /tickets/:ticketId/prompt/regenerate`

Creates a new prompt-review version for the ticket and returns it.

Optional request field:

```json
{
  "reviewerComment": "Refresh after updating context settings."
}
```

### `POST /tickets/:ticketId/prompt/:promptReviewId/approve`

Approves the latest prompt-review version for a ticket.

Optional request field:

```json
{
  "reviewerComment": "Looks good for execution."
}
```

### `POST /tickets/:ticketId/prompt/:promptReviewId/reject`

Rejects the latest prompt-review version for a ticket.

Optional request field:

```json
{
  "reviewerComment": "Needs a clearer migration plan."
}
```

### `GET /tickets/:ticketId/plan`

Returns the latest plan artifact plus the stored plan-history list for the ticket.

### `POST /tickets/:ticketId/plan/regenerate`

Runs a fresh planning pass and stores a new draft plan artifact.

Optional request field:

```json
{
  "reviewerComment": "Regenerate after revising assumptions."
}
```

### `POST /tickets/:ticketId/plan/:planArtifactId/approve`

Approves the latest plan version for the ticket.

### `POST /tickets/:ticketId/plan/:planArtifactId/reject`

Rejects the latest plan version for the ticket.

### `GET /tickets/:ticketId/worker-plan`

Returns the latest worker plan, worker-plan history, and stored work items for the ticket.

### `POST /tickets/:ticketId/worker-plan/generate`

Generates a new worker plan from the latest approved plan artifact.

Optional request field:

```json
{
  "reviewerComment": "Split the approved plan into implementation slices."
}
```

### `GET /work-items/:workItemId`

Returns one stored work item.

### `POST /tickets/:ticketId/worker-plan/run`

Runs the latest non-superseded worker plan for a ticket sequentially across all ready work items.

Response includes:

- updated `workerPlan`
- refreshed `workItems`
- linked `executions`
- orchestration `summary`
- `integrationSummary`
- `integrationIssues`

### `POST /work-items/:workItemId/run`

Runs one stored work item and returns the updated work item, worker plan, and linked execution when one was created.

### `PUT /context`

Updates context settings for `project` or `user` scope.

Request fields:

- `learnedProfiles`
- `userProfiles`
- `profileMode`
- `maxPromptProfileWords`
- `maxProfileSections`
- `scope`

### `POST /tickets/:ticketId/run`

Starts an execution for a stored ticket.

Optional request field:

```json
{
  "branchPolicy": "new"
}
```

Current behavior creates an execution record, applies branch policy, prepares or reuses the working branch when needed, and runs the configured provider synchronously.

If the ticket requires prompt approval, the API returns a `blocked` result until the latest prompt-review version is approved.

If the ticket is in a plan-first workflow, the API runs a planning pass first and stores a plan artifact. `plan_then_implement` execution is blocked until the latest plan artifact is approved.

Blocked execution responses include:

- `blocker`
- `reason`
- current `promptReview`
- current `planArtifact`

When a provider produces reviewable output without changing local files, the API returns an execution with status `output_ready` and `artifactKind: "review_output"`.

When a provider changes local files successfully, the API also stores and returns:

- `reviewStatus`
- `diffSummary`
- `riskSummary`

### `GET /executions`

Lists stored executions.

### `GET /executions/:executionId`

Returns one stored execution plus its recorded check runs.

Response includes:

- `execution`
- `checkRuns`

### `POST /executions/:executionId/review/approve`

Approves a successful workspace-changing execution.

Optional request fields:

```json
{
  "reviewerComment": "Looks good after checking the diff.",
  "overrideFailedChecks": false
}
```

Failed checks block approval unless `overrideFailedChecks` is set to `true`.

### `POST /executions/:executionId/review/reject`

Rejects a successful workspace-changing execution.

Optional request field:

```json
{
  "reviewerComment": "Needs another pass before this should count as done."
}
```

### `POST /executions/:executionId/pull-request`

Creates a GitHub draft pull request for one approved workspace-changing execution.

Optional request field:

```json
{
  "overrideFailedChecks": false
}
```

This route:

- renders the PR body from `.opentop/templates/pull-request.md`
- pushes the execution branch to `origin`
- creates a GitHub draft PR using either `GITHUB_TOKEN` / `GH_TOKEN` or an authenticated `gh` CLI session
- stores the resulting PR metadata back on the execution

Draft PR creation is optional. A human can instead resolve the ticket manually through `/tickets/:ticketId/resolve`.
When this route succeeds, OpenTop also marks the underlying ticket as `done` with an internal resolution marker so the workflow does not keep accepting new executions until the ticket is reopened.

### `POST /classify`

Compatibility endpoint for classifying manual request input without storing a ticket.

## Current API Limitations

The API does not yet:

- stream logs
- run checks
- import external tickets
- execute work items in parallel
