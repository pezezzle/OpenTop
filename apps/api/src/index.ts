import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { z } from "zod";
import {
  approvePlanArtifactForStoredTicket,
  approveExecutionReview,
  approvePromptReviewForStoredTicket,
  buildPromptForStoredTicket,
  classifyStoredTicket,
  createExecutionPlan,
  createDraftPullRequestForExecution,
  createTicket,
  generateWorkerPlanForStoredTicket,
  getWorkItem,
  getProvider,
  getConfigValue,
  getContextSettingsScopes,
  getExecution,
  listCheckRunsForStoredExecution,
  listExecutionsForStoredWorkerPlan,
  inspectConfiguredProviders,
  listPlanArtifactsForStoredTicket,
  listExecutions,
  listTickets,
  listPromptReviewsForStoredTicket,
  listWorkerPlansForStoredTicket,
  listWorkItemsForStoredTicket,
  loadAvailableContextProfiles,
  loadOpenTopConfig,
  loadOpenTopProjectContext,
  planExecutionForStoredTicket,
  preparePromptReviewForStoredTicket,
  regeneratePlanArtifactForStoredTicket,
  regeneratePromptReviewForStoredTicket,
  rejectPlanArtifactForStoredTicket,
  rejectExecutionReview,
  rejectPromptReviewForStoredTicket,
  reopenStoredTicket,
  resolveStoredTicket,
  runWorkerPlanForStoredTicket,
  runWorkItemForStoredTicket,
  saveContextSettings,
  saveProviderSetup,
  setConfigValue,
  startExecutionForStoredTicket,
  type ExecutionBranchPolicy,
  type OpenTopConfigScope,
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
import {
  cancelOauthFlow,
  completeOauthFlow,
  createProviderAdapter,
  disconnectOauthConnection,
  inspectProviderRuntime,
  startOauthFlow
} from "@opentop/providers";
import { createGitHubPullRequestService } from "./github-pull-request.js";

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
  key: z.enum(["execution.defaultBranchPolicy", "context.profileMode"]),
  value: z.string().min(1),
  scope: z.enum(["project", "user"]).default("project")
});

const updateContextBodySchema = z.object({
  learnedProfiles: z.array(z.string()).default([]),
  userProfiles: z.array(z.string()).default([]),
  profileMode: z.enum(["project-first", "profile-first", "project-only", "profile-only", "manual"]),
  maxPromptProfileWords: z.number().int().positive(),
  maxProfileSections: z.number().int().positive(),
  scope: z.enum(["project", "user"]).default("project")
});

const updateProviderBodySchema = z.object({
  type: z.string().min(1),
  connectionMethod: z.enum(["local_cli", "api_key", "oauth", "custom_command", "local_model"]),
  command: z.string().trim().optional(),
  apiKeyEnv: z.string().trim().optional(),
  oauthProvider: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  modelMappings: z.record(z.string(), z.string()).default({})
});

const oauthExchangeBodySchema = z.object({
  sessionId: z.string().min(1),
  code: z.string().trim().optional(),
  error: z.string().trim().optional(),
  errorDescription: z.string().trim().optional()
});

const runTicketBodySchema = z.object({
  branchPolicy: z.enum(["new", "reuse-current", "manual", "none"]).optional()
});

const promptReviewCommentBodySchema = z.object({
  reviewerComment: z.string().trim().optional()
});

const executionReviewBodySchema = z.object({
  reviewerComment: z.string().trim().optional(),
  overrideFailedChecks: z.boolean().default(false)
});

const pullRequestBodySchema = z.object({
  overrideFailedChecks: z.boolean().default(false)
});

const resolveTicketBodySchema = z.object({
  resolutionType: z.enum(["done", "manual_pr", "no_pr"]),
  resolutionNote: z.string().trim().optional()
});

type WorkflowStage = "Inbox" | "Classified" | "Ready" | "Running" | "Review" | "Done";

export function buildServer() {
  const server = Fastify({ logger: true });

  server.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      ok: false,
      error: `Not Found`,
      path: request.url
    });
  });

  server.setErrorHandler(async (error, _request, reply) => {
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Number((error as { statusCode?: unknown }).statusCode)
        : error instanceof z.ZodError
          ? 400
          : 500;

    if (statusCode >= 500) {
      server.log.error(error);
    }

    return reply.code(statusCode).send({
      ok: false,
      error: formatApiError(error)
    });
  });

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

  server.get("/context", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const [contextSettings, projectContext, availableProfiles] = await Promise.all([
      getContextSettingsScopes(targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      loadAvailableContextProfiles()
    ]);

    return {
      repository: targetDirectory,
      context: {
        effective: contextSettings.effective,
        project: contextSettings.project,
        user: contextSettings.user,
        activeProfiles: projectContext.activeProfiles.map((profile) => ({
          id: profile.id,
          type: profile.type,
          displayName: profile.displayName,
          description: profile.description
        })),
        availableProfiles: availableProfiles.map((profile) => ({
          id: profile.id,
          type: profile.type,
          displayName: profile.displayName,
          description: profile.description
        }))
      }
    };
  });

  server.get("/providers", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const providers = await inspectConfiguredProviders(config, {
      inspect: (providerId, definition, modelTiers) =>
        inspectProviderRuntime(providerId, definition, modelTiers, { repositoryPath: targetDirectory })
    });

    return {
      repository: targetDirectory,
      providers
    };
  });

  server.put("/providers/:providerId", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const providerId = z.object({ providerId: z.string().min(1) }).parse(request.params).providerId;
    const body = updateProviderBodySchema.parse(request.body);
    const targetPath = await saveProviderSetup(
      {
        providerId,
        type: body.type,
        connectionMethod: body.connectionMethod,
        command: body.command || undefined,
        apiKeyEnv: body.apiKeyEnv || undefined,
        oauthProvider: body.oauthProvider || undefined,
        baseUrl: body.baseUrl || undefined,
        modelMappings: body.modelMappings
      },
      targetDirectory
    );

    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const providers = await inspectConfiguredProviders(config, {
      inspect: (providerId, definition, modelTiers) =>
        inspectProviderRuntime(providerId, definition, modelTiers, { repositoryPath: targetDirectory })
    });

    return {
      ok: true,
      targetPath,
      provider: providers.find((provider) => provider.providerId === providerId) ?? null
    };
  });

  server.post("/providers/:providerId/oauth/start", async (request, reply) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const providerId = z.object({ providerId: z.string().min(1) }).parse(request.params).providerId;
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const provider = getProvider(config, providerId);

    if (provider.connection.method !== "oauth") {
      return reply.code(400).send({
        ok: false,
        error: `Provider "${providerId}" is not configured for OAuth.`
      });
    }

    const result = await startOauthFlow({
      providerId,
      definition: provider,
      repositoryPath: targetDirectory,
      webBaseUrl: process.env.OPENTOP_WEB_URL ?? "http://127.0.0.1:3000"
    });

    return {
      ok: true,
      ...result
    };
  });

  server.post("/providers/:providerId/oauth/exchange", async (request, reply) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const providerId = z.object({ providerId: z.string().min(1) }).parse(request.params).providerId;
    const body = oauthExchangeBodySchema.parse(request.body ?? {});

    if (body.error) {
      await cancelOauthFlow(body.sessionId);
      return reply.code(400).send({
        ok: false,
        error: body.errorDescription
          ? `${body.error}: ${body.errorDescription}`
          : `OAuth connection was cancelled: ${body.error}.`
      });
    }

    if (!body.code) {
      return reply.code(400).send({
        ok: false,
        error: "Missing OAuth authorization code."
      });
    }

    const connection = await completeOauthFlow({
      providerId,
      sessionId: body.sessionId,
      code: body.code
    });
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const providers = await inspectConfiguredProviders(config, {
      inspect: (inspectedProviderId, definition, modelTiers) =>
        inspectProviderRuntime(inspectedProviderId, definition, modelTiers, { repositoryPath: targetDirectory })
    });

    return {
      ok: true,
      connection: {
        providerId: connection.providerId,
        oauthProvider: connection.oauthProvider,
        createdAt: connection.createdAt,
        expiresAt: connection.expiresAt
      },
      provider: providers.find((entry) => entry.providerId === providerId) ?? null
    };
  });

  server.post("/providers/:providerId/oauth/disconnect", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const providerId = z.object({ providerId: z.string().min(1) }).parse(request.params).providerId;
    await disconnectOauthConnection(providerId, targetDirectory);
    const config = await loadOpenTopConfig(undefined, targetDirectory);
    const providers = await inspectConfiguredProviders(config, {
      inspect: (inspectedProviderId, definition, modelTiers) =>
        inspectProviderRuntime(inspectedProviderId, definition, modelTiers, { repositoryPath: targetDirectory })
    });

    return {
      ok: true,
      provider: providers.find((entry) => entry.providerId === providerId) ?? null
    };
  });

  server.put("/config", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const body = updateConfigBodySchema.parse(request.body);
    const targetPath = await setConfigValue(
      body.key,
      body.value as "new" | "reuse-current" | "manual" | "none" | "project-first" | "profile-first" | "project-only" | "profile-only" | "manual",
      body.scope,
      targetDirectory
    );

    return {
      ok: true,
      targetPath,
      key: body.key,
      value: body.value,
      scope: body.scope
    };
  });

  server.put("/context", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const body = updateContextBodySchema.parse(request.body);
    const targetPath = await saveContextSettings(
      {
        learnedProfiles: body.learnedProfiles,
        userProfiles: body.userProfiles,
        profileMode: body.profileMode,
        maxPromptProfileWords: body.maxPromptProfileWords,
        maxProfileSections: body.maxProfileSections
      },
      body.scope,
      targetDirectory
    );

    return {
      ok: true,
      targetPath
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
    const [
      config,
      projectContext,
      ticketRepository,
      promptReviewRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      executionRepository
    ] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
      createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
      createSqliteWorkItemRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);
    const [classifiedTicket, promptReviewResult, promptReviews, planArtifacts, workerPlans, workItems, executions] = await Promise.all([
      classifyStoredTicket(ticketRepository, config, ticketId),
      preparePromptReviewForStoredTicket(ticketRepository, promptReviewRepository, config, projectContext, ticketId, {
        planArtifactRepository
      }),
      listPromptReviewsForStoredTicket(promptReviewRepository, ticketId),
      listPlanArtifactsForStoredTicket(planArtifactRepository, ticketId),
      listWorkerPlansForStoredTicket(workerPlanRepository, ticketId),
      listWorkItemsForStoredTicket(workItemRepository, ticketId),
      executionRepository.listByTicketId(ticketId)
    ]);
    const ticket = enrichTicketSummary(classifiedTicket.ticket, config, executions);

    return {
      ticket,
      classification: classifiedTicket.classification,
      executionPlan: classifiedTicket.executionPlan,
      prompt: {
        prompt: promptReviewResult.builtPrompt.prompt,
        sources: promptReviewResult.builtPrompt.sources,
        contextSummary: promptReviewResult.builtPrompt.contextSummary
      },
      promptReview: promptReviewResult.promptReview,
      promptReviews,
      planArtifact: planArtifacts[0] ?? null,
      planArtifacts,
      workerPlan: workerPlans[0] ?? null,
      workerPlans,
      workItems,
      executions
    };
  });

  server.post("/tickets/:ticketId/resolve", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = resolveTicketBodySchema.parse(request.body ?? {});
    const [ticketRepository, executionRepository] = await Promise.all([
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);

    return {
      ticket: await resolveStoredTicket(ticketRepository, executionRepository, ticketId, body)
    };
  });

  server.post("/tickets/:ticketId/reopen", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const [config, ticketRepository, executionRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory })
    ]);

    return {
      ticket: await reopenStoredTicket(ticketRepository, executionRepository, config, ticketId)
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
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory })
    ]);

    const promptReview = await preparePromptReviewForStoredTicket(
      ticketRepository,
      promptReviewRepository,
      config,
      projectContext,
      ticketId,
      { planArtifactRepository }
    );

    return {
      prompt: promptReview.builtPrompt.prompt,
      sources: promptReview.builtPrompt.sources,
      contextSummary: promptReview.builtPrompt.contextSummary,
      promptReview: promptReview.promptReview
    };
  });

  server.post("/tickets/:ticketId/prompt/regenerate", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory })
    ]);

    return {
      promptReview: await regeneratePromptReviewForStoredTicket(
        ticketRepository,
        promptReviewRepository,
        config,
        projectContext,
        ticketId,
        body.reviewerComment,
        { planArtifactRepository }
      )
    };
  });

  server.post("/tickets/:ticketId/prompt/:promptReviewId/approve", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const params = z.object({ ticketId: z.string(), promptReviewId: z.string() }).parse(request.params);
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory })
    ]);

    return {
      promptReview: await approvePromptReviewForStoredTicket(
        ticketRepository,
        promptReviewRepository,
        config,
        projectContext,
        params.ticketId,
        params.promptReviewId,
        body.reviewerComment,
        { planArtifactRepository }
      )
    };
  });

  server.post("/tickets/:ticketId/prompt/:promptReviewId/reject", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const params = z.object({ ticketId: z.string(), promptReviewId: z.string() }).parse(request.params);
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory })
    ]);

    return {
      promptReview: await rejectPromptReviewForStoredTicket(
        ticketRepository,
        promptReviewRepository,
        config,
        projectContext,
        params.ticketId,
        params.promptReviewId,
        body.reviewerComment,
        { planArtifactRepository }
      )
    };
  });

  server.get("/tickets/:ticketId/plan", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const repository = await createSqlitePlanArtifactRepository({ startDirectory: targetDirectory });

    return {
      planArtifact: (await listPlanArtifactsForStoredTicket(repository, ticketId))[0] ?? null,
      planArtifacts: await listPlanArtifactsForStoredTicket(repository, ticketId)
    };
  });

  server.post("/tickets/:ticketId/plan/regenerate", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const [
      config,
      projectContext,
      ticketRepository,
      promptReviewRepository,
      planArtifactRepository,
      executionRepository,
      repositoryState
    ] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePromptReviewRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      getRepositoryStatus(targetDirectory)
    ]);
    const executionPlan = await planExecutionForStoredTicket(ticketRepository, config, ticketId);
    const provider = await createProviderAdapter(executionPlan.providerId, getProvider(config, executionPlan.providerId), {
      repositoryPath: targetDirectory
    });

    return regeneratePlanArtifactForStoredTicket(
      ticketRepository,
      promptReviewRepository,
      planArtifactRepository,
      executionRepository,
      new GitExecutionWorkspace(targetDirectory),
      provider,
      config,
      projectContext,
      ticketId,
      repositoryState,
      body.reviewerComment
    );
  });

  server.post("/tickets/:ticketId/plan/:planArtifactId/approve", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const params = z.object({ ticketId: z.string(), planArtifactId: z.string() }).parse(request.params);
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const repository = await createSqlitePlanArtifactRepository({ startDirectory: targetDirectory });

    return {
      planArtifact: await approvePlanArtifactForStoredTicket(
        repository,
        params.ticketId,
        params.planArtifactId,
        body.reviewerComment
      )
    };
  });

  server.post("/tickets/:ticketId/plan/:planArtifactId/reject", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const params = z.object({ ticketId: z.string(), planArtifactId: z.string() }).parse(request.params);
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const repository = await createSqlitePlanArtifactRepository({ startDirectory: targetDirectory });

    return {
      planArtifact: await rejectPlanArtifactForStoredTicket(
        repository,
        params.ticketId,
        params.planArtifactId,
        body.reviewerComment
      )
    };
  });

  server.get("/tickets/:ticketId/worker-plan", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const [workerPlanRepository, workItemRepository] = await Promise.all([
      createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
      createSqliteWorkItemRepository({ startDirectory: targetDirectory })
    ]);
    const [workerPlans, workItems] = await Promise.all([
      listWorkerPlansForStoredTicket(workerPlanRepository, ticketId),
      listWorkItemsForStoredTicket(workItemRepository, ticketId)
    ]);

    return {
      workerPlan: workerPlans[0] ?? null,
      workerPlans,
      workItems
    };
  });

  server.post("/tickets/:ticketId/worker-plan/generate", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = promptReviewCommentBodySchema.parse(request.body ?? {});
    const [config, ticketRepository, planArtifactRepository, workerPlanRepository, workItemRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqlitePlanArtifactRepository({ startDirectory: targetDirectory }),
      createSqliteWorkerPlanRepository({ startDirectory: targetDirectory }),
      createSqliteWorkItemRepository({ startDirectory: targetDirectory })
    ]);

    return generateWorkerPlanForStoredTicket(
      ticketRepository,
      planArtifactRepository,
      workerPlanRepository,
      workItemRepository,
      config,
      ticketId,
      body.reviewerComment
    );
  });

  server.post("/tickets/:ticketId/worker-plan/run", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
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

    return runWorkerPlanForStoredTicket(
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
  });

  server.get("/work-items/:workItemId", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const workItemId = z.object({ workItemId: z.string() }).parse(request.params).workItemId;
    const repository = await createSqliteWorkItemRepository({ startDirectory: targetDirectory });

    return {
      workItem: await getWorkItem(repository, workItemId)
    };
  });

  server.post("/work-items/:workItemId/run", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const workItemId = z.object({ workItemId: z.string() }).parse(request.params).workItemId;
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

    return runWorkItemForStoredTicket(
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
  });

  server.post("/tickets/:ticketId/run", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const ticketId = z.object({ ticketId: z.string() }).parse(request.params).ticketId;
    const body = runTicketBodySchema.parse(request.body ?? {});
    const [config, projectContext, ticketRepository, promptReviewRepository, planArtifactRepository, executionRepository, checkRunRepository, repositoryState] =
      await Promise.all([
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
    let provider;

    try {
      provider = await createProviderAdapter(
        executionPlan.providerId,
        getProvider(config, executionPlan.providerId),
        {
          repositoryPath: targetDirectory
        }
      );
    } catch (error) {
      if (isProviderRuntimeBlockedError(error)) {
        return {
          status: "blocked" as const,
          blocker: "provider_runtime" as const,
          reason: error.message,
          branchResolution: {
            policy: body.branchPolicy ?? config.execution.defaultBranchPolicy,
            decision: "none",
            branchName: executionPlan.branchName,
            reason: error.message,
            repositoryState
          }
        };
      }

      throw error;
    }

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
    const [repository, checkRunRepository] = await Promise.all([
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      createSqliteCheckRunRepository({ startDirectory: targetDirectory })
    ]);

    return {
      execution: await getExecution(repository, executionId),
      checkRuns: await listCheckRunsForStoredExecution(checkRunRepository, executionId)
    };
  });

  server.post("/executions/:executionId/review/approve", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const executionId = z.object({ executionId: z.string() }).parse(request.params).executionId;
    const body = executionReviewBodySchema.parse(request.body ?? {});
    const [executionRepository, checkRunRepository] = await Promise.all([
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      createSqliteCheckRunRepository({ startDirectory: targetDirectory })
    ]);

    return {
      execution: await approveExecutionReview(
        executionRepository,
        checkRunRepository,
        executionId,
        body.reviewerComment,
        body.overrideFailedChecks
      ),
      checkRuns: await listCheckRunsForStoredExecution(checkRunRepository, executionId)
    };
  });

  server.post("/executions/:executionId/review/reject", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const executionId = z.object({ executionId: z.string() }).parse(request.params).executionId;
    const body = executionReviewBodySchema.parse(request.body ?? {});
    const executionRepository = await createSqliteExecutionRepository({ startDirectory: targetDirectory });

    return {
      execution: await rejectExecutionReview(executionRepository, executionId, body.reviewerComment)
    };
  });

  server.post("/executions/:executionId/pull-request", async (request) => {
    const targetDirectory = resolveTargetDirectory(request.query);
    const executionId = z.object({ executionId: z.string() }).parse(request.params).executionId;
    const body = pullRequestBodySchema.parse(request.body ?? {});
    const [config, projectContext, ticketRepository, executionRepository, checkRunRepository] = await Promise.all([
      loadOpenTopConfig(undefined, targetDirectory),
      loadOpenTopProjectContext(targetDirectory),
      createSqliteTicketRepository({ startDirectory: targetDirectory }),
      createSqliteExecutionRepository({ startDirectory: targetDirectory }),
      createSqliteCheckRunRepository({ startDirectory: targetDirectory })
    ]);

    return {
      execution: await createDraftPullRequestForExecution(
        ticketRepository,
        executionRepository,
        checkRunRepository,
        config,
        projectContext,
        createGitHubPullRequestService(),
        executionId,
        {
          overrideFailedChecks: body.overrideFailedChecks
        }
      ),
      checkRuns: await listCheckRunsForStoredExecution(checkRunRepository, executionId)
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

function isProviderRuntimeBlockedError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("runtime adapter is not implemented yet") ||
    error.message.includes("no active credentials were found") ||
    error.message.includes("does not support OAuth")
  );
}

function formatApiError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unexpected server error.";
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
    workflowStage: deriveWorkflowStage(ticket, executionPlan.classification.approvalRequired, latestExecution)
  };
}

function deriveWorkflowStage(
  ticket: Ticket,
  approvalRequired: boolean,
  latestExecution: Awaited<ReturnType<typeof listExecutions>>[number] | undefined
): WorkflowStage {
  if (ticket.status === "done") {
    return "Done";
  }

  if (ticket.status === "inbox" && !latestExecution) {
    return "Inbox";
  }

  if (!latestExecution) {
    return approvalRequired ? "Ready" : "Classified";
  }

  if (latestExecution.status === "planned" || latestExecution.status === "queued" || latestExecution.status === "running") {
    return "Running";
  }

  if (latestExecution.status === "succeeded") {
    return latestExecution.reviewStatus === "approved" || latestExecution.reviewStatus === "not_required" ? "Ready" : "Review";
  }

  if (latestExecution.status === "output_ready") {
    return "Review";
  }

  return "Classified";
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
