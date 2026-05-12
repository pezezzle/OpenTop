# OpenTop Known Issues

## Execution store is not implemented yet

Tickets are now stored locally in SQLite, but execution records and prompt history are not persisted yet.

## Execution is not fully implemented yet

The current `run` command prepares a plan but does not yet create a real branch, run a provider, execute checks, or open a draft pull request.

## Project context is not used by real executions yet

The `prompt` CLI command loads `.opentop/project-context.md`, `.opentop/rules.md`, memory files, prompt templates, and the PR template. Real provider executions still need to consume generated prompts.
