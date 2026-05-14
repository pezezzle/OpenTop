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

### `PUT /config`

Updates supported config values.

Currently supported key:

```text
execution.defaultBranchPolicy
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
- executions for the ticket

### `POST /tickets/:ticketId/classify`

Classifies a stored ticket and returns classification plus execution plan.

### `GET /tickets/:ticketId/prompt`

Builds and returns the controlled prompt for a stored ticket.

### `POST /tickets/:ticketId/run`

Starts an execution for a stored ticket.

Optional request field:

```json
{
  "branchPolicy": "new"
}
```

Current behavior creates an execution record, applies branch policy, prepares or reuses the working branch when needed, and runs the configured provider synchronously.

### `GET /executions`

Lists stored executions.

### `GET /executions/:executionId`

Returns one stored execution.

### `POST /classify`

Compatibility endpoint for classifying manual request input without storing a ticket.

## Current API Limitations

The API does not yet:

- stream logs
- run checks
- create draft PRs
- import external tickets
