# 0001: Web Is The Primary User Interface

## Status

Accepted

## Context

OpenTop needs to show tickets, classifications, prompts, executions, settings, logs, changed files, and future PR links. These are easier to inspect and operate in a browser than in a terminal-only interface.

The CLI remains important, but it should not become the main product surface.

## Decision

The Web UI is the primary OpenTop interface.

The CLI is for:

- setup
- automation
- quick inspection
- power-user commands
- optional terminal app and shell modes

The API is the boundary between Web and core workflows.

## Consequences

New user-facing workflows should land in Web first.

CLI commands should remain scriptable and direct.

The optional terminal dashboard can remain, but it should not drive product architecture.

