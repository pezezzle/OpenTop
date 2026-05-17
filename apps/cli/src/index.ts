#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import {
  buildAgentPrompt,
  buildPromptForStoredTicket,
  classifyStoredTicket,
  createAiTicketIntelligenceService,
  createStarterConfigObject,
  getProvider,
  getModel,
  getBranchPolicySettings,
  getConfigValue,
  createTicket,
  createExecutionPlan,
  getExecution,
  listTickets,
  listExecutions,
  listExecutionsForStoredWorkerPlan,
  inspectConfiguredProviders,
  listWorkItemsForStoredTicket,
  listWorkerPlansForStoredTicket,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  saveProviderSetup,
  startExecutionForStoredTicket,
  getWorkItem,
  setConfigValue,
  stringifyStarterConfig,
  planExecutionForStoredTicket,
  runWorkItemForStoredTicket,
  runWorkerPlanForStoredTicket,
  type OpenTopConfigScope,
  type ExecutionBranchPolicy,
  type ProviderConnectionMethod,
  type TicketIntelligenceService,
  type Ticket
} from "@opentop/core";
import {
  createSqliteCheckRunRepository,
  createSqliteExecutionRepository,
  createSqlitePlanArtifactRepository,
  createSqlitePromptReviewRepository,
  createSqliteTicketRepository,
  createSqliteWorkItemRepository,
  createSqliteWorkerPlanRepository
} from "@opentop/db";
import { ensureBranchWorktree, getRepositoryStatus, GitExecutionWorkspace } from "@opentop/git";
import { createProviderAdapter, inspectProviderRuntime } from "@opentop/providers";
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
  ["worker-plans show <ticketId> [--json]", "Show the latest worker plan and work items for one ticket"],
  ["worker-plans run <ticketId> [--json]", "Run ready work items sequentially for one ticket"],
  ["work-items list <ticketId> [--json]", "List stored work items for one ticket"],
  ["work-items show <id> [--json]", "Show one stored work item"],
  ["work-items run <id> [--json]", "Run one stored work item"],
  ["providers list [--json]", "Inspect configured providers"],
  ["providers doctor [--json]", "Show provider health and compatibility warnings"],
  ["providers setup", "Interactive provider and model-tier setup"],
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
  .description("Initialize OpenTop config and optionally guide provider setup")
  .action(async () => {
    const targetDirectory = getTargetRepositoryPath();
    const openTopDirectory = join(targetDirectory, ".opentop");
    const configPath = join(openTopDirectory, "opentop.yml");
    const rl = createInterface({ input, output });

    try {
      const projectName =
        (await safeQuestion(
          rl,
          colorize(`Project name [${deriveProjectDisplayName(targetDirectory)}]: `, "cyan")
        )) || deriveProjectDisplayName(targetDirectory);
      const createProvider = await yesNoQuestion(
        rl,
        "Configure a provider now? [Y/n]: ",
        true
      );
      const starterConfig = createStarterConfigObject(projectName);

      await mkdir(openTopDirectory, { recursive: true });
      await writeFile(configPath, stringifyStarterConfig(starterConfig), { flag: "wx" });
      printSuccess(`Created ${configPath}`);

      if (createProvider) {
        await runProviderSetupWizard(targetDirectory, rl);
      }
    } finally {
      rl.close();
    }
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
const workerPlansCommand = program.command("worker-plans").description("Inspect stored worker-plan versions");
const workItemsCommand = program.command("work-items").description("Inspect stored worker items");
const providersCommand = program.command("providers").description("Inspect configured OpenTop providers");

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

workerPlansCommand
  .command("show")
  .description("Show the latest worker plan plus work items for one ticket")
  .argument("<ticketId>", "Ticket ID")
  .option("--json", "Print the worker plan and work items as JSON")
  .action(async (ticketId: string, options: { json?: boolean }) => {
    const [workerPlanRepository, workItemRepository] = await Promise.all([
      createSqliteWorkerPlanRepository({ startDirectory: getTargetRepositoryPath() }),
      createSqliteWorkItemRepository({ startDirectory: getTargetRepositoryPath() })
    ]);
    const [workerPlans, workItems] = await Promise.all([
      listWorkerPlansForStoredTicket(workerPlanRepository, ticketId),
      listWorkItemsForStoredTicket(workItemRepository, ticketId)
    ]);
    const workerPlan = workerPlans[0] ?? null;

    if (options.json) {
      console.log(JSON.stringify({ workerPlan, workerPlans, workItems }, null, 2));
      return;
    }

    if (!workerPlan) {
      console.log(`No worker plan found for ticket ${ticketId}.`);
      return;
    }

    console.log(`Worker plan ${workerPlan.id} (v${workerPlan.version})`);
    console.log(`Status: ${workerPlan.status}`);
    console.log(`Ticket: ${workerPlan.ticketId}`);
    console.log(`Source plan artifact: ${workerPlan.sourcePlanArtifactId}`);
    console.log(`Summary: ${workerPlan.summary ?? "(none)"}`);
    console.log("");
    console.log("Work items:");

    for (const workItem of workItems.filter((entry) => entry.workerPlanId === workerPlan.id)) {
      console.log(
        `- ${workItem.id} [${workItem.status}] ${workItem.title} :: ${workItem.role} :: ${workItem.suggestedProviderId}/${workItem.suggestedModelId}`
      );
    }
  });

workerPlansCommand
  .command("run")
  .description("Run ready work items sequentially for one ticket")
  .argument("<ticketId>", "Ticket ID")
  .option("--json", "Print the worker-plan run result as JSON")
  .action(async (ticketId: string, options: { json?: boolean }) => {
    const targetDirectory = getTargetRepositoryPath();
    const [config, projectContext, ticketRepository, planArtifactRepository, workerPlanRepository, workItemRepository, executionRepository, checkRunRepository] =
      await Promise.all([
        loadOpenTopConfig(undefined, targetDirectory),
        loadOpenTopProjectContext(targetDirectory),
        createSqliteTicketRepository({ startDirectory: targetDirectory }),
        createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
        createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
        createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
        createSqliteExecutionRepository({ startDirectory: targetDirectory }),
        createSqliteCheckRunRepository({ startDirectory: targetDirectory })
      ]);

    const result = await runWorkerPlanForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository,
      checkRunRepository,
      config,
      projectContext,
      ticketId,
      {
        providerForWorkItem: (workItem) =>
          createProviderAdapter(workItem.suggestedProviderId, getProvider(config, workItem.suggestedProviderId), {
            repositoryPath: targetDirectory
          }),
        prepareWorkspace: (input) => prepareWorkItemWorkspace(targetDirectory, input)
      }
    );

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Worker plan ${result.workerPlan.id} -> ${result.status}`);
    console.log(result.summary);
    console.log(`Integration: ${result.integrationSummary}`);

    if (result.integrationIssues.length > 0) {
      console.log("");
      console.log("Integration issues:");
      for (const issue of result.integrationIssues) {
        console.log(`- ${issue}`);
      }
    }
  });

workItemsCommand
  .command("list")
  .description("List stored work items for one ticket")
  .argument("<ticketId>", "Ticket ID")
  .option("--json", "Print work items as JSON")
  .action(async (ticketId: string, options: { json?: boolean }) => {
    const repository = await createSqliteWorkItemRepository({ startDirectory: getTargetRepositoryPath() });
    const workItems = await listWorkItemsForStoredTicket(repository, ticketId);

    if (options.json) {
      console.log(JSON.stringify(workItems, null, 2));
      return;
    }

    if (workItems.length === 0) {
      console.log(`No work items found for ticket ${ticketId}.`);
      return;
    }

    for (const workItem of workItems) {
      console.log(
        `${workItem.id} [${workItem.status}] ${workItem.title} :: ${workItem.role} :: ${workItem.branchStrategy}`
      );
    }
  });

workItemsCommand
  .command("show")
  .description("Show one stored work item")
  .argument("<workItemId>", "Work item ID")
  .option("--json", "Print the work item as JSON")
  .action(async (workItemId: string, options: { json?: boolean }) => {
    const repository = await createSqliteWorkItemRepository({ startDirectory: getTargetRepositoryPath() });
    const workItem = await getWorkItem(repository, workItemId);

    if (options.json) {
      console.log(JSON.stringify(workItem, null, 2));
      return;
    }

    console.log(`Work item ${workItem.id}`);
    console.log(`Status: ${workItem.status}`);
    console.log(`Ticket: ${workItem.ticketId}`);
    console.log(`Worker plan: ${workItem.workerPlanId}`);
    console.log(`Title: ${workItem.title}`);
    console.log(`Role: ${workItem.role}`);
    console.log(`Mode: ${workItem.suggestedMode}`);
    console.log(`Model: ${workItem.suggestedProviderId}/${workItem.suggestedModelId}`);
    console.log(`Branch strategy: ${workItem.branchStrategy}`);
    console.log(`Dependencies: ${workItem.dependsOn.join(", ") || "(none)"}`);
    console.log(`Affected areas: ${workItem.affectedAreas.join(", ") || "(none)"}`);
    console.log(`Review notes: ${workItem.reviewNotes.join(" ") || "(none)"}`);
  });

workItemsCommand
  .command("run")
  .description("Run one stored work item")
  .argument("<workItemId>", "Work item ID")
  .option("--json", "Print the work-item run result as JSON")
  .action(async (workItemId: string, options: { json?: boolean }) => {
    const targetDirectory = getTargetRepositoryPath();
    const [config, projectContext, ticketRepository, planArtifactRepository, workerPlanRepository, workItemRepository, executionRepository, checkRunRepository] =
      await Promise.all([
        loadOpenTopConfig(undefined, targetDirectory),
        loadOpenTopProjectContext(targetDirectory),
        createSqliteTicketRepository({ startDirectory: targetDirectory }),
        createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
        createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
        createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
        createSqliteExecutionRepository({ startDirectory: targetDirectory }),
        createSqliteCheckRunRepository({ startDirectory: targetDirectory })
      ]);

    const result = await runWorkItemForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository,
      checkRunRepository,
      config,
      projectContext,
      workItemId,
      {
        providerForWorkItem: (workItem) =>
          createProviderAdapter(workItem.suggestedProviderId, getProvider(config, workItem.suggestedProviderId), {
            repositoryPath: targetDirectory
          }),
        prepareWorkspace: (input) => prepareWorkItemWorkspace(targetDirectory, input)
      }
    );

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Work item ${result.workItem.id} -> ${result.status}`);
    console.log(result.reason ?? result.workerPlan.integrationSummary ?? "No additional summary.");
    if (result.execution) {
      console.log(`Execution: ${result.execution.id} (${result.execution.branchName})`);
      console.log(`Workspace: ${result.execution.workspacePath}`);
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

providersCommand
  .command("list")
  .description("List configured providers and their runtime health")
  .option("--json", "Print provider status as JSON")
  .action(async (options: { json?: boolean }) => {
    await printProviderStatuses(getTargetRepositoryPath(), options.json ?? false);
  });

providersCommand
  .command("doctor")
  .description("Show provider compatibility warnings and runtime checks")
  .option("--json", "Print provider status as JSON")
  .action(async (options: { json?: boolean }) => {
    await printProviderStatuses(getTargetRepositoryPath(), options.json ?? false);
  });

providersCommand
  .command("setup")
  .description("Interactively configure provider type, connection method, and model tiers")
  .action(async () => {
    const rl = createInterface({ input, output });

    try {
      await runProviderSetupWizard(getTargetRepositoryPath(), rl);
    } finally {
      rl.close();
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
    const targetDirectory = getTargetRepositoryPath();
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const intelligenceService = await createTicketIntelligenceServiceForDirectory(config, targetDirectory);

    if (ticketId) {
      const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
      const result = await classifyStoredTicket(repository, config, ticketId, {
        intelligenceService,
        repositoryPath: targetDirectory
      });
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
      const intelligenceService = await createTicketIntelligenceServiceForDirectory(config, targetDirectory);

      const builtPrompt = ticketId
        ? await buildPromptForStoredTicket(
            await createSqliteTicketRepository({ startDirectory: targetDirectory }),
            config,
            projectContext,
            ticketId,
            {
              planArtifactRepository: await createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
              intelligenceService,
              repositoryPath: targetDirectory
            }
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
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository, executionRepository, checkRunRepository, repositoryState] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      createSqliteCheckRunRepository({ startDirectory: targetDirectory }),
      getRepositoryStatus(targetDirectory)
    ]);
    const executionPlan = await planExecutionForStoredTicket(ticketRepository, config, ticketId);
    const provider = await createProviderAdapter(
      executionPlan.providerId,
      getProvider(config, executionPlan.providerId),
      {
        repositoryPath: targetDirectory
      }
    );
    const result = await startExecutionForStoredTicket(
      ticketRepository,
      promptReviewRepository,
      planArtifactRepository,
      executionRepository,
      checkRunRepository,
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
            blocker: result.blocker,
            reason: result.reason,
            promptReview: result.promptReview,
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
  workerPlanId?: string;
  workItemId?: string;
  profileId: string;
  providerId: string;
  modelId: string;
  status: string;
  reviewStatus?: string;
  pullRequest?: { url: string; number?: number };
  pullRequestUrl?: string;
  runKind: string;
  branchName: string;
  workspacePath: string;
  changedFiles?: string[];
  logs?: string[];
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: execution.id,
    ticketId: execution.ticketId,
    workerPlanId: execution.workerPlanId,
    workItemId: execution.workItemId,
    profileId: execution.profileId,
    providerId: execution.providerId,
    modelId: execution.modelId,
    status: execution.status,
    reviewStatus: execution.reviewStatus,
    pullRequest: execution.pullRequest,
    pullRequestUrl: execution.pullRequestUrl,
    runKind: execution.runKind,
    branchName: execution.branchName,
    workspacePath: execution.workspacePath,
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

function connectionMethodsForProviderType(providerType: string): ProviderConnectionMethod[] {
  switch (providerType) {
    case "codex-cli":
      return ["local_cli"];
    case "openai-codex":
      return ["oauth"];
    case "openai-api":
    case "deepseek-api":
    case "anthropic-api":
    case "openrouter-api":
      return ["api_key", "oauth"];
    case "custom-shell":
      return ["custom_command"];
    case "ollama":
      return ["local_model"];
    default:
      return ["local_cli", "api_key", "oauth", "custom_command", "local_model"];
  }
}

function defaultConnectionMethodForProviderType(providerType: string): ProviderConnectionMethod {
  switch (providerType) {
    case "openai-codex":
      return "oauth";
    case "openai-api":
    case "deepseek-api":
    case "anthropic-api":
    case "openrouter-api":
      return "api_key";
    case "custom-shell":
      return "custom_command";
    case "ollama":
      return "local_model";
    default:
      return "local_cli";
  }
}

function defaultCommandForProvider(providerType: string, connectionMethod: ProviderConnectionMethod): string | undefined {
  if (providerType === "codex-cli" && connectionMethod === "local_cli") {
    return "codex";
  }

  if (providerType === "custom-shell" && connectionMethod === "custom_command") {
    return "echo";
  }

  return undefined;
}

function defaultApiKeyEnvForProvider(providerType: string, connectionMethod: ProviderConnectionMethod): string | undefined {
  if (connectionMethod !== "api_key") {
    return undefined;
  }

  if (providerType === "openrouter-api") {
    return "OPENROUTER_API_KEY";
  }

  if (providerType === "deepseek-api") {
    return "DEEPSEEK_API_KEY";
  }

  if (providerType === "anthropic-api") {
    return "ANTHROPIC_API_KEY";
  }

  return "OPENAI_API_KEY";
}

function defaultOauthProviderForType(providerType: string, connectionMethod: ProviderConnectionMethod): string | undefined {
  if (connectionMethod !== "oauth") {
    return undefined;
  }

  if (providerType === "codex-cli") {
    return "chatgpt";
  }

  if (providerType === "openai-codex") {
    return "openai-codex";
  }

  if (providerType === "openai-api") {
    return "openai";
  }

  if (providerType === "anthropic-api") {
    return "anthropic";
  }

  return providerType.replace(/-api$/u, "");
}

function defaultBaseUrlForType(providerType: string, connectionMethod: ProviderConnectionMethod): string | undefined {
  if (providerType === "ollama" || connectionMethod === "local_model") {
    return "http://127.0.0.1:11434";
  }

  if (providerType === "openrouter-api") {
    return "https://openrouter.ai/api/v1";
  }

  if (providerType === "deepseek-api") {
    return "https://api.deepseek.com/v1";
  }

  if (providerType === "anthropic-api") {
    return "https://api.anthropic.com/v1";
  }

  return undefined;
}

function defaultModelForTier(providerType: string, tier: "cheap" | "strong" | "local"): string | undefined {
  if (providerType === "codex-cli") {
    return tier === "cheap" ? "gpt-5.4-mini" : "gpt-5.5";
  }

  if (providerType === "openai-api") {
    return tier === "cheap" ? "gpt-5.4-mini" : "gpt-5.5";
  }

  if (providerType === "openai-codex") {
    return tier === "cheap" ? "gpt-5.4-mini" : "gpt-5.5";
  }

  if (providerType === "openrouter-api") {
    return tier === "cheap" ? "openai/gpt-5.4-mini" : "openai/gpt-5.5";
  }

  if (providerType === "deepseek-api") {
    return tier === "cheap" ? "deepseek-chat" : "deepseek-reasoner";
  }

  if (providerType === "anthropic-api") {
    return "claude-sonnet";
  }

  if (providerType === "ollama") {
    return "llama3.1:latest";
  }

  return undefined;
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
        "[3] Provider setup",
        "[4] Back"
      ]);
      const choice = await safeQuestion(rl, colorize("Choose an action: ", "cyan"));

      if (choice === undefined) {
        return;
      }

      if (choice === "4" || choice.toLowerCase() === "back") {
        return;
      }

      if (choice === "3") {
        await runProviderSetupWizard(targetDirectory, rl);
        continue;
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

async function runProviderSetupWizard(
  targetDirectory: string,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  printSection("Provider Setup");
  printMuted("Provider type and connection method are separate. Secrets stay out of project config.");

  const providerId =
    (await safeQuestion(rl, colorize("Provider ID [codex]: ", "cyan"))) || "codex";
  const providerType = await chooseFromList(
    rl,
    "Provider type",
    ["codex-cli", "openai-codex", "openai-api", "deepseek-api", "openrouter-api", "anthropic-api", "custom-shell", "ollama"],
    "codex-cli"
  );
  const connectionMethod = await chooseFromList(
    rl,
    "Connection method",
    connectionMethodsForProviderType(providerType),
    defaultConnectionMethodForProviderType(providerType)
  );

  const command = await promptOptionalField(
    rl,
    "Command",
    defaultCommandForProvider(providerType, connectionMethod)
  );
  const apiKeyEnv = await promptOptionalField(
    rl,
    "API key env",
    defaultApiKeyEnvForProvider(providerType, connectionMethod)
  );
  const oauthProvider = await promptOptionalField(
    rl,
    "OAuth provider",
    defaultOauthProviderForType(providerType, connectionMethod)
  );
  const baseUrl = await promptOptionalField(
    rl,
    "Base URL",
    defaultBaseUrlForType(providerType, connectionMethod)
  );
  const cheapModel = await promptOptionalField(
    rl,
    "Cheap model",
    defaultModelForTier(providerType, "cheap")
  );
  const strongModel = await promptOptionalField(
    rl,
    "Strong model",
    defaultModelForTier(providerType, "strong")
  );
  const localModel = await promptOptionalField(
    rl,
    "Local model",
    defaultModelForTier(providerType, "local")
  );

  const targetPath = await saveProviderSetup(
    {
      providerId,
      type: providerType,
      connectionMethod,
      command: command || undefined,
      apiKeyEnv: apiKeyEnv || undefined,
      oauthProvider: oauthProvider || undefined,
      baseUrl: baseUrl || undefined,
      modelMappings: {
        ...(cheapModel ? { cheap: cheapModel } : {}),
        ...(strongModel ? { strong: strongModel } : {}),
        ...(localModel ? { local: localModel } : {})
      }
    },
    targetDirectory
  );
  printSuccess(`Updated provider config in ${targetPath}`);
  console.log("");
  await printProviderStatuses(targetDirectory, false);
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

async function chooseFromList<T extends string>(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options: readonly T[],
  fallback: T
): Promise<T> {
  console.log("");
  printSection(label);
  printBulletList(options.map((option, index) => `${index + 1}. ${option}`));

  while (true) {
    const raw =
      (await safeQuestion(rl, colorize(`Choose ${label.toLowerCase()} [${fallback}]: `, "cyan"))) || fallback;
    const byIndex = Number(raw);

    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
      return options[byIndex - 1];
    }

    if (options.includes(raw as T)) {
      return raw as T;
    }

    printWarning(`Unknown ${label.toLowerCase()} "${raw}".`);
  }
}

async function promptOptionalField(
  rl: ReturnType<typeof createInterface>,
  label: string,
  fallback?: string
): Promise<string> {
  const raw = await safeQuestion(
    rl,
    colorize(`${label}${fallback ? ` [${fallback}]` : ""}: `, "cyan")
  );

  return raw && raw.length > 0 ? raw : fallback ?? "";
}

async function yesNoQuestion(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue: boolean
): Promise<boolean> {
  const raw = (await safeQuestion(rl, colorize(prompt, "cyan"))) ?? "";

  if (raw.length === 0) {
    return defaultValue;
  }

  const normalized = raw.toLowerCase();

  if (normalized === "y" || normalized === "yes" || normalized === "j" || normalized === "ja") {
    return true;
  }

  if (normalized === "n" || normalized === "no" || normalized === "nein") {
    return false;
  }

  printWarning(`Unknown answer "${raw}", using ${defaultValue ? "yes" : "no"}.`);
  return defaultValue;
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
  const providers = await inspectConfiguredProviders(config, {
    inspect: (providerId, definition, modelTiers) =>
      inspectProviderRuntime(providerId, definition, modelTiers, { repositoryPath: targetDirectory })
  });
  const providerWarnings = providers.filter((provider) => provider.status !== "ready").length;

  printSection("Status");
  printKeyValueRows([
    ["Repository", targetDirectory],
    ["Project", config.project.name],
    ["Default Branch", config.project.defaultBranch],
    ["Branch Policy", config.execution.defaultBranchPolicy],
    ["Current Branch", repositoryStatus.currentBranch],
    ["Working Tree", repositoryStatus.isClean ? colorize("clean", "green") : colorize("dirty", "yellow")],
    ["Stored Tickets", String(tickets.length)],
    ["Stored Executions", String(executions.length)],
    [
      "Providers",
      providerWarnings > 0
        ? `${providers.length} configured, ${colorize(String(providerWarnings), "yellow")} need attention`
        : `${providers.length} configured, ${colorize("all ready", "green")}`
    ]
  ]);

  if (repositoryStatus.changedFiles.length > 0) {
    console.log("");
    printSubsection("Changed Files");
    printBulletList(repositoryStatus.changedFiles);
  }
}

async function printProviderStatuses(targetDirectory: string, asJson: boolean): Promise<void> {
  const config = await loadOpenTopConfig(undefined, targetDirectory);
  const providers = await inspectConfiguredProviders(config, {
    inspect: (providerId, definition, modelTiers) =>
      inspectProviderRuntime(providerId, definition, modelTiers, { repositoryPath: targetDirectory })
  });

  if (asJson) {
    console.log(JSON.stringify(providers, null, 2));
    return;
  }

  if (providers.length === 0) {
    printMuted("No providers configured.");
    return;
  }

  printSection("Providers");
  printTable(
    ["ID", "Type", "Connection", "Status", "Models", "Command"],
    providers.map((provider) => [
      provider.providerId,
      provider.type,
      provider.connectionMethod,
      formatProviderStatus(provider.status),
      provider.modelTiers.length === 0
        ? colorize("(none)", "gray")
        : provider.modelTiers.map((modelTier) => `${modelTier.tier}=${modelTier.model}`).join(", "),
      provider.command ?? "(none)"
    ])
  );

  for (const provider of providers) {
    console.log("");
    printSubsection(`${provider.providerId} details`);
    printKeyValueRows([
      ["Connection", provider.connectionMethod],
      ["Available", provider.available ? colorize("yes", "green") : colorize("no", "red")],
      ["Version", provider.version ?? "(unknown)"],
      ["API key env", provider.apiKeyEnv ?? "(none)"],
      ["OAuth provider", provider.oauthProvider ?? "(none)"],
      ["Connection state", provider.connectionState.label],
      ["Base URL", provider.baseUrl ?? "(none)"],
      [
        "Capabilities",
        [
          ...provider.capabilities.authMethods,
          provider.capabilities.supportsStructuredOutput ? "structured" : "",
          provider.capabilities.supportsLocalWorkspace ? "workspace" : "",
          provider.capabilities.supportsMultiRunOrchestration ? "multi-run" : ""
        ]
          .filter(Boolean)
          .join(", ") || "(none)"
      ]
    ]);

    if (provider.issues.length > 0) {
      printBulletList(
        provider.issues.map((issue) => `[${issue.severity}] ${issue.message}`)
      );
    } else {
      printBulletList(["No provider issues detected."]);
    }
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

function deriveProjectDisplayName(targetDirectory: string): string {
  const label = basename(resolve(targetDirectory));
  return label.length > 0 ? label : "OpenTop Project";
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

async function prepareWorkItemWorkspace(
  targetDirectory: string,
  input: {
    workItem: { key: string; branchStrategy: string };
    workerPlan: { executionPlanSnapshot: { branchName: string } };
    dependencyExecutions: Array<{ branchName: string }>;
  }
) {
  const branchName = deriveWorkItemBranchName(input);
  const preparedWorktree = await ensureBranchWorktree(targetDirectory, branchName);
  const workspace = new GitExecutionWorkspace(preparedWorktree.repositoryPath);
  const repositoryState = await workspace.getRepositoryState();

  return {
    branchName,
    repositoryPath: preparedWorktree.repositoryPath,
    repositoryState,
    logs: preparedWorktree.logs,
    strategy: input.workItem.branchStrategy as "isolated_worktree" | "shared_ticket_branch" | "reuse_parent_branch",
    workspace
  };
}

function deriveWorkItemBranchName(input: {
  workItem: { key: string; branchStrategy: string };
  workerPlan: { executionPlanSnapshot: { branchName: string } };
  dependencyExecutions: Array<{ branchName: string }>;
}): string {
  const ticketBranch = input.workerPlan.executionPlanSnapshot.branchName;

  if (input.workItem.branchStrategy === "reuse_parent_branch") {
    return input.dependencyExecutions[0]?.branchName && input.dependencyExecutions[0].branchName !== "none"
      ? input.dependencyExecutions[0].branchName
      : ticketBranch;
  }

  if (input.workItem.branchStrategy === "shared_ticket_branch") {
    return ticketBranch;
  }

  return `${ticketBranch}--${sanitizeBranchSuffix(input.workItem.key)}`;
}

function sanitizeBranchSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
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
      case "providers":
        await executeProvidersShellCommand(rest, targetDirectory, rl);
        return true;
      case "worker-plans":
        await executeWorkerPlansShellCommand(rest, targetDirectory);
        return true;
      case "work-items":
        await executeWorkItemsShellCommand(rest, targetDirectory);
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

async function executeWorkerPlansShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const subcommand = tokens[0];

  if (subcommand === "show") {
    const ticketId = tokens[1];

    if (!ticketId) {
      throw new Error("Missing ticket ID. Use `worker-plans show <ticketId> [--json]`.");
    }

    const [workerPlanRepository, workItemRepository, executionRepository] = await Promise.all([
      createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
      createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [workerPlans, workItems] = await Promise.all([
      listWorkerPlansForStoredTicket(workerPlanRepository, ticketId),
      listWorkItemsForStoredTicket(workItemRepository, ticketId)
    ]);
    const workerPlan = workerPlans[0] ?? null;

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify({ workerPlan, workerPlans, workItems }, null, 2));
      return;
    }

    if (!workerPlan) {
      console.log(`No worker plan found for ticket ${ticketId}.`);
      return;
    }

    const executions = await listExecutionsForStoredWorkerPlan(executionRepository, workerPlan.id);

    console.log(`Worker plan ${workerPlan.id} (v${workerPlan.version})`);
    console.log(`Status: ${workerPlan.status}`);
    console.log(`Summary: ${workerPlan.summary ?? "(none)"}`);
    console.log(`Integration: ${workerPlan.integrationSummary ?? "(none)"}`);
    console.log(`Reviewer comment: ${workerPlan.reviewerComment ?? "(none)"}`);

    for (const workItem of workItems.filter((entry) => entry.workerPlanId === workerPlan.id)) {
      const latestExecution = executions.find((execution) => execution.workItemId === workItem.id);
      console.log(
        `- ${workItem.id} [${workItem.status}] ${workItem.title} :: ${workItem.role} :: ${workItem.suggestedProviderId}/${workItem.suggestedModelId}${latestExecution ? ` :: exec ${latestExecution.id}` : ""}`
      );
    }
    return;
  }

  if (subcommand === "run") {
    const ticketId = tokens[1];

    if (!ticketId) {
      throw new Error("Missing ticket ID. Use `worker-plans run <ticketId> [--json]`.");
    }

    const [config, projectContext, ticketRepository, planArtifactRepository, workerPlanRepository, workItemRepository, executionRepository, checkRunRepository] =
      await Promise.all([
        loadOpenTopConfig(undefined, targetDirectory),
        loadOpenTopProjectContext(targetDirectory),
        createSqliteTicketRepository({ startDirectory: targetDirectory }),
        createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
        createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
        createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
        createSqliteExecutionRepository({ startDirectory: targetDirectory }),
        createSqliteCheckRunRepository({ startDirectory: targetDirectory })
      ]);
    const result = await runWorkerPlanForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository,
      checkRunRepository,
      config,
      projectContext,
      ticketId,
      {
        providerForWorkItem: (workItem) =>
          createProviderAdapter(workItem.suggestedProviderId, getProvider(config, workItem.suggestedProviderId), {
            repositoryPath: targetDirectory
          }),
        prepareWorkspace: (input) => prepareWorkItemWorkspace(targetDirectory, input)
      }
    );

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Worker plan ${result.workerPlan.id} -> ${result.status}`);
    console.log(result.summary);
    return;
  }

  throw new Error("Unsupported worker-plans command. Use `worker-plans show <ticketId>` or `worker-plans run <ticketId>`.");
}

async function executeWorkItemsShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const subcommand = tokens[0];

  if (subcommand === "list") {
    const ticketId = tokens[1];

    if (!ticketId) {
      throw new Error("Missing ticket ID. Use `work-items list <ticketId> [--json]`.");
    }

    const repository = await createSqliteWorkItemRepository({ startDirectory: targetDirectory });
    const workItems = await listWorkItemsForStoredTicket(repository, ticketId);

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify(workItems, null, 2));
      return;
    }

    if (workItems.length === 0) {
      console.log(`No work items found for ticket ${ticketId}.`);
      return;
    }

    for (const workItem of workItems) {
      console.log(`${workItem.id} [${workItem.status}] ${workItem.title} :: ${workItem.role} :: ${workItem.branchStrategy}`);
    }
    return;
  }

  if (subcommand === "show") {
    const workItemId = tokens[1];

    if (!workItemId) {
      throw new Error("Missing work item ID. Use `work-items show <id> [--json]`.");
    }

    const repository = await createSqliteWorkItemRepository({ startDirectory: targetDirectory });
    const workItem = await getWorkItem(repository, workItemId);

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify(workItem, null, 2));
      return;
    }

    console.log(`Work item ${workItem.id}`);
    console.log(`Status: ${workItem.status}`);
    console.log(`Title: ${workItem.title}`);
    console.log(`Role: ${workItem.role}`);
    console.log(`Mode: ${workItem.suggestedMode}`);
    console.log(`Model: ${workItem.suggestedProviderId}/${workItem.suggestedModelId}`);
    console.log(`Branch strategy: ${workItem.branchStrategy}`);
    console.log(`Dependencies: ${workItem.dependsOn.join(", ") || "(none)"}`);
    console.log(`Affected areas: ${workItem.affectedAreas.join(", ") || "(none)"}`);
    console.log(`Review notes: ${workItem.reviewNotes.join(" ") || "(none)"}`);
    return;
  }

  if (subcommand === "run") {
    const workItemId = tokens[1];

    if (!workItemId) {
      throw new Error("Missing work item ID. Use `work-items run <id> [--json]`.");
    }

    const [config, projectContext, ticketRepository, planArtifactRepository, workerPlanRepository, workItemRepository, executionRepository, checkRunRepository] =
      await Promise.all([
        loadOpenTopConfig(undefined, targetDirectory),
        loadOpenTopProjectContext(targetDirectory),
        createSqliteTicketRepository({ startDirectory: targetDirectory }),
        createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
        createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
        createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
        createSqliteExecutionRepository({ startDirectory: targetDirectory }),
        createSqliteCheckRunRepository({ startDirectory: targetDirectory })
      ]);
    const result = await runWorkItemForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository,
      checkRunRepository,
      config,
      projectContext,
      workItemId,
      {
        providerForWorkItem: (workItem) =>
          createProviderAdapter(workItem.suggestedProviderId, getProvider(config, workItem.suggestedProviderId), {
            repositoryPath: targetDirectory
          }),
        prepareWorkspace: (input) => prepareWorkItemWorkspace(targetDirectory, input)
      }
    );

    if (hasFlag(tokens.slice(2), "--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Work item ${result.workItem.id} -> ${result.status}`);
    console.log(result.reason ?? result.workerPlan.integrationSummary ?? "(no summary)");
    if (result.execution) {
      console.log(`Execution: ${result.execution.id}`);
    }
    return;
  }

  throw new Error("Unsupported work-items command. Use `work-items list <ticketId>`, `work-items show <id>`, or `work-items run <id>`.");
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
      ["Review", execution.reviewStatus ?? "not_required"],
      ["Ticket", execution.ticketId],
      ["Branch", execution.branchName],
      ["Profile", execution.profileId],
      ["Model", `${execution.providerId}/${execution.modelId}`],
      ["Draft PR", execution.pullRequestUrl ?? "none"],
      ["Created", execution.createdAt]
    ]);
    return;
  }

  throw new Error("Unsupported executions command. Use `executions list` or `executions show <id>`.");
}

async function executeProvidersShellCommand(
  tokens: string[],
  targetDirectory: string,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const subcommand = tokens[0];
  const json = hasFlag(tokens.slice(1), "--json");

  if (subcommand === "list" || subcommand === "doctor") {
    await printProviderStatuses(targetDirectory, json);
    return;
  }

  if (subcommand === "setup") {
    await runProviderSetupWizard(targetDirectory, rl);
    return;
  }

  throw new Error("Unsupported providers command. Use `providers list`, `providers doctor`, or `providers setup`.");
}

async function executeClassifyShellCommand(tokens: string[], targetDirectory: string): Promise<void> {
  const ticketId = tokens[0];

  if (!ticketId) {
    throw new Error("Usage: classify <ticketId>");
  }

  const config = await loadOpenTopConfig(undefined, targetDirectory);
  const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
  const intelligenceService = await createTicketIntelligenceServiceForDirectory(config, targetDirectory);
  const result = await classifyStoredTicket(repository, config, ticketId, {
    intelligenceService,
    repositoryPath: targetDirectory
  });
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
  const intelligenceService = await createTicketIntelligenceServiceForDirectory(config, targetDirectory);
  const builtPrompt = await buildPromptForStoredTicket(repository, config, projectContext, ticketId, {
    planArtifactRepository: await createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
    intelligenceService,
    repositoryPath: targetDirectory
  });

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
  const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository, executionRepository, checkRunRepository, repositoryState] = await Promise.all([
    loadOpenTopConfig(undefined, targetDirectory),
    loadOpenTopProjectContext(targetDirectory),
    createSqliteTicketRepository({ startDirectory: targetDirectory }),
    createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
    createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
    createSqliteExecutionRepository({ startDirectory: targetDirectory }),
    createSqliteCheckRunRepository({ startDirectory: targetDirectory }),
    getRepositoryStatus(targetDirectory)
  ]);
  const intelligenceService = await createTicketIntelligenceServiceForDirectory(config, targetDirectory);
  const executionPlan = await planExecutionForStoredTicket(ticketRepository, config, ticketId, {
    intelligenceService,
    repositoryPath: targetDirectory
  });
  const provider = await createProviderAdapter(
    executionPlan.providerId,
    getProvider(config, executionPlan.providerId),
    {
      repositoryPath: targetDirectory
    }
  );
  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    new GitExecutionWorkspace(targetDirectory),
    provider,
    config,
    projectContext,
    ticketId,
    repositoryState,
    branchPolicy,
    {
      intelligenceService
    }
  );

  if (result.status === "blocked") {
    printSection("Execution Blocked");
    printKeyValueRows([
      ["Ticket", result.executionPlan.ticket.id],
      ["Profile", result.executionPlan.profile.id],
      ["Blocker", result.blocker],
      ["Requested Branch", result.executionPlan.branchName],
      ["Decision", formatBranchDecision(result.branchResolution.decision)],
      ["Policy", result.branchResolution.policy],
      ["Reason", result.reason]
    ]);
    if (result.promptReview) {
      console.log("");
      printSubsection("Prompt Review");
      printKeyValueRows([
        ["Version", `v${result.promptReview.version}`],
        ["Status", result.promptReview.status],
        ["Updated", result.promptReview.updatedAt]
      ]);
    }
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

  printSection(result.status === "output_ready" ? "Review Output Ready" : "Execution Succeeded");
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
  if (result.execution.changedFiles.length === 0 && result.execution.artifactKind === "review_output") {
    printBulletList(["No local workspace changes were applied. Review the stored output before applying changes."]);
  } else {
    printBulletList(result.execution.changedFiles);
  }
  if (result.execution.outputText) {
    console.log("");
    printSubsection("Review Output");
    printKeyValueRows([["Kind", formatOutputKind(result.execution.outputKind)]]);
    printBulletList([previewText(result.execution.outputText)]);

    const referencedFiles = extractReferencedFiles(result.execution.outputText);

    if (referencedFiles.length > 0) {
      console.log("");
      printSubsection("Referenced Files");
      printBulletList(referencedFiles);
    }

    console.log("");
    printSubsection("Next Steps");
    printBulletList(buildNextActionHints(result.execution.outputKind));
  }
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

  if (status === "output_ready") {
    return colorize(status, "yellow");
  }

  if (status === "running" || status === "queued") {
    return colorize(status, "blue");
  }

  if (status === "failed" || status === "cancelled") {
    return colorize(status, "red");
  }

  return colorize(status, "gray");
}

function formatOutputKind(value: string | undefined): string {
  if (!value) {
    return "(not set)";
  }

  if (value === "patch_proposal") {
    return "patch proposal";
  }

  if (value === "review_note") {
    return "review note";
  }

  return value.replace(/_/g, " ");
}

function previewText(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function extractReferencedFiles(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:diff --git a\/|--- a\/|\+\+\+ b\/)([A-Za-z0-9._/-]+)/g),
    ...text.matchAll(/`([A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)`/g)
  ];

  return [...new Set(matches.map((match) => match[1]).filter(Boolean))].slice(0, 10);
}

function buildNextActionHints(outputKind: string | undefined): string[] {
  if (outputKind === "plan") {
    return [
      "Validate the scope and order of work before starting implementation.",
      "Turn the approved plan into a follow-up execution or work items."
    ];
  }

  if (outputKind === "patch_proposal") {
    return [
      "Inspect the referenced files before converting this proposal into local changes.",
      "Confirm whether tests or review notes are still missing."
    ];
  }

  if (outputKind === "review_note") {
    return [
      "Use this note to adjust the ticket, prompt, or routing choice.",
      "Start a code-changing run only after the concerns are understood."
    ];
  }

  return [
    "Review the output and decide whether the next step should plan, implement, or stay in review mode."
  ];
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

function formatProviderStatus(status: string): string {
  if (status === "ready") {
    return colorize(status, "green");
  }

  if (status === "warning") {
    return colorize(status, "yellow");
  }

  return colorize(status, "red");
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

async function createTicketIntelligenceServiceForDirectory(
  config: Awaited<ReturnType<typeof loadOpenTopConfig>>,
  targetDirectory: string
): Promise<TicketIntelligenceService | undefined> {
  const tier = config.models.cheap ? "cheap" : Object.keys(config.models)[0];

  if (!tier) {
    return undefined;
  }

  const model = getModel(config, tier);

  try {
    const provider = await createProviderAdapter(model.provider, getProvider(config, model.provider), {
      repositoryPath: targetDirectory
    });

    return createAiTicketIntelligenceService({
      providerId: model.provider,
      model: model.model,
      executionProvider: provider
    });
  } catch {
    return undefined;
  }
}
