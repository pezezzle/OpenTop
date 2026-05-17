# AI-Assisted Classification And Prompt Refinement

This document describes the intended next step after the current deterministic classification and prompt-building baseline.

The short version:

- OpenTop should keep deterministic guardrails.
- OpenTop should stop relying only on hard-coded keyword heuristics for task understanding.
- OpenTop should add an AI-assisted classification and prompt-refinement layer before prompt review and execution.

## Why This Is Needed

Today OpenTop classifies tickets through deterministic logic in `packages/core/src/classifier.ts`.

That current baseline is useful because it is:

- reproducible
- cheap to run
- easy to debug
- safe as a fallback when no model is available

But it is also limited:

- weak ticket wording produces weak task understanding
- keyword matches are too shallow for real intent
- model and provider choice is only heuristic
- risk and complexity are not semantically understood
- prompt quality depends too heavily on the user writing a good ticket

For the product direction OpenTop wants, deterministic-only classification is not enough.

## Product Goal

OpenTop should treat ticket understanding as a two-layer system:

1. deterministic policy layer
2. AI-assisted interpretation layer

The deterministic layer keeps OpenTop safe and explainable.

The AI-assisted layer makes OpenTop more useful when:

- the user writes an unclear or incomplete ticket
- the task has subtle implementation shape
- the best provider/model choice depends on semantics instead of keywords
- the execution prompt needs to be rewritten into a stronger engineering brief

## Recommended Architecture

### Layer 1: Deterministic Guardrails

This layer stays in OpenTop core and remains authoritative for hard policy.

It should continue to own:

- allowed execution modes
- provider capability constraints
- branch policy behavior
- approval-required safety overrides
- explicit hard-risk escalations
- fallback routing when model assistance is unavailable

Examples:

- if no provider supports local workspace edits, never select a workspace-changing mode
- if a repo policy says approval is mandatory for security work, keep that mandatory
- if a ticket is already closed, do not allow a new execution

### Layer 2: AI-Assisted Ticket Understanding

This new layer should read the user ticket and produce a structured interpretation.

It should help infer:

- normalized task type
- semantic risk assessment
- semantic complexity assessment
- likely affected areas
- confidence
- ambiguity or missing-information flags
- suggested execution mode
- suggested provider characteristics
- suggested model tier

This layer should not directly mutate repository state or launch execution.

It should only produce structured guidance for OpenTop to review and validate.

### Layer 3: AI-Assisted Prompt Refinement

After classification, OpenTop should optionally rewrite the working prompt input.

This is not the same as writing the full final prompt from scratch.

The right job for this layer is:

- turn weak ticket phrasing into a clearer engineering objective
- extract or infer a better target outcome
- identify likely acceptance expectations
- sharpen ambiguous wording
- preserve scope boundaries from the original ticket

This layer should produce a structured refined brief that OpenTop then injects into the controlled prompt template.

## Proposed New Flow

```text
create ticket
-> deterministic precheck
-> ai-assisted classification
-> deterministic policy validation
-> ai-assisted prompt refinement
-> build controlled prompt
-> prompt review
-> execute
```

## New Data Artifacts

OpenTop should store these as first-class artifacts.

### Classification Artifact

A structured stored result from the AI-assisted classification pass.

Suggested fields:

- `taskType`
- `risk`
- `complexity`
- `affectedAreas`
- `suggestedMode`
- `suggestedModelTier`
- `suggestedProviderTraits`
- `confidence`
- `ambiguities`
- `missingInformation`
- `reasoningSummary`
- `sourcePrompt`
- `rawOutput`

### Refined Brief Artifact

A structured stored result from prompt refinement.

Suggested fields:

- `goal`
- `scope`
- `constraints`
- `acceptanceSignals`
- `implementationHints`
- `openQuestions`
- `reasoningSummary`
- `sourcePrompt`
- `rawOutput`

These artifacts should be visible in Web before execution.

## Deterministic Override Rules

AI assistance should not blindly win.

OpenTop should apply deterministic validation after AI output:

- clamp invalid task types to supported enums
- reject execution modes unsupported by the selected provider path
- raise approval when hard repo or product rules demand it
- reject model/provider choices that violate runtime capabilities
- preserve explicit user overrides from config or later UI choices

This means the AI layer suggests, and OpenTop validates.

## UI Changes

The Ticket page should eventually present this in a calmer way than today's raw classification block.

Recommended user-facing sections:

- `Ticket Intent`
- `OpenTop Understanding`
- `Prompt Brief`
- `Why OpenTop Chose This Route`

The first visible layer should show:

- short task summary
- risk level
- confidence
- key ambiguity warnings
- next action

Advanced reasoning stays behind disclosure panels.

## Provider Strategy

OpenTop should not require the same model/provider for every pre-execution AI task.

Recommended default pattern:

- use a cheaper structured-output-capable model for classification and prompt refinement
- use the selected runtime provider/model for the actual implementation run

This separates:

- orchestration intelligence
- implementation execution

That split is important because the best model for understanding a ticket is not always the best model for modifying a repository.

## Fallback Behavior

If AI-assisted classification or refinement is unavailable:

- fall back to the existing deterministic classifier
- fall back to the current direct prompt-builder path
- surface that the ticket was handled with deterministic fallback only

OpenTop should always remain operable without this feature.

## Rollout Plan

### Phase A

Keep the current classifier, but store its output explicitly as the deterministic baseline.

### Phase B

Add an optional AI-assisted classifier pass that runs before execution and stores a structured classification artifact.

### Phase C

Validate AI classification against deterministic policy rules and resolve the final classification.

### Phase D

Add prompt refinement as a structured brief artifact.

### Phase E

Expose both artifacts in Web and allow approve/regenerate behavior before execution.

## Decision

OpenTop should move from:

- deterministic-only classification

to:

- deterministic guardrails
- AI-assisted classification
- AI-assisted prompt refinement
- controlled prompt assembly

The deterministic system remains the safety boundary.

The AI-assisted system becomes the quality boundary.
