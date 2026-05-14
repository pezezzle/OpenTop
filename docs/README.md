# OpenTop Documentation

This directory contains the working documentation for OpenTop.

## Start Here

- [Overview](overview.md): product idea, positioning, and core concepts.
- [Current State](current-state.md): what is implemented today and what is not.
- [Getting Started](getting-started.md): local setup and first commands.
- [Architecture](architecture.md): target architecture and package boundaries.

## Product Surfaces

- [CLI](cli.md): command-line usage and operator commands.
- [Web UI](web.md): primary user interface and current screens.
- [API](api.md): local HTTP API used by the Web UI.

## Core Concepts

- [Data Model](data-model.md): tickets, classifications, executions, config, and storage.
- [Execution Flow](execution-flow.md): how work moves through OpenTop.
- [Project Context and Memory](opentop-project-context-and-memory.md): `.opentop/` context structure.
- [Agent Profiles](agent-profiles.md): execution profiles and modes.

## Decisions

Architecture decisions are documented as short ADRs in [decisions/](decisions/).

- [0001: Web is the primary user interface](decisions/0001-web-is-primary-ui.md)
- [0002: Core owns business logic](decisions/0002-core-owns-business-logic.md)
- [0003: Branch policy is config driven](decisions/0003-branch-policy-is-config-driven.md)
- [0004: Project context lives in `.opentop/`](decisions/0004-project-context-lives-in-opentop.md)

