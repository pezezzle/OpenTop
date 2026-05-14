# Context Profiles

Context Profiles describe how OpenTop learns and applies project, team, and personal development context when turning tickets into controlled prompts.

This is a core OpenTop concept. The goal is not only to execute tickets, but to execute tickets in a way that fits the target project and, when allowed, the developer or team style.

## Problem

A ticket such as:

```text
Build a customer feedback form.
```

is not enough context for high-quality execution.

The agent also needs to know:

- how forms are usually structured
- how validation should work
- where CSS belongs
- which UI tone is expected
- which architecture rules matter
- which testing style is used
- which existing patterns should be reused
- which personal or team preferences may apply

If the target project already has strong conventions, those conventions must win. If the project is new or thin, OpenTop can use learned profiles as starting context.

## Context Layers

OpenTop should treat context as layered.

Priority order:

```text
1. Ticket Context
2. Project Context
3. Project Memory
4. Selected Learned Profile
5. Selected User Profile
6. OpenTop Defaults
```

Higher layers override lower layers.

That means project rules beat personal taste. Personal style can help when the project has no strong rule yet.

## Layer 1: Ticket Context

Ticket context is the concrete task.

Sources:

- ticket title
- ticket description
- labels
- external source metadata
- classification result
- execution mode

Ticket context always wins because it defines the task being executed.

## Layer 2: Project Context

Project context belongs to the target repository.

Location:

```text
.opentop/
  project-context.md
  rules.md
  ticket-guidelines.md
  memory/
  prompts/
  templates/
```

Project context describes what is true for this specific project.

It should include:

- product purpose
- architecture overview
- important documentation links
- package boundaries
- UI conventions
- testing rules
- commands
- known risks
- agent instructions

Project context should not be overwritten automatically by a user profile.

## Layer 3: Project Memory

Project memory stores compact project-specific facts that should influence future prompts.

Location:

```text
.opentop/memory/
  decisions.md
  conventions.md
  risks.md
  glossary.md
  known-issues.md
```

Project memory is versioned with the project when it contains non-sensitive shared knowledge.

It should stay compact. Large documentation should remain in `docs/` and be referenced from `project-context.md`.

## Layer 4: Selected Learned Profile

A learned profile is derived from one or more existing projects.

Example:

```text
C:\Users\ronny\.opentop\profiles\fmwerkstatt\
  profile.yml
  summary.md
  architecture.md
  ui-patterns.md
  forms.md
  styling.md
  testing.md
  naming.md
  ticket-guidelines.md
  prompt-guidance.md
```

A learned profile captures patterns from real projects.

Examples:

- forms use immediate validation
- pages follow a specific layout pattern
- CSS is organized by feature
- components should stay small and explicit
- tests are required for behavior changes
- certain architectural layers must not be bypassed

Learned profiles are useful when:

- starting a new project
- bootstrapping `.opentop/`
- a project has little documentation yet
- a team wants to reuse conventions from a known codebase

Learned profiles should be applied explicitly through settings.

## Layer 5: Selected User Profile

A user profile captures personal development preferences.

Example:

```text
C:\Users\ronny\.opentop\user-profiles\ronny\
  profile.yml
  developer-style.md
  architecture-preferences.md
  ui-style.md
  forms.md
  styling.md
  testing-preferences.md
  ticket-guidelines.md
  prompt-preferences.md
```

User profiles are useful when:

- creating a new project
- no project-specific convention exists yet
- the developer wants OpenTop to produce prompts in a preferred style

User profiles must not override explicit project rules by default.

## Layer 6: OpenTop Defaults

OpenTop defaults are the fallback behavior shipped with OpenTop.

They should be conservative:

- keep changes small
- prefer explicit tests
- avoid default-branch changes
- include summary, checks, changed files, and risks
- avoid broad refactors unless requested

## Profile File Structure

Both learned profiles and user profiles should use a defined file structure.

### `profile.yml`

Required metadata.

```yaml
id: fmwerkstatt
type: learned-project
displayName: FM Werkstatt
description: Patterns learned from the FM Werkstatt codebase.
version: 1
createdAt: 2026-05-14
updatedAt: 2026-05-14

appliesTo:
  languages:
    - csharp
    - typescript
  frameworks:
    - blazor
    - dotnet

promptBudget:
  maxProfileSections: 4
  maxProfileWords: 900
```

Supported `type` values:

```text
user
learned-project
team
organization
```

### `summary.md`

Short overview of what this profile represents.

This file should be compact enough to include in prompts when useful.

### `developer-style.md`

Personal or team coding style.

Examples:

- prefer small explicit functions
- avoid broad refactors
- keep naming domain-oriented
- preserve existing project architecture

For learned project profiles, this file may be omitted if the profile is not person-specific.

### `architecture.md`

Architecture preferences and constraints.

Examples:

- layer boundaries
- folder conventions
- dependency rules
- service patterns
- data-access patterns

### `ui-style.md`

General UI preferences.

Examples:

- business-focused UI
- compact dashboard layout
- predictable navigation
- restrained colors
- avoid decorative marketing layouts for internal tools

### `forms.md`

Form-specific conventions.

Examples:

- validation strategy
- field layout
- error message behavior
- submit/cancel button placement
- localization rules

### `styling.md`

CSS and styling conventions.

Examples:

- where styles live
- naming conventions
- design tokens
- component-level vs global styles
- responsive behavior expectations

### `testing-preferences.md`

Testing conventions.

Examples:

- when tests are required
- preferred test frameworks
- naming and location of tests
- build/test commands

### `ticket-guidelines.md`

How tickets should be written for this style or project.

Examples:

- required acceptance criteria
- when screenshots are needed
- useful labels
- when a task should be split
- what details are required for UI work

### `prompt-preferences.md`

How OpenTop should shape prompts when this profile is active.

Examples:

- be explicit about affected files
- request tests and risks
- include relevant project docs
- avoid repeating large context blocks

## Project Settings

The active context profiles should be configurable per project.

Recommended project config:

```yaml
context:
  profiles:
    learned:
      - fmwerkstatt
    user:
      - ronny
  profileMode: project-first
  maxPromptProfileWords: 900
```

Supported `profileMode` values:

```text
project-first
profile-first
project-only
profile-only
manual
```

Recommended default:

```text
project-first
```

Meaning:

- project context wins
- profile context fills gaps
- OpenTop defaults fill remaining gaps

`profile-first` should be opt-in and used carefully, because it can push personal style into a project that already has its own conventions.

`project-only` disables user and learned profiles for a project.

`profile-only` is useful for brand-new projects with little or no project context.

`manual` should require explicit selection before prompt generation.

## User Settings

User-wide defaults should live outside the project.

Recommended location:

```text
C:\Users\<user>\.opentop\config.yml
```

Example:

```yaml
context:
  defaultUserProfile: ronny
  defaultLearnedProfiles:
    - fmwerkstatt
  profileMode: project-first
```

Project config should override user config.

## Web Settings

The Web UI should allow users to choose:

- active learned profile
- active user profile
- profile mode
- prompt budget
- whether profile context is enabled

Settings should clearly show the resolved context order.

Example resolved order:

```text
Ticket
Project Context
Project Memory
Learned Profile: fmwerkstatt
User Profile: ronny
OpenTop Defaults
```

## CLI Commands

Future CLI commands should include:

```powershell
opentop analyze project
opentop profile list
opentop profile show fmwerkstatt
opentop profile learn --repo C:\Projects\FMwerkstatt --name fmwerkstatt
opentop profile apply fmwerkstatt
opentop profile set-user ronny
opentop context status
```

`opentop init` should stay simple and create baseline config.

Project analysis and profile learning should be explicit commands.

## Prompt Budget

Context profiles can become large. OpenTop must not blindly include every context file in every prompt.

Prompt construction should:

- classify the ticket first
- detect affected areas
- select only relevant profile sections
- prefer compact summaries
- include file references instead of full long docs when possible
- cap profile context by word or token budget
- include a source list for transparency

Example for a form ticket:

```text
Ticket: Build a customer feedback form.
Affected areas: frontend, forms
Selected context:
- project-context.md summary
- rules.md safety rules
- active profile forms.md
- active profile ui-style.md
- active profile testing-preferences.md
Skipped context:
- architecture.md
- deployment.md
- backend-data-access.md
```

## Conflict Resolution

When context conflicts, OpenTop should resolve in this order:

```text
ticket instruction
project rule
project memory
selected learned profile
selected user profile
OpenTop default
```

If a conflict is risky, the generated prompt should surface it:

```text
Context conflict:
Project says use existing form components.
User profile suggests custom form controls.
Follow project rule.
```

## Safety Rules

Profiles must not store:

- API keys
- passwords
- customer secrets
- private customer data
- production credentials
- exploit details

OpenTop should support private ignored profile files, but generated prompts should still avoid leaking sensitive data.

## Future Analyzer

Project and profile analysis should eventually use AI, but the result must be reviewable.

Recommended flow:

```text
scan repository
-> summarize structure and conventions
-> propose profile files
-> show diff
-> human approves
-> write profile
```

For existing projects:

```powershell
opentop analyze project
```

For learning from another project:

```powershell
opentop profile learn --repo C:\Projects\FMwerkstatt --name fmwerkstatt
```

For new projects:

```powershell
opentop profile apply fmwerkstatt
```

## Example

Ticket:

```text
Build a customer feedback form.
```

If the project has no form conventions yet and `fmwerkstatt` is active, OpenTop can produce a prompt that includes:

- form layout expectations
- validation behavior
- CSS organization
- test expectations
- response format

If the project later defines its own form conventions in `.opentop/rules.md`, those project rules take precedence over the learned profile.

