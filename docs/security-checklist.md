# Security Checklist

Use this checklist before releases and before widening access to new users.

## Secrets

- [ ] No API keys or OAuth tokens are written to `.opentop/opentop.yml`.
- [ ] User-scoped OAuth credentials stay under `~/.opentop/auth/`.
- [ ] Logs and screenshots used in docs or issues do not expose tokens.

## Provider Safety

- [ ] Unsupported OAuth providers are shown as unsupported, not connected.
- [ ] Provider diagnostics explain missing auth clearly.
- [ ] Hosted API providers do not claim to have changed local files when they only returned text.

## Git Safety

- [ ] Branch and worktree creation never silently reuses a dirty workspace when policy blocks it.
- [ ] Draft PR creation requires reviewed executions.
- [ ] Pull-request creation fails clearly when `origin` or GitHub auth is missing.

## Review Safety

- [ ] Prompt review is enforced for approval-required work.
- [ ] Plan review is enforced before plan-first implementation.
- [ ] Execution review is enforced for workspace-changing runs.

## Local Runtime

- [ ] `.opentop/state/` stays ignored by Git.
- [ ] Sandbox and example configs use placeholder secrets only.
- [ ] CI runs `pnpm verify`.
