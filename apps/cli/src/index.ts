#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import {
  buildAgentPrompt,
  buildPromptForStoredTicket,
  classifyStoredTicket,
  getProvider,
  getBranchPolicySettings,
  getConfigValue,
  createTicket,
  createExecutionPlan,
  getExecution,
  listTickets,
  listExecutions,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  startExecutionForStoredTicket,
  setConfigValue,
  planExecutionForStoredTicket,
  type OpenTopConfigScope,
  type ExecutionBranchPolicy,
  type Ticket
} from "@opentop/core";
import { createSqliteExecutionRepository, createSqliteTicketRepository } from "@opentop/db";
import { getRepositoryStatus, GitExecutionWorkspace } from "@opentop/git";
import { createProviderAdapter } from "@opentop/providers";
import { startDashboard } from "./dashboard.js";

const program = new Command();
const shellHelpItems = [
  ["help", "Show available shell commands"],
  ["status", "Show repository and OpenTop status"],
  ["tickets list [--json]", "List locally stored tickets"],
  [
    "tickets create --title \"...\" [--description \"...\"] [--labels bug,ui] [--source manual] [--external-id 123] [--json]",
    "Create a local ticket"
  ],
  ["executions list [--json]", "List locally stored executions"],
  ["executions show <id> [--json]", "Show one stored execution"],
  ["classify <ticketId>", "Classify a stored ticket"],
  ["prompt <ticketId> [--json]", "Build a controlled prompt"],
  ["run <ticketId> [--branch-policy new|reuse-current|manual|none]", "Run an execution end-to-end"],
  ["config get execution.defaultBranchPolicy [--scope effective|project|user]", "Read a config value"],
  ["config set execution.defaultBranchPolicy <value> [--scope project|user]", "Write a config value"],
  ["settings", "Open the settings menu"],
  ["clear", "Clear the screen and redraw the header"],
  ["exit", "Exit the interactive shell"]
] as const;
const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  magenta: "\u001B[35m",
  gray: "\u001B[90m"
} as const;

program
  .name("opentop")
  .description("Open Ticket Orchestrator Platform CLI")
  .version("0.1.0")
  .option("-r, --repo <path>", "Target repository path", process.cwd());

program
  .command("start")
  .description("Start the OpenTop terminal app")
  .action(async () => {
    await startDashboard(getTargetRepositoryPath());
  });

program
  .command("dashboard")
  .description("Start the OpenTop web dashboard, local API, and browser")
  .action(async () => {
    await startWebDashboard(getTargetRepositoryPath());
  });

program
  .command("shell")
  .description("Start the text-based OpenTop shell")
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
  .description("Start an execution for a stored ticket")
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
    const executionPlan = await planExecutionForStoredTicket(ticketRepository, config, ticketId);
    const provider = createProviderAdapter(
      executionPlan.providerId,
      getProvider(config, executionPlan.providerId)
    );
    const result = await startExecutionForStoredTicket(
      ticketRepository,
      executionRepository,
      new GitExecutionWorkspace(targetDirectory),
      provider,
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
          sources: result.sources,
          ...(result.status === "failed" ? { error: result.error } : {})
        },
        null,
        2
      )
    );

    if (result.status === "failed") {
      process.exitCode = 1;
    }
  });

await main();

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
  changedFiles?: string[];
  logs?: string[];
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
    changedFiles: execution.changedFiles ?? [],
    logs: execution.logs ?? [],
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
    await printShellHeader(targetDirectory);

    while (true) {
      const line = await safeQuestion(rl, buildShellPrompt(targetDirectory));

      if (line === undefined) {
        break;
      }

      if (!line) {
        continue;
      }

      const shouldContinue = await executeShellCommand(line, targetDirectory, rl);

      if (!shouldContinue) {
        break;
      }
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
      printSection("Settings");
      printKeyValueRows([
        ["Repository", targetDirectory],
        ["Effective Policy", formatBranchPolicyValue(settings.effective)],
        ["Project Policy", formatBranchPolicyValue(settings.project)],
        ["User Policy", formatBranchPolicyValue(settings.user)]
      ]);
      console.log("");
      printMenu([
        "[1] Set project branch policy",
        "[2] Set user branch policy",
        "[3] Back"
      ]);
      const choice = await safeQuestion(rl, colorize("Choose an action: ", "cyan"));

      if (choice === undefined) {
        return;
      }

      if (choice === "3" || choice.toLowerCase() === "back") {
        return;
      }

      if (choice !== "1" && choice !== "2") {
        printWarning("Unknown selection.");
        continue;
      }

      console.log("");
      printSection("Available Branch Policies");
      printBulletList(["new", "reuse-current", "manual", "none"]);
      const rawPolicy = await safeQuestion(rl, colorize("Enter branch policy: ", "cyan"));

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
      printSuccess(`Updated execution.defaultBranchPolicy=${policy} in ${targetPath}`);
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

  printSection("Status");
  printKeyValueRows([
    ["Repository", targetDirectory],
    ["Project", config.project.name],
    ["Default Branch", config.project.defaultBranch],
    ["Branch Policy", config.execution.defaultBranchPolicy],
    ["Current Branch", repositoryStatus.currentBranch],
    ["Working Tree", repositoryStatus.isClean ? colorize("clean", "green") : colorize("dirty", "yellow")],
    ["Stored Tickets", String(tickets.length)],
    ["Stored Executions", String(executions.length)]
  ]);

  if (repositoryStatus.changedFiles.length > 0) {
    console.log("");
    printSubsection("Changed Files");
    printBulletList(repositoryStatus.changedFiles);
  }
}

async function printTickets(targetDirectory: string): Promise<void> {
  const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
  const tickets = await listTickets(repository);

  if (tickets.length === 0) {
    printMuted("No local tickets found.");
    return;
  }

  printSection("Tickets");
  printTable(
    ["ID", "Status", "Source", "Title"],
    tickets.map((ticket) => [ticket.id, formatTicketStatus(ticket.status), ticket.source, ticket.title])
  );
}

async function printExecutions(targetDirectory: string): Promise<void> {
  const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });
  const executions = await listExecutions(repository);

  if (executions.length === 0) {
    printMuted("No local executions found.");
    return;
  }

  printSection("Executions");
  printTable(
    ["ID", "Status", "Ticket", "Branch", "Model"],
    executions.map((execution) => [
      execution.id,
      formatExecutionStatus(execution.status),
      execution.ticketId,
      execution.branchName,
      `${execution.providerId}/${execution.modelId}`
    ])
  );
}

function getTargetRepositoryPath(): string {
  const options = program.opts<{ repo?: string }>();
  return resolve(options.repo ?? process.cwd());
}

function getWorkspaceRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "../../..");
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (shouldShowHelpByDefault(rawArgs)) {
    program.outputHelp();
    return;
  }

  await program.parseAsync().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function startWebDashboard(targetDirectory: string): Promise<void> {
  printSection("Dashboard");
  console.log(`Repository: ${targetDirectory}`);

  const apiStarted = await ensureService({
    name: "API",
    url: "http://127.0.0.1:4317/health",
    command: ["api"],
    repositoryPath: targetDirectory
  });
  const webStarted = await ensureService({
    name: "Web",
    url: "http://127.0.0.1:3000",
    command: ["web"],
    repositoryPath: targetDirectory
  });

  printSuccess(`API ${apiStarted ? "started" : "already running"}`);
  printSuccess(`Web ${webStarted ? "started" : "already running"}`);

  const dashboardUrl = "http://127.0.0.1:3000";
  openUrlInBrowser(dashboardUrl);
  printSuccess(`Opened ${dashboardUrl}`);
  console.log("");
  printMuted("If the page shows a different repository than expected, stop existing OpenTop API/Web processes and run `opentop dashboard` again.");
}

function shouldShowHelpByDefault(args: string[]): boolean {
  if (args.length === 0) {
    return true;
  }

  const nonGlobalArgs = stripGlobalOptions(args);

  if (nonGlobalArgs.length === 0) {
    return true;
  }

  return false;
}

interface ServiceStartOptions {
  name: string;
  url: string;
  command: string[];
  repositoryPath: string;
}

async function ensureService(options: ServiceStartOptions): Promise<boolean> {
  if (await isUrlReachable(options.url)) {
    return false;
  }

  printMuted(`Starting ${options.name}...`);
  const workspaceRoot = getWorkspaceRoot();
  const env = {
    ...process.env,
    OPENTOP_REPO_PATH: options.repositoryPath
  };
  const child = startBackgroundCommand(workspaceRoot, env, options.command);

  child.unref();

  const reachable = await waitForUrl(options.url, 30_000);

  if (!reachable) {
    throw new Error(`${options.name} did not become ready at ${options.url}.`);
  }

  return true;
}

function startBackgroundCommand(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  command: string[]
): ReturnType<typeof spawn> {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", "pnpm", ...command], {
      cwd: workspaceRoot,
      env,
      detached: true,
      stdio: "ignore"
    });
  }

  return spawn("pnpm", command, {
    cwd: workspaceRoot,
    env,
    detached: true,
    stdio: "ignore"
  });
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isUrlReachable(url)) {
      return true;
    }

    await delay(500);
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function openUrlInBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function stripGlobalOptions(args: string[]): string[] {
  const remaining: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "-r" || token === "--repo") {
      index += 1;
      continue;
    }

    if (token.startsWith("--repo=")) {
      continue;
    }

    if (token === "-h" || token === "--help" || token === "-V" || token === "--version") {
      remaining.push(token);
      continue;
    }

    remaining.push(token);
  }

  return remaining;
}

function resolveTargetRepositoryPathFromArgs(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if ((token === "-r" || token === "--repo") && args[index + 1]) {
      return resolve(args[index + 1]);
    }

    if (token.startsWith("--repo=")) {
      return resolve(token.slice("--repo=".length));
    }
  }

  return process.cwd();
}

async function printShellHeader(targetDirectory: string): Promise<void> {
  console.log(colorize("   ____                ______            ", "cyan"));
  console.log(colorize("  / __ \\____  ___     /_  __/___  ____   ", "cyan"));
  console.log(colorize(" / / / / __ \\/ _ \\     / / / __ \\/ __ \\  ", "cyan"));
  console.log(colorize("/ /_/ / /_/ /  __/    / / / /_/ / /_/ /  ", "cyan"));
  console.log(colorize("\\____/ .___/\\___/    /_/  \\____/ .___/   ", "cyan"));
  console.log(colorize("    /_/                       /_/        ", "cyan"));
  console.log(colorize("Open Ticket Orchestrator Platform", "bold"));
  console.log("");

  try {
    const [config, repositoryStatus] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      getRepositoryStatus(targetDirectory)
    ]);

    printKeyValueRows([
      ["Repo", targetDirectory],
      ["Project", config.project.name],
      ["Branch", repositoryStatus.currentBranch],
      ["Policy", config.execution.defaultBranchPolicy],
      ["Tree", repositoryStatus.isClean ? colorize("clean", "green") : colorize("dirty", "yellow")]
    ]);
  } catch (error) {
    printKeyValueRows([
      ["Repo", targetDirectory],
      ["Status", colorize(error instanceof Error ? error.message : String(error), "yellow")]
    ]);
  }

  console.log("");
  console.log(colorize("Type `help` for commands.", "gray"));
  console.log("");
}

function buildShellPrompt(targetDirectory: string): string {
  const name = targetDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? "repo";
  return `${colorize("opentop", "magenta")}:${colorize(name, "blue")}> `;
}

async function executeShellCommand(
  line: string,
  targetDirectory: string,
  rl: ReturnType<typeof createInterface>
): Promise<boolean> {
  const tokens = tokenizeShellInput(line);

  if (tokens.length === 0) {
    return true;
  }

  const [command, ...rest] = tokens;

  if (command === "exit" || command === "quit") {
    return false;
  }

  if (command === "help") {
    printShellHelp();
    return true;
  }

  if (command === "clear") {
    console.clear();
    await printShellHeader(targetDirectory);
    return true;
  }

  try {
    switch (command) {
      case "status":
        await printStatus(targetDirectory);
        return true;
      case "settings":
        await openSettingsMenu(targetDirectory, rl);
        return true;
      case "tickets":
        await executeTicketsShellCommand(rest, targetDirectory);
        return true;
      case "executions":
        await executeExecutionsShellCommand(rest, targetDirectory);
        return true;
      case "classify":
        await executeClassifyShellCommand(rest, targetDirectory);
        return true;
      case "prompt":
        await executePromptShellCommand(rest, targetDirectory);
        return true;
      case "run":
        await executeRunShellCommand(rest, targetDirectory);
        return true;
      case "config":
        await executeConfigShellCommand(rest, targetDirectory);
        return true;
      default:
        console.log(`Unknown command: ${command}`);
        console.log("Type `help` for commands.");
        return true;
    }
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
    return true;
  }
}

function printShellHelp(): void {
  printSection("Help");
  printTable(
    ["Command", "Description"],
    shellHelpItems.map(([command, description]) => [command, description])
  );
}

async function executeTicketsShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const subcommand = tokens[0];

  if (subcommand === "list") {
    const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
    const tickets = await listTickets(repository);

    if (hasFlag(tokens.slice(1), "--json")) {
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
    return;
  }

  if (subcommand === "create") {
    const title = requireOption(tokens.slice(1), "--title");
    const description = readOption(tokens.slice(1), "--description") ?? "";
    const labels = readOption(tokens.slice(1), "--labels") ?? "";
    const source = (readOption(tokens.slice(1), "--source") ?? "manual") as Ticket["source"];
    const externalId = readOption(tokens.slice(1), "--external-id");
    const json = hasFlag(tokens.slice(1), "--json");

    const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
    const ticket = await createTicket(repository, {
      source,
      externalId: externalId || undefined,
      title,
      description,
      labels: parseLabels(labels)
    });

    if (json) {
      console.log(JSON.stringify(ticket, null, 2));
      return;
    }

    printSuccess(`Created ticket ${ticket.id}: ${ticket.title}`);
    return;
  }

  throw new Error("Unsupported tickets command. Use `tickets list` or `tickets create ...`.");
}

async function executeExecutionsShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const subcommand = tokens[0];

  if (subcommand === "list") {
    const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });
    const executions = await listExecutions(repository);

    if (hasFlag(tokens.slice(1), "--json")) {
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
    return;
  }

  if (subcommand === "show") {
    const executionId = tokens[1];

    if (!executionId) {
      throw new Error("Usage: executions show <id> [--json]");
    }

    const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });
    const execution = await getExecution(repository, executionId);

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify(execution, null, 2));
      return;
    }

    printSection(`Execution ${execution.id}`);
    printKeyValueRows([
      ["Status", formatExecutionStatus(execution.status)],
      ["Ticket", execution.ticketId],
      ["Branch", execution.branchName],
      ["Profile", execution.profileId],
      ["Model", `${execution.providerId}/${execution.modelId}`],
      ["Created", execution.createdAt]
    ]);
    return;
  }

  throw new Error("Unsupported executions command. Use `executions list` or `executions show <id>`.");
}

async function executeClassifyShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const ticketId = tokens[0];

  if (!ticketId) {
    throw new Error("Usage: classify <ticketId>");
  }

  const config = await loadOpenTopConfig(undefined, targetDirectory);
  const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
  const result = await classifyStoredTicket(repository, config, ticketId);
  console.log(JSON.stringify(result, null, 2));
}

async function executePromptShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const ticketId = tokens[0];

  if (!ticketId) {
    throw new Error("Usage: prompt <ticketId> [--json]");
  }

  const [config, projectContext, repository] = await Promise.all([
    loadOpenTopConfig(undefined, targetDirectory),
    loadOpenTopProjectContext(targetDirectory),
    createSqliteTicketRepository({ startDirectory: targetDirectory })
  ]);
  const builtPrompt = await buildPromptForStoredTicket(repository, config, projectContext, ticketId);

  if (hasFlag(tokens.slice(1), "--json")) {
    console.log(JSON.stringify(builtPrompt, null, 2));
    return;
  }

  console.log(builtPrompt.prompt);
}

async function executeRunShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const ticketId = tokens[0];

  if (!ticketId) {
    throw new Error("Usage: run <ticketId> [--branch-policy new|reuse-current|manual|none]");
  }

  const rawBranchPolicy = readOption(tokens.slice(1), "--branch-policy");
  const branchPolicy = rawBranchPolicy ? parseExecutionBranchPolicy(rawBranchPolicy) : undefined;
  const [config, projectContext, ticketRepository, executionRepository, repositoryState] = await Promise.all([
    loadOpenTopConfig(undefined, targetDirectory),
    loadOpenTopProjectContext(targetDirectory),
    createSqliteTicketRepository({ startDirectory: targetDirectory }),
    createSqliteExecutionRepository({ startDirectory: targetDirectory }),
    getRepositoryStatus(targetDirectory)
  ]);
  const executionPlan = await planExecutionForStoredTicket(ticketRepository, config, ticketId);
  const provider = createProviderAdapter(
    executionPlan.providerId,
    getProvider(config, executionPlan.providerId)
  );
  const result = await startExecutionForStoredTicket(
    ticketRepository,
    executionRepository,
    new GitExecutionWorkspace(targetDirectory),
    provider,
    config,
    projectContext,
    ticketId,
    repositoryState,
    branchPolicy
  );

  if (result.status === "blocked") {
    printSection("Execution Blocked");
    printKeyValueRows([
      ["Ticket", result.executionPlan.ticket.id],
      ["Profile", result.executionPlan.profile.id],
      ["Requested Branch", result.executionPlan.branchName],
      ["Decision", formatBranchDecision(result.branchResolution.decision)],
      ["Policy", result.branchResolution.policy],
      ["Reason", result.branchResolution.reason]
    ]);
    return;
  }

  if (result.status === "failed") {
    printSection("Execution Failed");
    printKeyValueRows([
      ["Execution", result.execution.id],
      ["Ticket", result.execution.ticketId],
      ["Status", formatExecutionStatus(result.execution.status)],
      ["Branch Decision", formatBranchDecision(result.branchResolution.decision)],
      ["Branch", result.execution.branchName],
      ["Reason", result.error]
    ]);
    console.log("");
    printSubsection("Logs");
    printBulletList(result.execution.logs);
    return;
  }

  printSection("Execution Succeeded");
  printKeyValueRows([
    ["Execution", result.execution.id],
    ["Ticket", result.execution.ticketId],
    ["Status", formatExecutionStatus(result.execution.status)],
    ["Branch Decision", formatBranchDecision(result.branchResolution.decision)],
    ["Branch", result.execution.branchName],
    ["Profile", result.execution.profileId],
    ["Model", `${result.execution.providerId}/${result.execution.modelId}`]
  ]);
  console.log("");
  printSubsection("Branch Resolution");
  printKeyValueRows([
    ["Policy", result.branchResolution.policy],
    ["Reason", result.branchResolution.reason]
  ]);
  console.log("");
  printSubsection("Logs");
  printBulletList(result.execution.logs);
  console.log("");
  printSubsection("Changed Files");
  printBulletList(result.execution.changedFiles);
  console.log("");
  printSubsection("Sources");
  printBulletList(result.sources);
}

async function executeConfigShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const subcommand = tokens[0];

  if (subcommand === "get") {
    const key = tokens[1];

    if (!key) {
      throw new Error("Usage: config get execution.defaultBranchPolicy [--scope effective|project|user]");
    }

    const scope = parseConfigScope(readOption(tokens.slice(2), "--scope") ?? "effective");
    const value = await getConfigValue(parseSupportedConfigKey(key), scope, targetDirectory);
    printSection("Config");
    printKeyValueRows([
      ["Key", key],
      ["Scope", scope],
      ["Value", value ?? "(not set)"]
    ]);
    return;
  }

  if (subcommand === "set") {
    const key = tokens[1];
    const value = tokens[2];

    if (!key || !value) {
      throw new Error("Usage: config set execution.defaultBranchPolicy <value> [--scope project|user]");
    }

    const scope = parseWritableConfigScope(readOption(tokens.slice(3), "--scope") ?? "project");
    const targetPath = await setConfigValue(
      parseSupportedConfigKey(key),
      parseExecutionBranchPolicy(value),
      scope,
      targetDirectory
    );
    printSuccess(`Updated ${key} in ${targetPath}`);
    return;
  }

  throw new Error("Unsupported config command. Use `config get ...` or `config set ...`.");
}

function tokenizeShellInput(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }

      if (char === "\\" && index + 1 < line.length && line[index + 1] === quote) {
        current += line[index + 1];
        index += 1;
        continue;
      }

      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unterminated quoted string.");
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function hasFlag(tokens: string[], flag: string): boolean {
  return tokens.includes(flag);
}

function readOption(tokens: string[], option: string): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === option) {
      return tokens[index + 1];
    }

    if (token.startsWith(`${option}=`)) {
      return token.slice(option.length + 1);
    }
  }

  return undefined;
}

function requireOption(tokens: string[], option: string): string {
  const value = readOption(tokens, option);

  if (!value) {
    throw new Error(`Missing required option ${option}.`);
  }

  return value;
}

function colorize(text: string, style: keyof typeof ANSI): string {
  if (!output.isTTY) {
    return text;
  }

  return `${ANSI[style]}${text}${ANSI.reset}`;
}

function printSection(title: string): void {
  console.log("");
  console.log(colorize(title, "bold"));
  console.log(colorize("─".repeat(Math.min(Math.max(title.length + 6, 24), getViewportWidth())), "gray"));
}

function printSubsection(title: string): void {
  console.log(colorize(title, "cyan"));
}

function printKeyValueRows(rows: Array<[string, string]>): void {
  const width = Math.max(...rows.map(([label]) => label.length), 0);

  for (const [label, value] of rows) {
    console.log(`${colorize(label.padEnd(width), "gray")}  ${value}`);
  }
}

function printTable(headers: string[], rows: string[][]): void {
  const stringRows = rows.map((row) => row.map((cell) => stripAnsi(cell)));
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...stringRows.map((row) => row[columnIndex]?.length ?? 0))
  );

  const headerLine = headers
    .map((header, index) => colorize(header.padEnd(widths[index]), "gray"))
    .join("  ");
  console.log(headerLine);
  console.log(colorize(widths.map((width) => "─".repeat(width)).join("  "), "gray"));

  for (const row of rows) {
    const line = row
      .map((cell, index) => padAnsi(cell, widths[index]))
      .join("  ");
    console.log(line);
  }
}

function printBulletList(items: string[]): void {
  if (items.length === 0) {
    console.log(colorize("- none", "gray"));
    return;
  }

  for (const item of items) {
    console.log(`${colorize("-", "gray")} ${item}`);
  }
}

function printMenu(items: string[]): void {
  for (const item of items) {
    console.log(`${colorize(">", "magenta")} ${item}`);
  }
}

function printSuccess(message: string): void {
  console.log(`${colorize("OK", "green")} ${message}`);
}

function printWarning(message: string): void {
  console.log(`${colorize("WARN", "yellow")} ${message}`);
}

function printMuted(message: string): void {
  console.log(colorize(message, "gray"));
}

function formatExecutionStatus(status: string): string {
  if (status === "planned" || status === "succeeded") {
    return colorize(status, "green");
  }

  if (status === "running" || status === "queued") {
    return colorize(status, "blue");
  }

  if (status === "failed" || status === "cancelled") {
    return colorize(status, "red");
  }

  return colorize(status, "gray");
}

function formatTicketStatus(status: string): string {
  if (status === "inbox") {
    return colorize(status, "blue");
  }

  if (status === "done") {
    return colorize(status, "green");
  }

  return colorize(status, "gray");
}

function formatBranchDecision(decision: string): string {
  if (decision === "new" || decision === "reuse-current" || decision === "none") {
    return colorize(decision, "green");
  }

  return colorize(decision, "yellow");
}

function formatBranchPolicyValue(value: string | undefined): string {
  return value ? colorize(value, "blue") : colorize("(not set)", "gray");
}

function getViewportWidth(): number {
  return typeof output.columns === "number" && output.columns > 0 ? output.columns : 80;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function padAnsi(value: string, width: number): string {
  const plain = stripAnsi(value);
  return value + " ".repeat(Math.max(0, width - plain.length));
}
