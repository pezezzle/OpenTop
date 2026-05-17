# Web UI Architecture

This document defines the intended product and technical structure for the OpenTop Web UI.

It exists because the current Web surface works functionally, but its file layout and presentation hierarchy are still too ad hoc for long-term product work.

The goal is to make the UI:

- easier to navigate
- easier to understand at a glance
- easier to extend without growing one huge stylesheet or page file

## Product Principles

OpenTop is an operational tool, not a marketing site and not a raw config editor.

The Web UI should therefore feel:

- dense but readable
- workflow-oriented
- stable from page to page
- explicit about the next action
- sparing with technical detail on the first screen

The first question on every page should be:

```text
What is the current state, and what should I do next?
```

## Information Architecture

OpenTop should expose a stable primary navigation:

- `Board`
- `Tickets`
- `Executions`
- `Settings`

Possible later additions:

- `GitHub`
- `Providers`
- `History`

The important rule is that top-level navigation should represent major user jobs, not implementation details.

## Page Responsibilities

### Board

Purpose:

- global overview
- workflow bottlenecks
- fast entry into active work

Should emphasize:

- work by stage
- review queue
- blocked items
- recent activity

Should not become:

- a second settings screen
- a dumping ground for raw technical metadata

### Ticket Detail

Purpose:

- control center for one ticket

Top section should answer:

- what kind of work is this
- what stage is it in
- what is the next action
- what is the latest execution state

Technical reasoning such as detected signals, route selection, and prompt context should be present but visually secondary.

### Execution Detail

Purpose:

- review and handoff

Top section should answer:

- did this succeed
- what changed
- are checks passing
- what is the current PR state
- what should happen next

Logs, raw prompt snapshots, and low-level metadata belong lower on the page or behind disclosure.

### Settings

Purpose:

- setup and connection management

Should be grouped into clear operational sections:

- general project settings
- providers
- GitHub
- context

It should avoid feeling like a JSON editor with labels.

## Layout System

All primary pages should use the same structural pattern:

1. `PageHeader`
2. `SummaryRow`
3. `PrimaryWorkspace`
4. `SecondaryContext`
5. `AdvancedDetails`

### 1. Page Header

Contains:

- page title
- short subtitle
- primary action
- optional secondary actions

### 2. Summary Row

Contains:

- 3 to 5 compact status cards

Examples:

- stage
- latest execution
- checks
- PR state
- provider readiness

### 3. Primary Workspace

The main working area.

On desktop it should usually be a two-column layout:

- left: primary task content
- right: actions, state, and contextual summaries

### 4. Secondary Context

Useful but not dominant information:

- history
- related executions
- workflow notes

### 5. Advanced Details

Hidden by default or visually downweighted:

- detected signals
- route rationale
- raw prompt snapshots
- logs
- technical payloads

## Component Architecture

The UI should be built from a small shared vocabulary of reusable pieces.

Recommended shared components:

- `PageHeader`
- `SummaryStat`
- `WorkflowStrip`
- `ActionPanel`
- `SectionCard`
- `KeyValueList`
- `InlineNotice`
- `DetailDisclosure`
- `StatusBadge`
- `EmptyState`

Rules:

- do not invent a new visual wrapper for each page
- do not let every page define its own status chip style
- do not encode layout assumptions deep inside page-specific markup

## Technical Structure

The current Web app is still too concentrated in route files plus one large global stylesheet.

The target structure should be:

```text
apps/web/
  app/
    layout.tsx
    page.tsx
    globals.css
    (dashboard)/
      layout.tsx
      page.tsx
      tickets/
        [ticketId]/
          page.tsx
      executions/
        [executionId]/
          page.tsx
      settings/
        page.tsx
        oauth/
          callback/
            page.tsx

  components/
    app-shell/
      AppShell.tsx
      SidebarNav.tsx
      TopBar.tsx
      AppShell.module.css
    primitives/
      Button.tsx
      Card.tsx
      Badge.tsx
      Notice.tsx
      Stack.tsx
      primitives.module.css
    workflow/
      PageHeader.tsx
      SummaryStat.tsx
      WorkflowStrip.tsx
      ActionPanel.tsx
      workflow.module.css

  features/
    board/
      BoardView.tsx
      BoardLane.tsx
      RecentExecutions.tsx
      board.module.css
    tickets/
      TicketHeader.tsx
      TicketSummary.tsx
      TicketResolutionPanel.tsx
      PromptReviewPanel.tsx
      PlanPanel.tsx
      WorkerPlanPanel.tsx
      ticket.module.css
    executions/
      ExecutionHeader.tsx
      ExecutionReviewPanel.tsx
      DiffPanel.tsx
      PullRequestPanel.tsx
      execution.module.css
    settings/
      SettingsSummary.tsx
      ProviderPanel.tsx
      GitHubPanel.tsx
      ContextPanel.tsx
      settings.module.css

  lib/
    opentop-api.ts
    formatters.ts
    view-models.ts
```

This structure separates:

- route entrypoints
- generic UI primitives
- workflow/layout components
- feature-specific components
- API and view-model helpers

## Route File Rules

Route files should stay thin.

Each `page.tsx` should mostly do:

1. fetch data
2. derive page-level state
3. hand off rendering to feature components

Route files should not become the main place where:

- all visual markup lives
- all status wording lives
- all layout choices live

## Styling Strategy

### Use global CSS only for:

- design tokens
- reset/base elements
- typography defaults
- app-shell layout primitives

### Use CSS modules for:

- component styling
- feature-specific layout
- route-specific presentation

That means the current large `apps/web/app/styles.css` should be split over time.

Target CSS layout:

```text
apps/web/app/globals.css
apps/web/app/styles/
  tokens.css
  base.css
  shell.css
components/**/**/*.module.css
features/**/**/*.module.css
```

In practice:

- `globals.css` imports or contains only foundational styles
- components own their local styles through `.module.css`
- page density and arrangement are handled by feature modules, not a global file

## CSS Rules

### Tokens

Keep shared design values in one place:

- colors
- spacing
- radii
- borders
- shadows
- type scale

Tokens should use stable CSS variables such as:

```css
:root {
  --color-text: #17201b;
  --color-muted: #607067;
  --color-surface: #f4f7f1;
  --color-panel: #ffffff;
  --color-accent: #136f63;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --radius-sm: 6px;
  --radius-md: 8px;
}
```

### Density

OpenTop should prefer compact operational density:

- smaller headings on work surfaces
- tighter vertical rhythm
- less oversized card padding
- fewer full-width stacked sections

### Card Usage

Cards should be used for:

- repeated items
- action panels
- focused summaries

They should not be used to wrap every entire page section by default.

## Data and View Models

The Web app already has API types in `lib/opentop-api.ts`. The next step is to add lightweight view-model helpers for presentation logic.

Examples:

- formatting workflow state labels
- deriving page action-center text
- deriving status badges
- hiding low-signal technical text behind advanced disclosures

This logic should live in:

```text
apps/web/lib/view-models.ts
apps/web/lib/formatters.ts
```

instead of being copied in each route.

## Navigation Behavior

The app shell should become stable across all dashboard pages.

Recommended behavior:

- persistent left navigation on desktop
- compact header on mobile
- active route highlighted
- current repository/project visible in the shell

The user should always know:

- where they are
- what area they are in
- what the main next step is

## Disclosure Strategy

Not all information is equally important.

The first visible layer should contain:

- state
- next action
- primary artifact

The second layer should contain:

- summary context
- recent history
- related metadata

The third layer should contain:

- raw technical details
- logs
- route reasoning
- snapshots

This is especially important for:

- classification details
- provider diagnostics
- prompt sources
- raw API or GitHub status text

## Migration Plan

The recommended implementation order is:

1. Introduce `globals.css` plus token/base split.
2. Add a stable app shell with primary navigation.
3. Extract shared workflow components.
4. Refactor the ticket page into feature components.
5. Refactor the execution page into feature components.
6. Refactor board and settings to the same component system.
7. Shrink `app/styles.css` until it becomes only shell/base styling or disappears entirely.

## Non-Goals

This structure is intentionally not aiming for:

- a generic design system package
- a marketing-site component library
- heavy client-state architecture
- arbitrary theme customization before the workflow hierarchy is correct

The first priority is clarity, consistency, and a sane codebase shape.
