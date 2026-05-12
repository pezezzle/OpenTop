# Agent Profiles

Agent profiles define how OpenTop should execute a classified ticket.

## Built-in Starter Profiles

### bugfix

Used for small isolated bug fixes.

```yaml
modelTier: cheap
mode: implement_and_test
requiresApproval: false
```

### feature

Used for standard feature work.

```yaml
modelTier: strong
mode: plan_then_implement
requiresApproval: true
```

### architecture

Used for high-risk architectural work.

```yaml
modelTier: strong
mode: plan_only
requiresApproval: true
```

## Command Allowlist

Each profile can define allowed commands. These commands are part of the safety model and should stay explicit.

```yaml
allowedCommands:
  - pnpm test
  - pnpm build
```

Version `0.1` stores the allowlist in config. Later versions can enforce it through a stricter execution sandbox.
