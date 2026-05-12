# OpenTop Glossary

## Agent Profile

A named execution role that defines model tier, execution mode, approval requirements, and allowed commands.

## Classification

The structured assessment of a ticket, including risk, complexity, affected areas, suggested profile, suggested model tier, execution mode, and reason.

## Control Plane

The layer that decides how agentic work should be routed, constrained, executed, and reviewed.

## Execution

A controlled run of an agent against a ticket.

## Execution Mode

The behavior requested from an agent, such as `plan_only`, `implement_and_test`, or `review_only`.

## Model Router

The component that maps ticket risk and routing rules to a model tier.

## Prompt Builder

The component that turns ticket content, classification, project context, rules, and profile data into a controlled agent prompt.

## Ticket Repository

The storage abstraction for normalized tickets.
