# OpenTop Known Issues

## Execution is not fully implemented yet

The current `run` command stores a planned execution with prompt and classification snapshots, but it does not yet create a real branch, run a provider, execute checks, or open a draft pull request.

## Project context is not used by real executions yet

The stored planned execution includes the generated prompt snapshot. Real provider executions still need to consume that snapshot as part of live execution.
