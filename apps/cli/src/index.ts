#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { Command } from "commander";
import {
  buildAgentPrompt,
  buildPromptForStoredTicket,
  classifyStoredTicket,
  createTicket,
  createExecutionPlan,
  listTickets,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  planExecutionForStoredTicket,
  type Ticket
} from "@opentop/core";
import { createSqliteTicketRepository } from "@opentop/db";
import { getRepositoryStatus } from "@opentop/git";

const program = new Command();

program
  .name("opentop")
  .description("Open Ticket Orchestrator Platform CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Create a starter .opentop/opentop.yml config")
  .action(async () => {
    const starterConfig = `project:
  name: OpenTop
  defaultBranch: main

providers:
  codex:
    type: codex-cli
    command: codex

models:
  cheap:
    provider: codex
    model: gpt-5.3

agentProfiles:
  bugfix:
    description: Small isolated bug fixes
    modelTier: cheap
    mode: implement_and_test
    requiresApproval: false
    allowedCommands:
      - pnpm test

routing:
  rules:
    - when:
        labels:
          - bug
      profile: bugfix
    - default:
        profile: bugfix

commands:
  test: pnpm test
`;

    await mkdir(".opentop", { recursive: true });
    await writeFile(".opentop/opentop.yml", starterConfig, { flag: "wx" });
    console.log("Created .opentop/opentop.yml");
  });

program
  .command("status")
  .description("Show repository and OpenTop config status")
  .action(async () => {
    const [config, repositoryStatus, ticketRepository] = await Promise.all([
      loadOpenTopConfig(),
      getRepositoryStatus(),
      createSqliteTicketRepository()
    ]);
    const tickets = await listTickets(ticketRepository);

    console.log(`Project: ${config.project.name}`);
    console.log(`Default branch: ${config.project.defaultBranch}`);
    console.log(`Current branch: ${repositoryStatus.currentBranch}`);
    console.log(`Working tree: ${repositoryStatus.isClean ? "clean" : "dirty"}`);
    console.log(`Stored tickets: ${tickets.length}`);
  });

const ticketsCommand = program.command("tickets").description("Manage locally stored OpenTop tickets");

ticketsCommand
  .command("create")
  .description("Create a local ticket in the OpenTop SQLite store")
  .requiredOption("--title <title>", "Ticket title")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .option("--source <source>", "Ticket source", "manual")
  .option("--external-id <externalId>", "External ticket ID")
  .option("--json", "Print the created ticket as JSON")
  .action(
    async (options: {
      title: string;
      description: string;
      labels: string;
      source: Ticket["source"];
      externalId?: string;
      json?: boolean;
    }) => {
      const repository = await createSqliteTicketRepository();
      const ticket = await createTicket(repository, {
        source: options.source,
        externalId: options.externalId,
        title: options.title,
        description: options.description,
        labels: parseLabels(options.labels)
      });

      if (options.json) {
        console.log(JSON.stringify(ticket, null, 2));
        return;
      }

      console.log(`Created ticket ${ticket.id}: ${ticket.title}`);
    }
  );

ticketsCommand
  .command("list")
  .description("List locally stored OpenTop tickets")
  .option("--json", "Print stored tickets as JSON")
  .action(async (options: { json?: boolean }) => {
    const repository = await createSqliteTicketRepository();
    const tickets = await listTickets(repository);

    if (options.json) {
      console.log(JSON.stringify(tickets, null, 2));
      return;
    }

    if (tickets.length === 0) {
      console.log("No local tickets found.");
      return;
    }

    for (const ticket of tickets) {
      console.log(`#${ticket.id} [${ticket.status}] ${ticket.title}`);
    }
  });

program
  .command("classify")
  .description("Classify a stored ticket by ID or manual command-line input")
  .argument("[ticketId]", "Stored ticket ID")
  .option("--title <title>", "Ticket title", "Untitled ticket")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .action(async (ticketId: string | undefined, options: { title: string; description: string; labels: string }) => {
    const config = await loadOpenTopConfig();

    if (ticketId) {
      const repository = await createSqliteTicketRepository();
      const result = await classifyStoredTicket(repository, config, ticketId);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const ticket = createManualTicket(options.title, options.description, options.labels);
    const plan = createExecutionPlan(ticket, config);
    console.log(JSON.stringify({ classification: plan.classification, executionPlan: plan }, null, 2));
  });

program
  .command("prompt")
  .description("Build a controlled agent prompt from a stored ticket ID or manual command-line input")
  .argument("[ticketId]", "Stored ticket ID")
  .option("--title <title>", "Ticket title", "Untitled ticket")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .option("--json", "Print prompt metadata as JSON")
  .action(
    async (
      ticketId: string | undefined,
      options: { title: string; description: string; labels: string; json?: boolean }
    ) => {
    const [config, projectContext] = await Promise.all([loadOpenTopConfig(), loadOpenTopProjectContext()]);

      const builtPrompt = ticketId
        ? await buildPromptForStoredTicket(await createSqliteTicketRepository(), config, projectContext, ticketId)
        : buildAgentPrompt({
            ticket: createManualTicket(options.title, options.description, options.labels),
            config,
            projectContext
          });

      if (options.json) {
        console.log(JSON.stringify(builtPrompt, null, 2));
        return;
      }

      console.log(builtPrompt.prompt);
    }
  );

program
  .command("run")
  .description("Prepare an execution plan for a ticket")
  .argument("<ticketId>", "Ticket ID")
  .action(async (ticketId: string) => {
    const [config, repository] = await Promise.all([loadOpenTopConfig(), createSqliteTicketRepository()]);
    const plan = await planExecutionForStoredTicket(repository, config, ticketId);

    console.log(JSON.stringify(plan, null, 2));
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function createManualTicket(title: string, description: string, labels: string): Ticket {
  return {
    id: "manual-1",
    source: "manual",
    title,
    description,
    labels: parseLabels(labels),
    status: "inbox"
  };
}

function parseLabels(labels: string): string[] {
  return labels
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}
