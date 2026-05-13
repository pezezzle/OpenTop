#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import {
  buildAgentPrompt,
  buildPromptForStoredTicket,
  classifyStoredTicket,
  createPlannedExecutionForStoredTicket,
  getBranchPolicySettings,
  getConfigValue,
  createTicket,
  createExecutionPlan,
  getExecution,
  listTickets,
  listExecutions,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  setConfigValue,
  planExecutionForStoredTicket,
  type OpenTopConfigScope,
  type ExecutionBranchPolicy,
  type Ticket
} from "@opentop/core";
import { createSqliteExecutionRepository, createSqliteTicketRepository } from "@opentop/db";
import { getRepositoryStatus } from "@opentop/git";

const program = new Command();

program
  .name("opentop")
  .description("Open Ticket Orchestrator Platform CLI")
  .version("0.1.0")
  .option("-r, --repo <path>", "Target repository path", process.cwd());

program
  .command("start")
  .description("Start an interactive OpenTop console")
  .action(async () => {
    await startInteractiveConsole(getTargetRepositoryPath());
  });

program
  .command("init")
  .description("Create a starter .opentop/opentop.yml config")
  .action(async () => {
    const targetDirectory = getTargetRepositoryPath();
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

execution:
  defaultBranchPolicy: reuse-current
`;

    const openTopDirectory = join(targetDirectory, ".opentop");
    const configPath = join(openTopDirectory, "opentop.yml");

    await mkdir(openTopDirectory, { recursive: true });
    await writeFile(configPath, starterConfig, { flag: "wx" });
    console.log(`Created ${configPath}`);
  });

program
  .command("status")
  .description("Show repository and OpenTop config status")
  .action(async () => {
    const targetDirectory = getTargetRepositoryPath();
    const [config, repositoryStatus, ticketRepository, executionRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      getRepositoryStatus(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [tickets, executions] = await Promise.all([listTickets(ticketRepository), listExecutions(executionRepository)]);

    console.log(`Repository: ${targetDirectory}`);
    console.log(`Project: ${config.project.name}`);
    console.log(`Default branch: ${config.project.defaultBranch}`);
    console.log(`Branch policy: ${config.execution.defaultBranchPolicy}`);
    console.log(`Current branch: ${repositoryStatus.currentBranch}`);
    console.log(`Working tree: ${repositoryStatus.isClean ? "clean" : "dirty"}`);
    console.log(`Stored tickets: ${tickets.length}`);
    console.log(`Stored executions: ${executions.length}`);
  });

const configCommand = program.command("config").description("Read or write OpenTop configuration");

configCommand
  .command("get")
  .description("Read a config value")
  .argument("<key>", "Configuration key")
  .option("--scope <scope>", "Config scope: effective, project, or user", "effective")
  .action(async (key: string, options: { scope: OpenTopConfigScope }) => {
    const scope = parseConfigScope(options.scope);
    const value = await getConfigValue(parseSupportedConfigKey(key), scope, getTargetRepositoryPath());
    console.log(value ?? "");
  });

configCommand
  .command("set")
  .description("Write a config value")
  .argument("<key>", "Configuration key")
  .argument("<value>", "New value")
  .option("--scope <scope>", "Config scope: project or user", "project")
  .action(async (key: string, value: string, options: { scope: string }) => {
    const scope = parseWritableConfigScope(options.scope);
    const configKey = parseSupportedConfigKey(key);
    const branchPolicy = parseExecutionBranchPolicy(value);
    const targetPath = await setConfigValue(configKey, branchPolicy, scope, getTargetRepositoryPath());
    console.log(`Updated ${configKey} in ${targetPath}`);
  });

program
  .command("settings")
  .description("Open interactive OpenTop settings")
  .action(async () => {
    await openSettingsMenu(getTargetRepositoryPath());
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
      const repository = await createSqliteTicketRepository({ startDirectory: getTargetRepositoryPath() });
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
    const repository = await createSqliteTicketRepository({ startDirectory: getTargetRepositoryPath() });
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

const executionsCommand = program.command("executions").description("Inspect locally stored OpenTop executions");

executionsCommand
  .command("list")
  .description("List locally stored OpenTop executions")
  .option("--json", "Print stored executions as JSON")
  .action(async (options: { json?: boolean }) => {
    const repository = await createSqliteExecutionRepository({ startDirectory: getTargetRepositoryPath() });
    const executions = await listExecutions(repository);

    if (options.json) {
      console.log(JSON.stringify(executions.map(toExecutionSummary), null, 2));
      return;
    }

    if (executions.length === 0) {
      console.log("No local executions found.");
      return;
    }

    for (const execution of executions) {
      console.log(`#${execution.id} [${execution.status}] ticket=${execution.ticketId} branch=${execution.branchName}`);
    }
  });

executionsCommand
  .command("show")
  .description("Show a stored OpenTop execution")
  .argument("<executionId>", "Execution ID")
  .option("--json", "Print the execution as JSON")
  .action(async (executionId: string, options: { json?: boolean }) => {
    const repository = await createSqliteExecutionRepository({ startDirectory: getTargetRepositoryPath() });
    const execution = await getExecution(repository, executionId);

    if (options.json) {
      console.log(JSON.stringify(execution, null, 2));
      return;
    }

    console.log(`Execution ${execution.id}`);
    console.log(`Status: ${execution.status}`);
    console.log(`Ticket: ${execution.ticketId}`);
    console.log(`Branch: ${execution.branchName}`);
    console.log(`Profile: ${execution.profileId}`);
    console.log(`Model: ${execution.providerId}/${execution.modelId}`);
  });

program
  .command("classify")
  .description("Classify a stored ticket by ID or manual command-line input")
  .argument("[ticketId]", "Stored ticket ID")
  .option("--title <title>", "Ticket title", "Untitled ticket")
  .option("--description <description>", "Ticket description", "")
  .option("--labels <labels>", "Comma-separated ticket labels", "")
  .action(async (ticketId: string | undefined, options: { title: string; description: string; labels: string }) => {
    const targetDirectory = getTargetRepositoryPath();
    const config = await loadOpenTopConfig(undefined, targetDirectory);

    if (ticketId) {
      const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
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
      const targetDirectory = getTargetRepositoryPath();
      const [config, projectContext] = await Promise.all([
        loadOpenTopConfig(undefined, targetDirectory),
        loadOpenTopProjectContext(targetDirectory)
      ]);

      const builtPrompt = ticketId
        ? await buildPromptForStoredTicket(
            await createSqliteTicketRepository({ startDirectory: targetDirectory }),
            config,
            projectContext,
            ticketId
          )
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
  .description("Create a planned execution for a stored ticket")
  .argument("<ticketId>", "Ticket ID")
  .option("--branch-policy <policy>", "Override branch policy for this run", parseExecutionBranchPolicy)
  .action(async (ticketId: string, options: { branchPolicy?: ExecutionBranchPolicy }) => {
    const targetDirectory = getTargetRepositoryPath();
    const [config, projectContext, ticketRepository, executionRepository, repositoryState] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      getRepositoryStatus(targetDirectory)
    ]);
    const result = await createPlannedExecutionForStoredTicket(
      ticketRepository,
      executionRepository,
      config,
      projectContext,
      ticketId,
      repositoryState,
      options.branchPolicy
    );

    if (result.status === "blocked") {
      console.log(
        JSON.stringify(
          {
            status: result.status,
            branchResolution: result.branchResolution,
            executionPlan: result.executionPlan
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          status: result.status,
          branchResolution: result.branchResolution,
          execution: toExecutionSummary(result.execution),
          executionPlan: result.executionPlan,
          sources: result.sources
        },
        null,
        2
      )
    );
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

function toExecutionSummary(execution: {
  id: string;
  ticketId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: string;
  branchName: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: execution.id,
    ticketId: execution.ticketId,
    profileId: execution.profileId,
    providerId: execution.providerId,
    modelId: execution.modelId,
    status: execution.status,
    branchName: execution.branchName,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt
  };
}

function parseExecutionBranchPolicy(value: string): ExecutionBranchPolicy {
  if (value === "new" || value === "reuse-current" || value === "manual" || value === "none") {
    return value;
  }

  throw new Error(`Unsupported branch policy "${value}". Use one of: new, reuse-current, manual, none.`);
}

function parseConfigScope(value: string): OpenTopConfigScope {
  if (value === "effective" || value === "project" || value === "user") {
    return value;
  }

  throw new Error(`Unsupported config scope "${value}". Use one of: effective, project, user.`);
}

function parseWritableConfigScope(value: string): Exclude<OpenTopConfigScope, "effective"> {
  if (value === "project" || value === "user") {
    return value;
  }

  throw new Error(`Unsupported writable config scope "${value}". Use one of: project, user.`);
}

function parseSupportedConfigKey(value: string): "execution.defaultBranchPolicy" {
  if (value === "execution.defaultBranchPolicy") {
    return value;
  }

  throw new Error(`Unsupported config key "${value}". Currently supported: execution.defaultBranchPolicy.`);
}

async function startInteractiveConsole(targetDirectory: string): Promise<void> {
  const rl = createInterface({ input, output });

  try {
    while (true) {
      console.log("");
      console.log("OpenTop");
      console.log(`Repository: ${targetDirectory}`);
      console.log("[1] Status");
      console.log("[2] Tickets");
      console.log("[3] Executions");
      console.log("[4] Settings");
      console.log("[5] Exit");
      const choice = await safeQuestion(rl, "Choose an action: ");

      if (choice === undefined) {
        break;
      }

      if (choice === "1") {
        await printStatus(targetDirectory);
        continue;
      }

      if (choice === "2") {
        await printTickets(targetDirectory);
        continue;
      }

      if (choice === "3") {
        await printExecutions(targetDirectory);
        continue;
      }

      if (choice === "4") {
        await openSettingsMenu(targetDirectory, rl);
        continue;
      }

      if (choice === "5" || choice.toLowerCase() === "exit") {
        break;
      }

      console.log("Unknown selection.");
    }
  } finally {
    rl.close();
  }
}

async function openSettingsMenu(
  targetDirectory: string,
  existingInterface?: ReturnType<typeof createInterface>
): Promise<void> {
  const rl = existingInterface ?? createInterface({ input, output });

  try {
    while (true) {
      const settings = await getBranchPolicySettings(targetDirectory);
      console.log("");
      console.log("OpenTop Settings");
      console.log(`Repository: ${targetDirectory}`);
      console.log(`Effective branch policy: ${settings.effective}`);
      console.log(`Project branch policy: ${settings.project ?? "(not set)"}`);
      console.log(`User branch policy: ${settings.user ?? "(not set)"}`);
      console.log("");
      console.log("[1] Set project branch policy");
      console.log("[2] Set user branch policy");
      console.log("[3] Back");
      const choice = await safeQuestion(rl, "Choose an action: ");

      if (choice === undefined) {
        return;
      }

      if (choice === "3" || choice.toLowerCase() === "back") {
        return;
      }

      if (choice !== "1" && choice !== "2") {
        console.log("Unknown selection.");
        continue;
      }

      console.log("");
      console.log("Available branch policies:");
      console.log("- new");
      console.log("- reuse-current");
      console.log("- manual");
      console.log("- none");
      const rawPolicy = await safeQuestion(rl, "Enter branch policy: ");

      if (rawPolicy === undefined) {
        return;
      }

      const policy = parseExecutionBranchPolicy(rawPolicy);
      const scope = choice === "1" ? "project" : "user";
      const targetPath = await setConfigValue(
        "execution.defaultBranchPolicy",
        policy,
        scope,
        targetDirectory
      );
      console.log(`Updated execution.defaultBranchPolicy=${policy} in ${targetPath}`);
    }
  } finally {
    if (!existingInterface) {
      rl.close();
    }
  }
}

async function safeQuestion(
  rl: ReturnType<typeof createInterface>,
  prompt: string
): Promise<string | undefined> {
  try {
    return (await rl.question(prompt)).trim();
  } catch (error) {
    if (isReadlineClosedError(error)) {
      return undefined;
    }

    throw error;
  }
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === "readline was closed";
}

async function printStatus(targetDirectory: string): Promise<void> {
  const [config, repositoryStatus, ticketRepository, executionRepository] = await Promise.all([
    loadOpenTopConfig(undefined, targetDirectory),
    getRepositoryStatus(targetDirectory),
    createSqliteTicketRepository({ startDirectory: targetDirectory }),
    createSqliteExecutionRepository({ startDirectory: targetDirectory })
  ]);
  const [tickets, executions] = await Promise.all([listTickets(ticketRepository), listExecutions(executionRepository)]);

  console.log(`Project: ${config.project.name}`);
  console.log(`Default branch: ${config.project.defaultBranch}`);
  console.log(`Branch policy: ${config.execution.defaultBranchPolicy}`);
  console.log(`Current branch: ${repositoryStatus.currentBranch}`);
  console.log(`Working tree: ${repositoryStatus.isClean ? "clean" : "dirty"}`);
  console.log(`Stored tickets: ${tickets.length}`);
  console.log(`Stored executions: ${executions.length}`);
}

async function printTickets(targetDirectory: string): Promise<void> {
  const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
  const tickets = await listTickets(repository);

  if (tickets.length === 0) {
    console.log("No local tickets found.");
    return;
  }

  for (const ticket of tickets) {
    console.log(`#${ticket.id} [${ticket.status}] ${ticket.title}`);
  }
}

async function printExecutions(targetDirectory: string): Promise<void> {
  const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });
  const executions = await listExecutions(repository);

  if (executions.length === 0) {
    console.log("No local executions found.");
    return;
  }

  for (const execution of executions) {
    console.log(`#${execution.id} [${execution.status}] ticket=${execution.ticketId} branch=${execution.branchName}`);
  }
}

function getTargetRepositoryPath(): string {
  const options = program.opts<{ repo?: string }>();
  return resolve(options.repo ?? process.cwd());
}
