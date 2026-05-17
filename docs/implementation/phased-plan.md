# OpenTop Implementation Phased Plan

This plan describes the implementation path from the current local MVP toward the intended OpenTop product: a provider-neutral control plane that turns human software tickets into reviewed, policy-aware AI development runs.

The plan is intentionally phased. Each phase should leave the product in a coherent state and should avoid building later orchestration features on weak provider, auth, or review foundations.

## Guiding Principles

- OpenTop is a control plane, not a wrapper around one coding agent.
- Codex CLI is a supported external CLI adapter, not the product foundation.
- Provider APIs, external CLIs, local model servers, and custom commands must fit behind the same provider boundary.
- Project config may contain non-secret metadata only.
- API keys, OAuth tokens, refresh tokens, and user-specific credentials belong in user scope, environment variables, or a secret store.
- Planner and worker orchestration belongs to OpenTop, not to any single provider.
- Humans should be able to review prompts, plans, outputs, diffs, checks, and pull requests before trusting an execution.

## Phase 1: Provider Foundation

Goal: OpenTop is provider-neutral and can reason about provider capabilities and authentication safely.

Status: Completed.

Scope:

- Finalize provider capability model.
- Keep Codex CLI modeled as an `external_cli` provider.
- Maintain custom shell as a controlled escape hatch.
- Establish the secret resolver boundary.
- Support environment-variable based API-key resolution.
- Harden OpenAI-compatible API-key providers for OpenAI, DeepSeek, and OpenRouter.
- Prepare Anthropic as a first-class API provider with its own adapter.
- Keep OAuth visible as planned or pending until the full connect flow exists.
- Improve provider doctor output around capabilities, auth, model routing, and runtime readiness.

Deliverables:

- Provider capability types.
- Secret resolver interface.
- Runtime factory that selects providers by type, auth method, and capabilities.
- Provider status output that includes capabilities.
- Clear warnings when a provider can be configured but cannot execute yet.

Exit Criteria:

- `opentop providers doctor` reports provider capabilities and auth state.
- API-key providers can run a basic model request.
- Codex CLI remains usable through the same provider boundary.
- OAuth cannot be mistaken for implemented runtime auth.

Completed with:

- provider capability types covering auth method, structured output, local workspace support, and multi-run suitability
- secret resolver boundary for environment-based API-key providers
- runtime selection across provider type, connection method, and capability requirements
- `codex-cli` kept as a first-class `external_cli` provider path inside the shared provider boundary
- OpenAI-compatible API-key runtime baseline for OpenAI, DeepSeek, and OpenRouter-style providers
- provider doctor reporting for capabilities, connection state, model-tier routing, readiness, and compatibility warnings
- explicit connected-but-non-runtime handling for provider paths such as `openai-codex` when auth exists but durable runtime support does not

## Phase 2: API Provider Review Output

Goal: API providers return reviewable artifacts instead of pretending they changed local files.

Status: Completed.

Scope:

- Extend execution artifacts to store provider output separately from changed files.
- Store API-model responses as plan, patch proposal, review output, or raw model output.
- Add explicit execution states or metadata for output-only provider runs.
- Add Web views for provider output artifacts.
- Show clearly whether files were changed locally.
- Avoid marking an execution as code-changing when it only produced text.

Deliverables:

- Execution output artifact model.
- API output renderer in Web.
- CLI output summary for API-provider runs.
- Clear status language for output-only executions.

Exit Criteria:

- API-provider runs are useful without local patch application.
- Users can review the generated output in Web.
- Changed files remain empty unless the workspace actually changed.

Completed with:

- execution artifact storage for review-oriented output
- `output_ready` status for output-only successful runs
- Web review rendering for plan, patch proposal, review note, and general output
- CLI summaries for review output, referenced files, and next-step hints
- explicit follow-up execution entry points from review-output screens
- runtime tests for Phase 2 core and provider behavior

## Phase 3: Ticket Analysis And Routing

Goal: OpenTop makes better decisions about profile, model, approval, and execution mode before running a provider.

Status: Completed.

Scope:

- Expand classification beyond simple labels and keywords.
- Add task categories such as bugfix, small change, feature, architecture, refactor, test, docs, security, and migration.
- Improve risk and complexity scoring.
- Improve affected-area detection.
- Make routing provider-aware and capability-aware.
- Add clearer classifier explanations.
- Prepare optional AI-assisted classification while keeping deterministic fallbacks.

Deliverables:

- Expanded classification schema.
- Improved routing rules.
- Provider-aware model-tier selection.
- Classifier explanation output.

Exit Criteria:

- Small fixes, feature work, architecture work, and risky changes route differently.
- Model choice is explainable.
- Approval requirement is explainable.

Completed with:

- expanded task categories across bugfix, small change, feature, architecture, refactor, test, docs, security, migration, and integration
- richer risk and complexity scoring based on detected task signals and affected areas
- routing rules that can match task type, risk, complexity, affected areas, labels, and keywords
- provider-aware model selection that weighs local-workspace support and structured-output capability
- clearer classification explanations including detected signals, suggested provider, and suggested model
- runtime tests for classifier behavior and execution-plan routing

## Phase 4: Project And User Context

Goal: Prompts reflect project rules and user or team preferences without becoming uncontrolled context dumps.

Status: Completed.

Scope:

- Strengthen `.opentop/project-context.md` usage.
- Structure `.opentop/rules.md` into actionable prompt rules.
- Model user and team preferences for code style, design style, modeling choices, test depth, and review strictness.
- Add context priority and prompt budget behavior.
- Support learned profiles from existing repositories.
- Add Web settings for context profiles.

Deliverables:

- Context profile data model.
- User/team preference format.
- Prompt budget rules.
- Context preview in Web.

Exit Criteria:

- Generated prompts include project and user preferences intentionally.
- Users can see which context sources influenced a prompt.
- Prompt size remains controlled.

Completed with:

- resolved context settings for learned profiles, user profiles, profile mode, and prompt budget
- filesystem-backed learned and user profile loading from `~/.opentop/profiles/*` and `~/.opentop/user-profiles/*`
- prompt-context selection that picks relevant profile sections by task and affected areas
- prompt-budget enforcement by section count and word count
- prompt context summaries with influences, included sections, skipped sections, and budget usage
- Web settings support for context profile IDs, profile mode, scope, and prompt budget
- runtime tests for prompt-context inclusion behavior

## Phase 5: Prompt Review Workflow

Goal: Humans can review and approve the generated prompt before execution.

Status: Completed.

Scope:

- Make prompt preview a first-class workflow step.
- Add approval gates for risky tickets.
- Add approve, reject, and regenerate prompt actions.
- Store prompt snapshots and versions.
- Show differences between prompt versions.
- Connect approval status to execution start.

Deliverables:

- Prompt review state model.
- Web approval actions.
- Prompt snapshot versioning.
- Prompt diff view.

Exit Criteria:

- Risky work cannot start without approval.
- Users can inspect exactly what will be sent to a provider.
- Prompt history is preserved.

Completed with:

- prompt review versioning and state storage for `draft`, `approved`, `rejected`, and `superseded`
- execution gating that blocks approval-required tickets until the latest prompt version is approved
- explicit reject and regenerate flows that preserve prompt history
- Web actions for approve, reject, and regenerate directly from ticket detail
- prompt-review notices, version history, and prompt diff rendering in the Web UI
- API routes for reading prompt review state and mutating the latest prompt version
- core runtime tests covering approved, draft-blocked, and rejected-blocked prompt review behavior

## Phase 6: Plan-First Feature Execution

Goal: Large features generate a reviewed plan before implementation starts.

Status: Completed.

Scope:

- Formalize `plan_only` and `plan_then_implement` behavior.
- Require structured planner output.
- Store plan artifacts.
- Add Web review for plans.
- Allow plan approval, rejection, and regeneration.
- Use approved plans as input for worker planning.

Deliverables:

- Plan artifact model.
- Structured planner prompt and parser.
- Plan review UI.
- Plan approval workflow.

Exit Criteria:

- Large feature tickets produce a plan before code execution.
- Users can approve or revise the plan.
- Approved plans can drive later work items.

Completed with:

- versioned plan artifacts with `draft`, `approved`, `rejected`, and `superseded` review states
- structured plan parsing into summary, implementation steps, risks, open questions, and work items
- `plan_then_implement` runtime behavior that generates a plan first and blocks implementation until the latest plan is approved
- explicit plan approval, rejection, and regeneration routes in the API and Web actions
- plan review, plan history, and plan diff sections in ticket detail
- approved plan context fed back into the implementation prompt after plan approval
- core runtime tests covering plan generation and plan-review blocking behavior

## Phase 7: Worker Plan Data Model

Goal: OpenTop can split an approved feature plan into controlled work items.

Status: Completed.

Scope:

- Add WorkerPlan and WorkItem data models.
- Track dependencies between work items.
- Assign role, provider, model tier, and execution mode per work item.
- Represent backend, frontend, test, docs, and reviewer workers.
- Define branch or worktree strategy per work item.
- Add work item statuses.

Deliverables:

- Worker plan schema.
- Work item repository.
- Web view for worker plans.
- CLI inspection commands.

Exit Criteria:

- One feature ticket can own multiple planned work items.
- Each work item has routing, status, and review metadata.
- Work items can be executed independently later.

Completed with:

- versioned `WorkerPlan` and `WorkItem` data models persisted in SQLite
- dependency-aware worker-plan derivation from the latest approved plan artifact
- per-work-item role, provider, model tier, execution mode, branch strategy, and review-note metadata
- API routes for reading the latest worker plan, listing work items, generating a new worker-plan version, and fetching one work item
- ticket-detail Web UI for worker-plan generation, worker-plan history, and work-item inspection
- CLI inspection commands for worker plans and work items
- core runtime tests covering worker-plan generation from an approved plan

## Phase 8: Multi-Run Execution

Goal: OpenTop can orchestrate several provider runs for one ticket or feature plan.

Status: Completed.

Scope:

- Support multiple executions per ticket, plan, and work item.
- Run work items sequentially first.
- Prepare for safe parallel execution later.
- Add Git worktree or isolated-branch strategy.
- Capture logs per worker.
- Capture summaries across workers.
- Add conflict detection and integration strategy.
- Run checks after integration.

Deliverables:

- Multi-run orchestration service.
- Work item execution service.
- Per-worker logs and summaries.
- Integration status.

Exit Criteria:

- A feature can execute through multiple coordinated work items.
- Each run remains traceable and reviewable.
- Integration failures are visible and recoverable.

Completed with:

- execution linkage from work items to stored executions through `workerPlanId`, `workItemId`, `runKind`, and `workspacePath`
- sequential worker-plan orchestration in core with explicit work-item execution and dependency unblocking
- isolated branch worktrees for work items plus shared/reused branch routing where dependencies continue in the same workspace
- worker-plan status progression through `ready`, `running`, `integration_ready`, and `failed`
- integration summaries and conflict warnings derived from per-work-item changed files and branch strategy
- API routes for running an entire worker plan or a single work item
- Web ticket detail actions for running worker plans and individual ready work items
- CLI commands for `worker-plans run` and `work-items run`
- runtime tests covering sequential worker-plan execution and dependency release

## Phase 9: Checks, Diff, And Review

Goal: Users can evaluate what changed and whether it is safe.

Status: Completed.

Scope:

- Run configured build and test commands.
- Store check results.
- Capture real changed files.
- Generate diff summaries.
- Add Web diff review.
- Add risk summary after execution.
- Add needs-review status.
- Support approve/reject changes.

Deliverables:

- Check result model.
- Changed-file and diff capture.
- Web diff view.
- Review status workflow.

Exit Criteria:

- Users can review code changes, checks, logs, and risk summaries.
- OpenTop distinguishes successful execution from approved changes.
- Failed checks block PR creation unless explicitly overridden.

Completed with:

- persisted execution review fields for review status, reviewer metadata, diff summary, and risk summary
- persisted check-run records per execution with command, status, exit code, and captured output
- post-run build/test command execution for successful workspace-changing runs
- diff capture with per-file change type, line counts, and patch previews
- risk summaries that combine classification, failed checks, diff size, and sensitive file changes
- execution review approval and rejection routes with explicit failed-check override support
- Web execution detail sections for checks, risk, diff review, and review decision actions
- workflow-stage behavior that only moves reviewed executions to `Done`
- core runtime tests for output-only runs, workspace-changing runs, and review-oriented execution metadata

## Phase 10: Pull Request Flow

Goal: Reviewed changes can become a draft pull request.

Status: Completed.

Scope:

- Create GitHub draft pull requests.
- Use `.opentop/templates/pull-request.md`.
- Include execution summary in PR body.
- Include checks, logs, changed files, and risk summary.
- Store pull request URL.
- Link PRs back to tickets and executions.
- Prepare later GitHub issue import and sync.

Deliverables:

- Draft PR creation service.
- PR template renderer.
- PR metadata storage.
- Web PR output panel.

Exit Criteria:

- OpenTop can create a draft PR after review.
- The PR contains enough context for a human reviewer.
- The execution record links to the PR.

Completed with:

- core pull-request drafting service that validates review approval and check status before PR creation
- PR body rendering from `.opentop/templates/pull-request.md` with ticket, classification, checks, changed-file, and risk sections
- GitHub draft-PR creation through the local API using `GITHUB_TOKEN`, `GH_TOKEN`, or an authenticated local `gh` CLI session
- automatic branch push to `origin` before draft-PR creation
- persisted pull-request metadata on executions, including URL, title, body, base/head branch, repository, and draft state
- API route for creating draft PRs from approved executions
- Web execution detail panel for creating, opening, and advancing draft PRs
- ticket-detail visibility for the latest draft PR link and ticket auto-close after OpenTop-created draft PR handoff
- core runtime tests for PR rendering and execution metadata updates

## Phase 11: OAuth And User Secrets

Goal: Users can connect hosted providers through real OAuth without storing secrets in project config.

Status: Completed.

Scope:

- Implement OAuth connect flow.
- Add local callback handling.
- Store tokens in user scope or secret store.
- Refresh tokens safely.
- Revoke provider connections.
- Add Web connect/disconnect UI.
- Prepare multi-user ownership boundaries.

Deliverables:

- OAuth provider registry.
- Token storage abstraction.
- Connect callback route.
- Provider connection UI.

Exit Criteria:

- OAuth providers can be connected and disconnected.
- Tokens do not enter project config.
- Expired tokens can be refreshed or surfaced clearly.

Completed with:

- repository-scoped user auth storage under `~/.opentop/auth/` instead of project config
- real PKCE-based OpenRouter OAuth connect flow with callback handling through the local Web UI
- OAuth exchange and disconnect endpoints in the local API
- runtime adapter support for OAuth-backed `openrouter-api` providers
- provider inspection and Web/CLI status output that shows connected, disconnected, expired, or unsupported OAuth state
- Web settings actions for connect and disconnect
- provider tests covering OAuth start, exchange, disconnect, and unsupported-provider inspection

## Phase 12: Product Hardening

Goal: OpenTop becomes installable, testable, documented, and safe enough for broader open-source use.

Status: Completed.

Scope:

- Add unit and integration tests for core, providers, Git, and DB.
- Add database migrations.
- Improve error states and recovery.
- Harden installation paths.
- Maintain a representative sandbox project.
- Add recipes for common provider setups.
- Add release process.
- Add security review checklist.

Deliverables:

- Test suite.
- Migration strategy.
- Release documentation.
- Security guidance.
- Provider setup recipes.

Exit Criteria:

- A new contributor can install, configure, test, and run OpenTop.
- Provider setup is documented and diagnosable.
- Core flows are covered by automated tests.

Completed with:

- package-level automated tests for providers, core, git, and db
- schema-versioned local database migrations recorded in `opentop_meta`
- Fastify API error responses that surface actionable JSON errors instead of generic failures
- cross-platform `pnpm cli:link` and root `pnpm verify`
- in-repo sandbox example under `examples/sandbox/`
- provider setup recipes for Codex CLI, OpenAI, OpenRouter OAuth, DeepSeek, and Anthropic
- CI workflow, release checklist, and security checklist

## Suggested Working Order

Phases 1 through 12 now provide the provider boundary, review flows, plan-first behavior, worker orchestration, OAuth-backed hosted providers, and the product hardening needed for broader open-source contribution.

## Current Priorities After Phase 12

The phased foundation is now in place. The most important follow-on work is:

- import real GitHub Issues into the local store
- deepen GitHub sync so board and ticket states reflect merge and closure signals more directly
- expand hosted-provider execution beyond review output into safer local patch/application workflows
- add runtime adapters for additional local-model and hosted providers
- add an optional AI-assisted classifier pass on top of the deterministic baseline
- expand worker execution from sequential slices toward parallel orchestration where safe
- continue Web UX compaction, consistency, and operational clarity
- keep multi-user, cloud workers, and broader ticket-system imports as later platform work rather than immediate local-alpha requirements
