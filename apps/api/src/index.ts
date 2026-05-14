import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { z } from "zod";
import {
  buildPromptForStoredTicket,
  classifyStoredTicket,
  createExecutionPlan,
  createTicket,
  getProvider,
  getConfigValue,
  getExecution,
  listExecutions,
  listTickets,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  planExecutionForStoredTicket,
  setConfigValue,
  startExecutionForStoredTicket,
  type ExecutionBranchPolicy,
  type OpenTopConfigScope,
  type Ticket
} from "@opentop/core";
import { createSqliteExecutionRepository, createSqliteTicketRepository } from "@opentop/db";
import { getRepositoryStatus, GitExecutionWorkspace } from "@opentop/git";
import { createProviderAdapter } from "@opentop/providers";

const repoQuerySchema = z.object({
  repoPath: z.string().optional()
});

const createTicketBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  labels: z.array(z.string()).default([]),
  source: z.enum(["manual", "github", "linear", "jira", "trello", "azure-devops"]).default("manual"),
  externalId: z.string().optional()
});

const updateConfigBodySchema = z.object({
  key: z.literal("execution.defaultBranchPolicy"),
  value: z.enum(["new", "reuse-current", "manual", "none"]),
  scope: z.enum(["project", "user"]).default("project")
});

const runTicketBodySchema = z.object({
  branchPolicy: z.enum(["new", "reuse-current", "manual", "none"]).optional()
});

type WorkflowStage = "Inbox" | "Classified" | "Ready" | "Running" | "Review" | "Done";

export function buildServer() {
  const server = Fastify({ logger: true });

  server.get("/health", async () => ({
    ok: true,
    service: "opentop-api"
  }));

  server.get("/status", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const [config, repositoryStatus, ticketRepository, executionRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      getRepositoryStatus(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [tickets, executions] = await Promise.all([listTickets(ticketRepository), listExecutions(executionRepository)]);

    return {
      repository: targetDirectory,
      project: config.project.name,
      defaultBranch: config.project.defaultBranch,
      branchPolicy: config.execution.defaultBranchPolicy,
      currentBranch: repositoryStatus.currentBranch,
      isClean: repositoryStatus.isClean,
      changedFiles: repositoryStatus.changedFiles,
      storedTickets: tickets.length,
      storedExecutions: executions.length
    };
  });

  server.get("/config", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const [effective, project, user] = await Promise.all([
      getConfigValue("execution.defaultBranchPolicy", "effective", targetDirectory),
      getConfigValue("execution.defaultBranchPolicy", "project", targetDirectory),
      getConfigValue("execution.defaultBranchPolicy", "user", targetDirectory)
    ]);

    return {
      repository: targetDirectory,
      project: config.project.name,
      execution: {
        defaultBranchPolicy: {
          effective,
          project,
          user
        }
      }
    };
  });

  server.put("/config", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const body = updateConfigBodySchema.parse(request.body);
    const targetPath = await setConfigValue(body.key, body.value, body.scope, targetDirectory);

    return {
      ok: true,
      targetPath,
      key: body.key,
      value: body.value,
      scope: body.scope
    };
  });

  server.get("/tickets", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const [config, ticketRepository, executionRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [tickets, executions] = await Promise.all([listTickets(ticketRepository), listExecutions(executionRepository)]);

    return {
      tickets: tickets.map((ticket) => enrichTicketSummary(ticket, config, executions))
    };
  });

  server.post("/tickets", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const body = createTicketBodySchema.parse(request.body);
    const repository = await createSqliteTicketRepository({ startDirectory: targetDirectory });
    const ticket = await createTicket(repository, {
      title: body.title,
      description: body.description,
      labels: body.labels,
      source: body.source,
      externalId: body.externalId
    });

    return {
      ticket
    };
  });

  server.get("/tickets/:ticketId", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const [config, projectContext, ticketRepository, executionRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [classifiedTicket, prompt, executions] = await Promise.all([
      classifyStoredTicket(ticketRepository, config, ticketId),
      buildPromptForStoredTicket(ticketRepository, config, projectContext, ticketId),
      executionRepository.listByTicketId(ticketId)
    ]);
    const ticket = enrichTicketSummary(classifiedTicket.ticket, config, executions);

    return {
      ticket,
      classification: classifiedTicket.classification,
      executionPlan: classifiedTicket.executionPlan,
      prompt,
      executions
    };
  });

  server.post("/tickets/:ticketId/classify", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const [config, ticketRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory })
    ]);

    return classifyStoredTicket(ticketRepository, config, ticketId);
  });

  server.get("/tickets/:ticketId/prompt", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const [config, projectContext, ticketRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory })
    ]);

    return buildPromptForStoredTicket(ticketRepository, config, projectContext, ticketId);
  });

  server.post("/tickets/:ticketId/run", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = runTicketBodySchema.parse(request.body ?? {});
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
      body.branchPolicy
    );

    return result;
  });

  server.get("/executions", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });

    return {
      executions: await listExecutions(repository)
    };
  });

  server.get("/executions/:executionId", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const executionId = z.object({ executionId: z.string() }).parse(request.params).executionId;
    const repository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });

    return {
      execution: await getExecution(repository, executionId)
    };
  });

  server.post("/classify", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const body = z
      .object({
        id: z.string().default("manual-1"),
        title: z.string(),
        description: z.string().default(""),
        labels: z.array(z.string()).default([])
      })
      .parse(request.body);
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const ticket: Ticket = {
      id: body.id,
      source: "manual",
      title: body.title,
      description: body.description,
      labels: body.labels,
      status: "inbox"
    };
    const classification = classifyStoredTicketForManual(ticket, config);

    return classification;
  });

  return server;
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFile) {
  const server = buildServer();
  const port = Number(process.env.PORT ?? 4317);

  await server.listen({ port, host: "0.0.0.0" });
}

function resolveTargetDirectory(query: unknown): string {
  const parsed = repoQuerySchema.parse(query);
  return parsed.repoPath ?? process.env.OPENTOP_REPO_PATH ?? process.cwd();
}

function classifyStoredTicketForManual(ticket: Ticket, config: OpenTopConfigForManual) {
  const executionPlan = createExecutionPlan(ticket, config);
  return {
    ticket,
    classification: executionPlan.classification,
    executionPlan
  };
}

type OpenTopConfigForManual = Awaited<ReturnType<typeof loadOpenTopConfig>>;

function enrichTicketSummary(ticket: Ticket, config: OpenTopConfigForManual, executions: Awaited<ReturnType<typeof listExecutions>>) {
  const executionPlan = createExecutionPlan(ticket, config);
  const latestExecution = executions.find((execution) => execution.ticketId === ticket.id);

  return {
    ...ticket,
    classification: executionPlan.classification,
    executionPlan,
    latestExecution,
    workflowStage: deriveWorkflowStage(executionPlan.classification.approvalRequired, latestExecution)
  };
}

function deriveWorkflowStage(
  approvalRequired: boolean,
  latestExecution: Awaited<ReturnType<typeof listExecutions>>[number] | undefined
): WorkflowStage {
  if (!latestExecution) {
    return approvalRequired ? "Ready" : "Classified";
  }

  if (latestExecution.status === "planned" || latestExecution.status === "queued" || latestExecution.status === "running") {
    return "Running";
  }

  if (latestExecution.status === "succeeded") {
    return "Review";
  }

  return "Classified";
}
