#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { Command } from "commander";
import {
  buildAgentPrompt,
  classifyTicket,
  createExecutionPlan,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  type Ticket
} from "@opentop/core";
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
    const [config, repository] = await Promise.all([loadOpenTopConfig(), getRepositoryStatus()]);

    console.log(`Project: ${config.project.name}`);
    console.log(`Default branch: ${config.project.defaultBranch}`);
    console.log(`Current branch: ${repository.currentBranch}`);
    console.log(`Working tree: ${repository.isClean ? "clean" : "dirty"}`);
  });

program
  .command("classify")
  .description("Classify a ticket from command-line input")
  .option("--title <title>", "Ticket title", "Untitled ticket")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .action(async (options: { title: string; description: string; labels: string }) => {
    const config = await loadOpenTopConfig();
    const ticket = createManualTicket(options.title, options.description, options.labels);
    const classification = classifyTicket(ticket, config);
    const plan = createExecutionPlan({ ...ticket, classification }, config);

    console.log(JSON.stringify({ classification, executionPlan: plan }, null, 2));
  });

program
  .command("prompt")
  .description("Build a controlled agent prompt from command-line ticket input")
  .option("--title <title>", "Ticket title", "Untitled ticket")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .option("--json", "Print prompt metadata as JSON")
  .action(async (options: { title: string; description: string; labels: string; json?: boolean }) => {
    const [config, projectContext] = await Promise.all([loadOpenTopConfig(), loadOpenTopProjectContext()]);
    const ticket = createManualTicket(options.title, options.description, options.labels);
    const classification = classifyTicket(ticket, config);
    const builtPrompt = buildAgentPrompt({
      ticket: { ...ticket, classification },
      config,
      projectContext
    });

    if (options.json) {
      console.log(JSON.stringify(builtPrompt, null, 2));
      return;
    }

    console.log(builtPrompt.prompt);
  });

program
  .command("run")
  .description("Prepare an execution plan for a ticket")
  .argument("<ticketId>", "Ticket ID")
  .action(async (ticketId: string) => {
    const config = await loadOpenTopConfig();
    const ticket = createManualTicket(`Manual ticket ${ticketId}`, "", "");
    const plan = createExecutionPlan(ticket, config);

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
    labels: labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    status: "inbox"
  };
}
