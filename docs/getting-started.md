# Getting Started

## Prerequisites

- Node.js 22 or newer
- pnpm 9 or newer
- Git
- A local repository you want OpenTop to orchestrate

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Check Status

```bash
pnpm --filter @opentop/cli dev -- status
```

## Classify a Ticket

```bash
pnpm --filter @opentop/cli dev -- classify \
  --title "Fix login button layout" \
  --description "The login button is misaligned on mobile" \
  --labels bug
```

## Start the API

```bash
pnpm --filter @opentop/api dev
```

The API listens on port `4317` by default.

## Start the Web UI

```bash
pnpm --filter @opentop/web dev
```

## Configuration

OpenTop reads `.opentop/opentop.yml` from the working directory. The starter config includes provider definitions, model tiers, agent profiles, routing rules, and build/test commands.
