# Security Policy

OpenTop is early-stage software that can execute code, manage branches, and store local auth state. Treat that surface with care.

## Supported Secrets Boundary

OpenTop project config must not contain secrets.

Safe locations:

- environment variables such as `OPENAI_API_KEY`
- user-scoped OpenTop auth storage under `~/.opentop/auth/`
- local OS-backed secret stores in future integrations

Unsafe locations:

- `.opentop/opentop.yml`
- committed repository files
- screenshots or copied logs that expose tokens

## Reporting A Vulnerability

Until a dedicated security contact exists, do not file exploitable details in a public issue.

Instead:

1. Reproduce the issue locally.
2. Capture the affected version, setup, and impact.
3. Share the report privately with the maintainer channel you already use for this project.
4. Wait for a coordinated fix before public disclosure.

## Local Safety Expectations

- Review provider setup before first use.
- Prefer isolated branches or worktrees for code-changing runs.
- Review diffs, checks, and PR bodies before merging.
- Rotate any leaked API keys immediately.
- Delete `~/.opentop/auth/` entries for providers you no longer trust.
