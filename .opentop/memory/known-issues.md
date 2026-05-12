# OpenTop Known Issues

## No persistent ticket store yet

The current CLI can classify manually provided ticket input, but `classify <id>` is not yet backed by a local database.

## Execution is not fully implemented yet

The current `run` command prepares a plan but does not yet create a real branch, run a provider, execute checks, or open a draft pull request.

## Project context is not used by real executions yet

The `prompt` CLI command loads `.opentop/project-context.md`, `.opentop/rules.md`, memory files, prompt templates, and the PR template. Real provider executions still need to consume generated prompts.
