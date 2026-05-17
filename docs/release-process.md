# Release Process

This is the lightweight release checklist for OpenTop while it is still pre-1.0.

## Before Tagging

Run:

```bash
pnpm install
pnpm verify
```

Then manually sanity-check:

1. `opentop providers doctor`
2. `opentop dashboard` against the sandbox repo
3. one prompt-review flow
4. one plan-first flow
5. one worker-plan run
6. one execution review and draft PR flow

## Version Bump

1. Update the root version and any package versions you want surfaced publicly.
2. Summarize user-visible changes in release notes.
3. Call out breaking changes or config migrations clearly.

## Release Notes Template

Use this shape:

```text
## Highlights
- ...

## Provider Changes
- ...

## Workflow Changes
- ...

## Docs And Setup
- ...

## Known Limitations
- ...
```

## After Publishing

1. Smoke-test install and `cli:link` on a clean machine.
2. Verify docs links and setup steps.
3. Verify the sandbox example still matches the current config model.
