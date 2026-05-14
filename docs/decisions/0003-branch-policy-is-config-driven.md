# 0003: Branch Policy Is Config Driven

## Status

Accepted

## Context

OpenTop should not always force a new branch. Users may already be working in a feature branch and may want an execution to reuse it.

At the same time, OpenTop should avoid unsafe default-branch writes.

## Decision

Branch behavior is controlled by `execution.defaultBranchPolicy`.

Supported policies:

```text
new
reuse-current
manual
none
```

Resolution order:

```text
CLI override
-> project config
-> user config
-> built-in default
```

Project config lives in:

```text
.opentop/opentop.yml
```

User config lives in:

```text
C:\Users\<user>\.opentop\config.yml
```

## Consequences

Users can set a default once instead of passing a flag every time.

`reuse-current` must still protect the default branch.

Dirty working trees block execution planning.

