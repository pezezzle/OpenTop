# Database Migrations

OpenTop stores local state in `.opentop/state/opentop.db`.

## Strategy

The current migration model is intentionally lightweight:

- schema bootstrap creates the latest known tables
- `opentop_meta.schema_version` records the latest applied migration number
- idempotent migration helpers add newer columns for older local databases

This keeps local development upgrades simple without requiring an external migration runner.

## Current Schema Version

Current version: `3`

Version history:

1. execution artifact and worker-run columns
2. review, diff, risk, and pull-request metadata columns
3. worker-plan integration summary column

## Contributor Rules

- Never remove old columns in a migration pass.
- Prefer additive schema changes.
- Update the migration version and tests together.
- Verify an older database still opens and upgrades automatically.
