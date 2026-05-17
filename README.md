# OpenTop

**Open Ticket Orchestrator Platform**

OpenTop is an open-source control plane for agentic software development. It turns software tickets into controlled AI executions by analyzing the work, selecting an agent profile and model route, running the agent in an isolated branch, and producing reviewable output such as logs, checks, diffs, and optional draft pull requests.

```text
Ticket
-> Classification
-> Model route
-> Agent profile
-> Controlled execution
-> Branch / PR
-> Human review
```

## Status

This repository is in the first `0.1` scaffold phase. The current focus is a local CLI, a small API, a lightweight web UI, and reusable packages for routing, providers, Git integration, and GitHub import.

## MVP Scope

- Import GitHub Issues and manual tickets.
- Classify tickets by risk, complexity, labels, keywords, and affected areas.
- Suggest an agent profile, model tier, and execution mode.
- Require approval for risky work.
- Run agent executions through provider adapters.
- Create isolated branches and optional draft pull requests.
- Let humans finish tickets either manually or through GitHub handoff.
- Keep logs, changed files, and check results visible.

## Repository Layout

```text
apps/
  api/      Fastify API for local orchestration
  cli/      OpenTop command line interface
  web/      Next.js web UI

packages/
  core/     Domain types, config, classifier, execution planning
  db/       SQLite and Drizzle persistence adapters
  providers/ Provider adapter contracts and implementations
  git/      Git helper utilities
  github/   GitHub issue and pull request integration
  shared/   Shared constants and primitive types

docs/       Product and architecture documentation
.opentop/   Example project configuration
```

## Architecture

OpenTop keeps business logic out of `apps/cli`, `apps/api`, and `apps/web`. Those apps are entry points only. The domain and orchestration logic live in `packages/core`, while database, provider, Git, and GitHub integrations are adapters around that core.

See [docs/architecture.md](docs/architecture.md) for the target architecture and MVP build order.

## Documentation

The full documentation index lives in [docs/README.md](docs/README.md).

Start with:

- [Overview](docs/overview.md)
- [Current State](docs/current-state.md)
- [CLI](docs/cli.md)
- [API](docs/api.md)
- [Web UI](docs/web.md)
- [Data Model](docs/data-model.md)
- [Execution Flow](docs/execution-flow.md)
- [Context Profiles](docs/context-profiles.md)

## Project Context

OpenTop projects can provide execution context through `.opentop/`: project context, rules, memory files, prompt templates, and pull request templates. Public defaults belong in the repository; local overrides and secrets stay ignored.

See [docs/opentop-project-context-and-memory.md](docs/opentop-project-context-and-memory.md) for the structure and rules.

## Quick Start

```bash
npm install -g pnpm@9.15.0
pnpm install
pnpm verify
pnpm build
pnpm cli:dev -- status
pnpm cli:dev -- tickets create --title "Fix login button" --labels bug
pnpm cli:dev -- tickets list
pnpm cli:dev -- classify 1
pnpm cli:dev -- prompt 1 --json
pnpm cli:dev -- run 1
pnpm cli:dev -- executions list
pnpm cli:dev -- prompt --title "Fix login button" --labels bug
```

## Local CLI

OpenTop itself lives in this repository. The repository you want OpenTop to orchestrate is the target repository.

In local development, that target repository is often a separate sandbox such as `OpenTop-Sandbox`.

You can target the current repository or a separate sandbox repository with `--repo`:

```bash
pnpm cli:dev --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox status
pnpm cli:dev --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox tickets list
```

When you run `opentop` from inside a target repository, OpenTop uses the current working directory as the target by default.

For example, after linking the CLI:

```bash
cd /Users/<you>/Coding/OpenTop/OpenTop-Sandbox
opentop dashboard
```

To expose a real local `opentop` command on your machine, install or link it from the OpenTop repository that contains the CLI source code.

All supported local development platforms:

```bash
pnpm cli:link
```

Then you can call:

```bash
opentop --repo C:\\Users\\ronny\\Coding\\OpenTop\\OpenTop-Sandbox status
```

Use `pnpm web` to start the board on port `3000` and `pnpm api` to start the local API.

To point Web and API at a sandbox or customer repository, set `OPENTOP_REPO_PATH` before starting them:

```powershell
$env:OPENTOP_REPO_PATH = "C:\Users\ronny\Coding\OpenTop\OpenTop-Sandbox"
pnpm api
pnpm web
```

For an interactive CLI entrypoint:

```bash
opentop
opentop start
opentop dashboard
opentop shell
opentop settings
```

`opentop` without a subcommand stays command-oriented and prints help. `opentop start` opens the terminal app. `opentop dashboard` starts the local API and Web UI for the selected repository and opens the browser on `http://localhost:3000`. `opentop shell` keeps the text shell available as a fallback. `opentop settings` opens the settings menu directly.

Dashboard shortcuts:

```text
Tab / h / l    switch panels
j / k          move selection
Enter          primary action
r              refresh
q / Esc        exit

Tickets panel:
c              classify selected ticket
p              preview prompt
x              run execution
```

OpenTop treats the Web app as the primary user interface. The CLI remains for setup, automation, and power-user workflows.

## Daily Workflow

The current intended daily flow is:

```text
ticket
-> classify
-> prompt / plan review when needed
-> run execution
-> review diff, checks, and risk
-> approve execution
-> either:
   - create draft PR
   - mark ticket done, PR handled manually
   - mark ticket done without PR
```

If OpenTop itself creates the draft PR, it closes the ticket until someone explicitly reopens it.

## Provider Checks

OpenTop now inspects configured providers before you rely on them operationally:

```bash
opentop providers doctor
opentop providers setup
```

The Web settings page also shows provider command availability, routed model tiers, compatibility warnings, and GitHub handoff status. It can tell you whether OpenTop is using `GITHUB_TOKEN`, `GH_TOKEN`, or a local `gh` CLI session for PR work.

Providers now separate:

```text
provider type
+ connection method
+ model tier mapping
```

OpenTop is provider-neutral. `codex-cli` is the preferred runtime path for ChatGPT/Codex subscription access today, but it is still just one provider adapter. API-backed providers, local CLIs, local model servers, and custom commands should all fit behind the same provider boundary.

Project config should store only non-secret provider metadata such as provider type, connection method, base URL, and model routing. API keys, OAuth tokens, refresh tokens, and user-specific credentials belong in environment variables, user scope, or a secret store.

API-key provider runtimes are the first durable hosted-provider target. OpenTop includes an OpenAI-compatible API-key runtime baseline for providers such as OpenAI, DeepSeek, and OpenRouter. OpenTop also supports real PKCE-based OAuth connect flows for `openrouter-api` and `openai-codex`, with credentials stored in `~/.opentop/auth/` instead of project config. Today, `openrouter-api` is a supported hosted OAuth runtime path, while `openai-codex` is intentionally treated as a connected-but-non-runtime path until OpenTop grows a more native Codex integration. Providers that do not yet have a real OAuth path are shown as unsupported rather than half-implemented.

## GitHub Handoff

OpenTop can hand an approved execution off to GitHub in three ways:

- create a draft PR from the execution page
- mark the ticket done and handle the PR manually
- mark the ticket done without a PR

For GitHub connectivity, OpenTop currently uses one of:

- `GITHUB_TOKEN`
- `GH_TOKEN`
- a locally authenticated `gh` CLI session

There is no separate in-product GitHub OAuth button yet. OpenTop detects the available GitHub auth path automatically and shows it in Settings.

Example project config:

```yaml
providers:
  codex:
    type: codex-cli
    connection:
      method: local_cli
      command: codex

  openai:
    type: openai-api
    connection:
      method: api_key
      apiKeyEnv: OPENAI_API_KEY

  deepseek:
    type: deepseek-api
    connection:
      method: api_key
      apiKeyEnv: DEEPSEEK_API_KEY
```

See [0005: Provider auth and runtime architecture](docs/decisions/0005-provider-auth-and-runtime-architecture.md).
Provider setup examples live in [docs/provider-recipes.md](docs/provider-recipes.md).

## Branch Policy

OpenTop resolves branch behavior from config instead of requiring a flag on every run.

Project-level config in `.opentop/opentop.yml`:

```yaml
execution:
  defaultBranchPolicy: reuse-current
```

Optional user-level default on your machine:

```text
C:\Users\<you>\.opentop\config.yml
```

```yaml
execution:
  defaultBranchPolicy: new
```

Priority:

```text
CLI override
-> project config
-> user config
-> built-in default (reuse-current)
```

`reuse-current` never blindly works on the default branch. If you are on `main`, OpenTop resolves to an isolated execution branch. If the working tree is dirty, `run` is blocked.

You can also inspect and change the setting directly:

```bash
opentop config get execution.defaultBranchPolicy
opentop config set execution.defaultBranchPolicy new --scope project
opentop config set execution.defaultBranchPolicy reuse-current --scope user
```

## Claim

```text
The control plane for agentic software development.
```
