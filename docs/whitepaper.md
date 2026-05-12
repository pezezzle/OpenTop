# OpenTop Whitepaper

## 1. Problem

AI coding agents can write code, run commands, and prepare changes. The missing layer is orchestration: deciding which ticket should be executed by which agent, with which model, under which approval rules, and with which output requirements.

Most ticket systems are passive. Most agents are powerful but manually driven. OpenTop connects those two worlds.

## 2. Current Gap

Software teams already use GitHub Issues, Linear, Jira, Trello, and similar systems to describe work. AI coding tools usually start after a human has manually interpreted the ticket, selected a tool, chosen a model, decided the risk level, created a branch, and supervised the run.

That creates four problems:

- Ticket intent is not converted into an executable plan.
- Model choice and agent role are inconsistent.
- Risk and approval rules are informal.
- Output is often not normalized into branches, checks, logs, and pull requests.

## 3. Concept

OpenTop turns tickets into controlled AI executions.

```text
Ticket
-> Classifier
-> Router
-> Agent profile
-> Provider adapter
-> Branch
-> Build / test
-> Draft PR
-> Human review
```

OpenTop is not intended to be another coding agent. It is a control plane that sits between ticket systems and AI coding agents.

## 4. Architecture

The platform is built around five core parts:

- **Ticket import:** Normalizes manual tickets and external issues into a common domain model.
- **Classifier:** Determines task type, risk, complexity, affected areas, suggested profile, model tier, and execution mode.
- **Model router:** Maps risk, labels, keywords, and project rules to the appropriate model tier.
- **Execution engine:** Creates branches, invokes provider adapters, captures logs, runs checks, and prepares review output.
- **Provider adapters:** Connect OpenTop to Codex CLI, OpenAI API, Claude Code, Anthropic API, OpenRouter, Ollama, or custom shell commands.

## 5. Safety Model

The default OpenTop workflow is conservative:

- Work happens in a separate branch.
- High-risk work requires approval.
- Agent profiles define allowed commands.
- Logs and changed files are captured.
- Output is reviewed through a draft pull request.
- Direct pushes to the default branch are out of scope for the MVP.

## 6. Open Ecosystem

OpenTop is provider-independent by design. Teams should be able to use API-based providers, locally authenticated CLIs, hosted model routers, or local models.

The same ticket should be routable to different execution backends without changing the ticket workflow.

## 7. Vision

AI agents write code. OpenTop decides which agent should write which code, under which rules, with which model, and with which approval level.

OpenTop introduces a control-plane approach to agentic software development.
