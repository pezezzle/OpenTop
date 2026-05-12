# Contributing to OpenTop

OpenTop is early-stage. Contributions should keep the `0.1` goal focused: local ticket orchestration, transparent routing, controlled execution, and reviewable output.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
```

## Principles

- Keep routing explainable before adding AI-assisted behavior.
- Keep provider adapters behind stable interfaces.
- Prefer small, reviewable changes.
- Do not add SaaS, billing, or multi-user complexity to the MVP.
- Preserve branch isolation and human approval as default safety assumptions.
