import test from "node:test";
import assert from "node:assert/strict";
import {
  approveExecutionReview,
  approvePromptReviewForStoredTicket,
  createDraftPullRequestForExecution,
  generateWorkerPlanForStoredTicket,
  reopenStoredTicket,
  rejectPromptReviewForStoredTicket,
  resolveStoredTicket,
  runWorkerPlanForStoredTicket,
  startExecutionForStoredTicket
} from "./services.js";
import { createExecutionPlan } from "./execution.js";
import type { OpenTopConfig } from "./config.js";
import type {
  CheckRunRepository,
  ExecutionProvider,
  ExecutionRepository,
  ExecutionWorkspace,
  PlanArtifactRepository,
  PullRequestService,
  PromptReviewRepository,
  TicketRepository,
  WorkItemRepository,
  WorkerPlanRepository
} from "./repositories.js";
import type {
  Execution,
  ExecutionDiffSummary,
  ExecutionCreateInput,
  ExecutionProviderRequest,
  ExecutionProviderResult,
  ExecutionUpdateInput,
  ExecutionWorkspacePreparation,
  OpenTopProjectContext,
  PlanArtifact,
  PlanArtifactCreateInput,
  PlanArtifactUpdateInput,
  PromptReview,
  PromptReviewCreateInput,
  PromptReviewUpdateInput,
  RepositoryState,
  Ticket,
  TicketUpdateInput,
  WorkItem,
  WorkItemCreateInput,
  WorkItemUpdateInput,
  WorkerPlan,
  WorkerPlanCreateInput,
  WorkerPlanUpdateInput
} from "./types.js";

function requireExecutionId(runResult: Awaited<ReturnType<typeof startExecutionForStoredTicket>>): string {
  if (runResult.status === "blocked") {
    assert.fail(`Expected execution to start, but it was blocked by ${runResult.blocker}.`);
  }

  return runResult.execution.id;
}

class InMemoryTicketRepository implements TicketRepository {
  constructor(private ticket: Ticket) {}

  async create(): Promise<Ticket> {
    throw new Error("Not implemented in test repository.");
  }

  async findById(id: string): Promise<Ticket | null> {
    return id === this.ticket.id ? this.ticket : null;
  }

  async list(): Promise<Ticket[]> {
    return [this.ticket];
  }

  async update(id: string, input: TicketUpdateInput): Promise<Ticket> {
    if (id !== this.ticket.id) {
      throw new Error(`Ticket ${id} not found.`);
    }

    this.ticket = {
      ...this.ticket,
      ...input
    };

    return this.ticket;
  }
}

class InMemoryPlanArtifactRepository implements PlanArtifactRepository {
  private readonly planArtifacts = new Map<string, PlanArtifact>();
  private sequence = 1;

  async create(input: PlanArtifactCreateInput): Promise<PlanArtifact> {
    const id = String(this.sequence++);
    const timestamp = new Date(`2026-01-01T00:30:${id.padStart(2, "0")}Z`).toISOString();
    const planArtifact: PlanArtifact = {
      id,
      ticketId: input.ticketId,
      sourceExecutionId: input.sourceExecutionId,
      sourcePromptReviewId: input.sourcePromptReviewId,
      version: input.version,
      status: input.status,
      rawOutput: input.rawOutput,
      structuredPlan: input.structuredPlan,
      classificationSnapshot: input.classificationSnapshot,
      executionPlanSnapshot: input.executionPlanSnapshot,
      reviewerComment: input.reviewerComment,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.planArtifacts.set(id, planArtifact);
    return planArtifact;
  }

  async findById(id: string): Promise<PlanArtifact | null> {
    return this.planArtifacts.get(id) ?? null;
  }

  async listByTicketId(ticketId: string): Promise<PlanArtifact[]> {
    return [...this.planArtifacts.values()]
      .filter((planArtifact) => planArtifact.ticketId === ticketId)
      .sort((left, right) => right.version - left.version || Number(right.id) - Number(left.id));
  }

  async update(id: string, input: PlanArtifactUpdateInput): Promise<PlanArtifact> {
    const current = this.planArtifacts.get(id);

    if (!current) {
      throw new Error(`Plan artifact ${id} not found.`);
    }

    const updated: PlanArtifact = {
      ...current,
      ...input,
      updatedAt: new Date(`2026-01-01T00:40:${id.padStart(2, "0")}Z`).toISOString()
    };

    this.planArtifacts.set(id, updated);
    return updated;
  }
}

class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly executions = new Map<string, Execution>();
  private sequence = 1;

  async create(input: ExecutionCreateInput): Promise<Execution> {
    const execution = this.buildExecution(String(this.sequence++), input);
    this.executions.set(execution.id, execution);
    return execution;
  }

  async findById(id: string): Promise<Execution | null> {
    return this.executions.get(id) ?? null;
  }

  async list(): Promise<Execution[]> {
    return [...this.executions.values()];
  }

  async listByTicketId(ticketId: string): Promise<Execution[]> {
    return [...this.executions.values()].filter((execution) => execution.ticketId === ticketId);
  }

  async listByWorkerPlanId(workerPlanId: string): Promise<Execution[]> {
    return [...this.executions.values()].filter((execution) => execution.workerPlanId === workerPlanId);
  }

  async listByWorkItemId(workItemId: string): Promise<Execution[]> {
    return [...this.executions.values()].filter((execution) => execution.workItemId === workItemId);
  }

  async update(id: string, input: ExecutionUpdateInput): Promise<Execution> {
    const current = this.executions.get(id);

    if (!current) {
      throw new Error(`Execution ${id} not found.`);
    }

    const updated: Execution = {
      ...current,
      ...input,
      reviewStatus: input.reviewStatus ?? current.reviewStatus,
      reviewerComment: input.reviewerComment ?? current.reviewerComment,
      reviewedAt: input.reviewedAt ?? current.reviewedAt,
      diffSummary: input.diffSummary ?? current.diffSummary,
      riskSummary: input.riskSummary ?? current.riskSummary,
      pullRequest: input.pullRequest ?? current.pullRequest,
      logs: input.logs ?? current.logs,
      changedFiles: input.changedFiles ?? current.changedFiles,
      updatedAt: new Date(`2026-01-01T00:00:${Number(id).toString().padStart(2, "0")}Z`).toISOString()
    };
    this.executions.set(id, updated);
    return updated;
  }

  private buildExecution(id: string, input: ExecutionCreateInput): Execution {
    const timestamp = new Date(`2026-01-01T00:00:${Number(id).toString().padStart(2, "0")}Z`).toISOString();

    return {
      id,
      ticketId: input.ticketId,
      workerPlanId: input.workerPlanId,
      workItemId: input.workItemId,
      profileId: input.profileId,
      providerId: input.providerId,
      modelId: input.modelId,
      status: input.status,
      runKind: input.runKind,
      branchName: input.branchName,
      workspacePath: input.workspacePath,
      promptSnapshot: input.promptSnapshot,
      classificationSnapshot: input.classificationSnapshot,
      artifactKind: input.artifactKind ?? "workspace_changes",
      outputKind: input.outputKind,
      outputText: input.outputText,
      reviewStatus: input.reviewStatus ?? "not_required",
      reviewerComment: input.reviewerComment,
      reviewedAt: input.reviewedAt,
      diffSummary: input.diffSummary,
      riskSummary: input.riskSummary,
      pullRequest: input.pullRequest,
      logs: input.logs ?? [],
      changedFiles: input.changedFiles ?? [],
      pullRequestUrl: input.pullRequestUrl,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
}

class FakePullRequestService implements PullRequestService {
  public requests: import("./types.js").PullRequestDraftInput[] = [];

  async createDraft(input: import("./types.js").PullRequestDraftInput): Promise<import("./types.js").ExecutionPullRequest> {
    this.requests.push(input);
    return {
      url: "https://github.com/example/opentop/pull/42",
      number: 42,
      title: input.title,
      body: input.body,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      repositoryFullName: "example/opentop",
      isDraft: true,
      createdAt: new Date("2026-01-01T01:00:00Z").toISOString()
    };
  }
}

class InMemoryCheckRunRepository implements CheckRunRepository {
  private readonly checkRuns = new Map<string, import("./types.js").CheckRun>();
  private sequence = 1;

  async create(input: import("./types.js").CheckRunCreateInput): Promise<import("./types.js").CheckRun> {
    const id = String(this.sequence++);
    const timestamp = new Date(`2026-01-01T00:05:${id.padStart(2, "0")}Z`).toISOString();
    const checkRun: import("./types.js").CheckRun = {
      id,
      executionId: input.executionId,
      name: input.name,
      command: input.command,
      status: input.status,
      exitCode: input.exitCode,
      output: input.output,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.checkRuns.set(id, checkRun);
    return checkRun;
  }

  async findById(id: string): Promise<import("./types.js").CheckRun | null> {
    return this.checkRuns.get(id) ?? null;
  }

  async listByExecutionId(executionId: string): Promise<import("./types.js").CheckRun[]> {
    return [...this.checkRuns.values()].filter((checkRun) => checkRun.executionId === executionId);
  }

  async update(id: string, input: import("./types.js").CheckRunUpdateInput): Promise<import("./types.js").CheckRun> {
    const current = this.checkRuns.get(id);

    if (!current) {
      throw new Error(`Check run ${id} not found.`);
    }

    const updated = {
      ...current,
      ...input,
      updatedAt: new Date(`2026-01-01T00:06:${id.padStart(2, "0")}Z`).toISOString()
    };

    this.checkRuns.set(id, updated);
    return updated;
  }
}

class InMemoryWorkerPlanRepository implements WorkerPlanRepository {
  private readonly workerPlans = new Map<string, WorkerPlan>();
  private sequence = 1;

  async create(input: WorkerPlanCreateInput): Promise<WorkerPlan> {
    const id = String(this.sequence++);
    const timestamp = new Date(`2026-01-01T00:50:${id.padStart(2, "0")}Z`).toISOString();
    const workerPlan: WorkerPlan = {
      id,
      ticketId: input.ticketId,
      sourcePlanArtifactId: input.sourcePlanArtifactId,
      version: input.version,
      status: input.status,
      summary: input.summary,
      integrationSummary: input.integrationSummary,
      classificationSnapshot: input.classificationSnapshot,
      executionPlanSnapshot: input.executionPlanSnapshot,
      reviewerComment: input.reviewerComment,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.workerPlans.set(id, workerPlan);
    return workerPlan;
  }

  async findById(id: string): Promise<WorkerPlan | null> {
    return this.workerPlans.get(id) ?? null;
  }

  async listByTicketId(ticketId: string): Promise<WorkerPlan[]> {
    return [...this.workerPlans.values()]
      .filter((workerPlan) => workerPlan.ticketId === ticketId)
      .sort((left, right) => right.version - left.version || Number(right.id) - Number(left.id));
  }

  async update(id: string, input: WorkerPlanUpdateInput): Promise<WorkerPlan> {
    const current = this.workerPlans.get(id);

    if (!current) {
      throw new Error(`Worker plan ${id} not found.`);
    }

    const updated: WorkerPlan = {
      ...current,
      ...input,
      updatedAt: new Date(`2026-01-01T00:51:${id.padStart(2, "0")}Z`).toISOString()
    };

    this.workerPlans.set(id, updated);
    return updated;
  }
}

class InMemoryWorkItemRepository implements WorkItemRepository {
  private readonly workItems = new Map<string, WorkItem>();
  private sequence = 1;

  async create(input: WorkItemCreateInput): Promise<WorkItem> {
    const id = String(this.sequence++);
    const timestamp = new Date(`2026-01-01T00:52:${id.padStart(2, "0")}Z`).toISOString();
    const workItem: WorkItem = {
      id,
      workerPlanId: input.workerPlanId,
      ticketId: input.ticketId,
      sourcePlanArtifactId: input.sourcePlanArtifactId,
      sourcePlanWorkItemId: input.sourcePlanWorkItemId,
      key: input.key,
      title: input.title,
      summary: input.summary,
      role: input.role,
      status: input.status,
      affectedAreas: input.affectedAreas,
      dependsOn: input.dependsOn,
      suggestedProviderId: input.suggestedProviderId,
      suggestedModelTier: input.suggestedModelTier,
      suggestedModelId: input.suggestedModelId,
      suggestedMode: input.suggestedMode,
      branchStrategy: input.branchStrategy,
      reviewNotes: input.reviewNotes,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.workItems.set(id, workItem);
    return workItem;
  }

  async findById(id: string): Promise<WorkItem | null> {
    return this.workItems.get(id) ?? null;
  }

  async listByTicketId(ticketId: string): Promise<WorkItem[]> {
    return [...this.workItems.values()].filter((workItem) => workItem.ticketId === ticketId);
  }

  async listByWorkerPlanId(workerPlanId: string): Promise<WorkItem[]> {
    return [...this.workItems.values()].filter((workItem) => workItem.workerPlanId === workerPlanId);
  }

  async update(id: string, input: WorkItemUpdateInput): Promise<WorkItem> {
    const current = this.workItems.get(id);

    if (!current) {
      throw new Error(`Work item ${id} not found.`);
    }

    const updated: WorkItem = {
      ...current,
      ...input,
      updatedAt: new Date(`2026-01-01T00:53:${id.padStart(2, "0")}Z`).toISOString()
    };

    this.workItems.set(id, updated);
    return updated;
  }
}

class InMemoryPromptReviewRepository implements PromptReviewRepository {
  private readonly promptReviews = new Map<string, PromptReview>();
  private sequence = 1;

  async create(input: PromptReviewCreateInput): Promise<PromptReview> {
    const id = String(this.sequence++);
    const timestamp = new Date(`2026-01-01T00:10:${id.padStart(2, "0")}Z`).toISOString();
    const promptReview: PromptReview = {
      id,
      ticketId: input.ticketId,
      version: input.version,
      status: input.status,
      promptSnapshot: input.promptSnapshot,
      sources: input.sources,
      contextSummary: input.contextSummary,
      classificationSnapshot: input.classificationSnapshot,
      executionPlanSnapshot: input.executionPlanSnapshot,
      reviewerComment: input.reviewerComment,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.promptReviews.set(id, promptReview);
    return promptReview;
  }

  async findById(id: string): Promise<PromptReview | null> {
    return this.promptReviews.get(id) ?? null;
  }

  async listByTicketId(ticketId: string): Promise<PromptReview[]> {
    return [...this.promptReviews.values()]
      .filter((promptReview) => promptReview.ticketId === ticketId)
      .sort((left, right) => right.version - left.version || Number(right.id) - Number(left.id));
  }

  async update(id: string, input: PromptReviewUpdateInput): Promise<PromptReview> {
    const current = this.promptReviews.get(id);

    if (!current) {
      throw new Error(`Prompt review ${id} not found.`);
    }

    const updated: PromptReview = {
      ...current,
      ...input,
      updatedAt: new Date(`2026-01-01T00:20:${id.padStart(2, "0")}Z`).toISOString()
    };

    this.promptReviews.set(id, updated);
    return updated;
  }
}

class FakeExecutionWorkspace implements ExecutionWorkspace {
  constructor(
    private readonly preparedBranch: ExecutionWorkspacePreparation,
    private readonly repositoryStateAfterRun: RepositoryState,
    private readonly diffSummary?: ExecutionDiffSummary
  ) {}

  async prepareBranch(): Promise<ExecutionWorkspacePreparation> {
    return this.preparedBranch;
  }

  async getRepositoryState(): Promise<RepositoryState> {
    return this.repositoryStateAfterRun;
  }

  async getDiffSummary(_changedFiles: string[]): Promise<ExecutionDiffSummary | undefined> {
    return this.diffSummary;
  }
}

class FakeExecutionProvider implements ExecutionProvider {
  public requests: ExecutionProviderRequest[] = [];

  constructor(private readonly result: ExecutionProviderResult) {}

  async run(request: ExecutionProviderRequest): Promise<ExecutionProviderResult> {
    this.requests.push(request);
    return this.result;
  }
}

const baseProjectContext: OpenTopProjectContext = {
  rootDirectory: process.cwd(),
  projectContext: "",
  rules: "",
  memory: {},
  prompts: {},
  settings: {
    learnedProfiles: [],
    userProfiles: [],
    profileMode: "project-first",
    maxPromptProfileWords: 900,
    maxProfileSections: 6
  },
  activeProfiles: []
};

function createConfig(profileMode: "review_only" | "implement_only"): OpenTopConfig {
  return {
    project: {
      name: "OpenTop Sandbox",
      defaultBranch: "main"
    },
    providers: {
      primary: {
        type: "openai-api",
        connection: {
          method: "api_key",
          apiKeyEnv: "OPENAI_API_KEY"
        }
      }
    },
    models: {
      strong: {
        provider: "primary",
        model: "gpt-5"
      }
    },
    agentProfiles: {
      feature: {
        description: "Feature profile",
        modelTier: "strong",
        mode: profileMode,
        requiresApproval: profileMode === "review_only",
        allowedCommands: []
      }
    },
    routing: {
      rules: [{ default: { profile: "feature" } }]
    },
    execution: {
      defaultBranchPolicy: "reuse-current"
    },
    context: {
      learnedProfiles: [],
      userProfiles: [],
      profileMode: "project-first",
      maxPromptProfileWords: 900,
      maxProfileSections: 6
    },
    commands: {
      build: `node -e "console.log('build-ok')"`,
      test: `node -e "console.log('test-ok')"`
    }
  };
}

function createPlanConfig(): OpenTopConfig {
  return {
    ...createConfig("implement_only"),
    agentProfiles: {
      feature: {
        description: "Feature profile",
        modelTier: "strong",
        mode: "plan_then_implement",
        requiresApproval: false,
        allowedCommands: []
      }
    }
  };
}

function createTicket(id: string, title: string): Ticket {
  return {
    id,
    source: "manual",
    title,
    description: "Generated during tests.",
    labels: [],
    status: "inbox"
  };
}

test("startExecutionForStoredTicket stores output_ready for review-only artifacts without file changes", async () => {
  const ticket = createTicket("ticket-1", "Review API provider response");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "unused",
      logs: ["prepareBranch should not be needed for review-only runs."]
    },
    {
      currentBranch: "feature/review",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Produced a structured plan.",
    artifactKind: "review_output",
    outputKind: "plan",
    outputText: "## Plan\n- Inspect current routing\n- Return a reviewed proposal",
    changedFiles: [],
    logs: ["Provider returned a plan."]
  });

  const approvedPromptReview = await approveLatestPromptReview(
    ticketRepository,
    promptReviewRepository,
    createConfig("review_only"),
    ticket.id
  );

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("review_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/review",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(result.status, "output_ready");
  assert.equal(result.promptReview.id, approvedPromptReview.id);
  assert.equal(result.promptReview.status, "approved");
  assert.equal(result.execution.status, "output_ready");
  assert.equal(result.execution.artifactKind, "review_output");
  assert.equal(result.execution.outputKind, "plan");
  assert.deepEqual(result.execution.changedFiles, []);
  assert.equal(result.branchResolution.decision, "none");
  assert.equal(executionProvider.requests.length, 1);
});

test("startExecutionForStoredTicket stores succeeded when workspace changes are detected", async () => {
  const ticket = createTicket("ticket-2", "Implement API provider patch");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "feature/opentop-ticket-2",
      logs: ["Prepared feature branch."]
    },
    {
      currentBranch: "feature/opentop-ticket-2",
      isClean: false,
      changedFiles: ["src/provider.ts"]
    },
    {
      totalFiles: 1,
      totalAdditions: 12,
      totalDeletions: 3,
      files: [
        {
          path: "src/provider.ts",
          changeType: "modified",
          additions: 12,
          deletions: 3,
          patch: "@@ -1 +1 @@\n-old\n+new"
        }
      ]
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Generated a patch proposal and local changes.",
    artifactKind: "review_output",
    outputKind: "patch_proposal",
    outputText: "```diff\n--- a/src/provider.ts\n+++ b/src/provider.ts\n```",
    changedFiles: [],
    logs: ["Provider suggested a patch."]
  });

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("implement_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/provider-work",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(result.status, "succeeded");
  assert.equal(result.execution.status, "succeeded");
  assert.equal(result.execution.artifactKind, "workspace_changes");
  assert.equal(result.execution.reviewStatus, "pending");
  assert.deepEqual(result.execution.changedFiles, ["src/provider.ts"]);
  assert.equal(result.execution.diffSummary?.totalFiles, 1);
  assert.equal(result.execution.riskSummary?.reviewRequired, true);
  assert.equal(result.branchResolution.decision, "reuse-current");
  assert.equal(executionProvider.requests.length, 1);
  assert.equal(executionProvider.requests[0]?.branchName, "feature/opentop-ticket-2");
  const storedCheckRuns = await checkRunRepository.listByExecutionId(result.execution.id);
  assert.equal(storedCheckRuns.length, 2);
  assert.equal(storedCheckRuns.every((checkRun) => checkRun.status === "passed"), true);
});

test("createDraftPullRequestForExecution renders a draft PR after approved execution review", async () => {
  const ticket = createTicket("ticket-pr-1", "Implement API provider patch");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "feature/opentop-ticket-pr-1",
      logs: ["Prepared feature branch."]
    },
    {
      currentBranch: "feature/opentop-ticket-pr-1",
      isClean: false,
      changedFiles: ["src/provider.ts"]
    },
    {
      totalFiles: 1,
      totalAdditions: 4,
      totalDeletions: 1,
      files: [
        {
          path: "src/provider.ts",
          changeType: "modified",
          additions: 4,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new"
        }
      ]
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Generated local changes.",
    artifactKind: "workspace_changes",
    changedFiles: [],
    logs: ["Provider changed files."]
  });

  const runResult = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("implement_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/provider-work",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(runResult.status, "succeeded");
  const approvedExecution = await approveExecutionReview(
    executionRepository,
    checkRunRepository,
    runResult.execution.id
  );
  assert.equal(approvedExecution.reviewStatus, "approved");

  const pullRequestService = new FakePullRequestService();
  const executionWithPullRequest = await createDraftPullRequestForExecution(
    ticketRepository,
    executionRepository,
    checkRunRepository,
    createConfig("implement_only"),
    {
      ...baseProjectContext,
      pullRequestTemplate: "# Summary\n\n<!-- Describe what changed and why. -->\n\n# Checks\n\n<!-- checks -->"
    },
    pullRequestService,
    runResult.execution.id
  );

  assert.equal(executionWithPullRequest.pullRequest?.number, 42);
  assert.equal(executionWithPullRequest.pullRequestUrl, "https://github.com/example/opentop/pull/42");
  assert.equal(pullRequestService.requests.length, 1);
  assert.match(pullRequestService.requests[0]?.body ?? "", /OpenTop execution/);
  assert.match(pullRequestService.requests[0]?.body ?? "", /build: passed/);
  const resolvedTicket = await ticketRepository.findById(ticket.id);
  assert.equal(resolvedTicket?.status, "done");
  assert.equal(resolvedTicket?.resolutionType, "done");
  assert.match(resolvedTicket?.resolutionNote ?? "", /Draft PR #42 created/);
});

test("startExecutionForStoredTicket blocks closed tickets until they are reopened", async () => {
  const ticket = createTicket("ticket-closed-1", "Closed ticket cannot run again");
  const ticketRepository = new InMemoryTicketRepository({
    ...ticket,
    status: "done",
    resolutionType: "done",
    resolutionNote: "Draft PR already created.",
    resolvedAt: "2026-01-01T00:00:00.000Z"
  });
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "feature/opentop-ticket-closed-1",
      logs: ["Prepared feature branch."]
    },
    {
      currentBranch: "feature/opentop-ticket-closed-1",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "No-op.",
    artifactKind: "workspace_changes",
    changedFiles: [],
    logs: []
  });

  const runResult = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("implement_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/provider-work",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(runResult.status, "blocked");
  assert.equal(runResult.blocker, "ticket_closed");
  assert.match(runResult.reason, /Reopen it before starting a new execution/);
});

test("resolveStoredTicket marks an approved execution as done for manual PR handling", async () => {
  const ticket = createTicket("ticket-resolve-1", "Resolve after manual review");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "feature/opentop-ticket-resolve-1",
      logs: ["Prepared feature branch."]
    },
    {
      currentBranch: "feature/opentop-ticket-resolve-1",
      isClean: false,
      changedFiles: ["src/provider.ts"]
    },
    {
      totalFiles: 1,
      totalAdditions: 2,
      totalDeletions: 1,
      files: [
        {
          path: "src/provider.ts",
          changeType: "modified",
          additions: 2,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new"
        }
      ]
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Generated local changes.",
    artifactKind: "workspace_changes",
    changedFiles: [],
    logs: ["Provider changed files."]
  });

  const runResult = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("implement_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/provider-work",
      isClean: true,
      changedFiles: []
    }
  );
  await approveExecutionReview(executionRepository, checkRunRepository, requireExecutionId(runResult));

  const resolvedTicket = await resolveStoredTicket(ticketRepository, executionRepository, ticket.id, {
    resolutionType: "manual_pr",
    resolutionNote: "Will open the GitHub PR manually after a last IDE pass."
  });

  assert.equal(resolvedTicket.status, "done");
  assert.equal(resolvedTicket.resolutionType, "manual_pr");
  assert.equal(resolvedTicket.resolutionNote, "Will open the GitHub PR manually after a last IDE pass.");
  assert.ok(resolvedTicket.resolvedAt);
});

test("reopenStoredTicket restores a resolved ticket to an actionable state", async () => {
  const ticket = createTicket("ticket-resolve-2", "Reopen after manual done");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "feature/opentop-ticket-resolve-2",
      logs: ["Prepared feature branch."]
    },
    {
      currentBranch: "feature/opentop-ticket-resolve-2",
      isClean: false,
      changedFiles: ["src/provider.ts"]
    },
    {
      totalFiles: 1,
      totalAdditions: 2,
      totalDeletions: 1,
      files: [
        {
          path: "src/provider.ts",
          changeType: "modified",
          additions: 2,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new"
        }
      ]
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Generated local changes.",
    artifactKind: "workspace_changes",
    changedFiles: [],
    logs: ["Provider changed files."]
  });

  const runResult = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("implement_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/provider-work",
      isClean: true,
      changedFiles: []
    }
  );
  await approveExecutionReview(executionRepository, checkRunRepository, requireExecutionId(runResult));
  await resolveStoredTicket(ticketRepository, executionRepository, ticket.id, {
    resolutionType: "manual_pr"
  });

  const reopenedTicket = await reopenStoredTicket(
    ticketRepository,
    executionRepository,
    createConfig("implement_only"),
    ticket.id
  );

  assert.equal(reopenedTicket.status, "ready");
  assert.equal(reopenedTicket.resolutionType, undefined);
  assert.equal(reopenedTicket.resolutionNote, undefined);
  assert.equal(reopenedTicket.resolvedAt, undefined);
});

test("startExecutionForStoredTicket blocks review-only executions until the latest prompt is approved", async () => {
  const ticket = createTicket("ticket-3", "Review gated run");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "unused",
      logs: []
    },
    {
      currentBranch: "feature/review-gate",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Should not run while prompt review is still draft.",
    artifactKind: "review_output",
    outputKind: "review_note",
    outputText: "Approval required first.",
    changedFiles: [],
    logs: []
  });

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("review_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/review-gate",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.blocker, "prompt_review");
  assert.equal(result.reason, "Prompt approval is required before execution can start.");
  assert.equal(result.promptReview?.status, "draft");
  assert.equal(executionProvider.requests.length, 0);
});

test("startExecutionForStoredTicket blocks rejected prompt reviews until a new version is approved", async () => {
  const ticket = createTicket("ticket-4", "Rejected prompt should block execution");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "unused",
      logs: []
    },
    {
      currentBranch: "feature/rejected-prompt",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "Should not run while prompt review is rejected.",
    artifactKind: "review_output",
    outputKind: "review_note",
    outputText: "Prompt was rejected.",
    changedFiles: [],
    logs: []
  });

  const rejectedPromptReview = await rejectLatestPromptReview(
    ticketRepository,
    promptReviewRepository,
    createConfig("review_only"),
    ticket.id
  );

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createConfig("review_only"),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/rejected-prompt",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.blocker, "prompt_review");
  assert.equal(
    result.reason,
    "The latest prompt version was rejected. Regenerate or approve a new prompt before running."
  );
  assert.equal(result.promptReview?.id, rejectedPromptReview.id);
  assert.equal(result.promptReview?.status, "rejected");
  assert.equal(executionProvider.requests.length, 0);
});

test("startExecutionForStoredTicket generates a plan artifact before plan-then-implement work proceeds", async () => {
  const ticket = createTicket("ticket-5", "Implement a new feature workflow");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "unused",
      logs: []
    },
    {
      currentBranch: "feature/new-flow",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "## Implementation Plan\n\n- Design API changes\n- Implement backend flow\n- Add tests",
    artifactKind: "review_output",
    outputKind: "plan",
    outputText:
      "## Summary\nDeliver the feature in a staged way.\n\n## Implementation Steps\n- Design API changes\n- Implement backend flow\n- Add tests\n\n## Risks\n- Backward compatibility\n\n## Work Items\n- API design\n- Backend implementation\n- Test coverage",
    changedFiles: [],
    logs: ["Provider returned a plan."]
  });

  const result = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createPlanConfig(),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/new-flow",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(result.status, "output_ready");
  assert.equal(result.execution.outputKind, "plan");
  assert.equal(result.planArtifact?.status, "draft");
  assert.ok(result.planArtifact);
  assert.equal(result.planArtifact?.structuredPlan.implementationSteps.length, 3);
  assert.equal(result.branchResolution.decision, "none");
});

test("startExecutionForStoredTicket blocks implementation when a plan draft is waiting for review", async () => {
  const ticket = createTicket("ticket-6", "Implement a new feature workflow");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const promptReviewRepository = new InMemoryPromptReviewRepository();
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const executionRepository = new InMemoryExecutionRepository();
  const checkRunRepository = new InMemoryCheckRunRepository();
  const executionWorkspace = new FakeExecutionWorkspace(
    {
      branchName: "unused",
      logs: []
    },
    {
      currentBranch: "feature/new-flow",
      isClean: true,
      changedFiles: []
    }
  );
  const executionProvider = new FakeExecutionProvider({
    success: true,
    summary: "## Implementation Plan\n\n- Design API changes\n- Implement backend flow\n- Add tests",
    artifactKind: "review_output",
    outputKind: "plan",
    outputText:
      "## Summary\nDeliver the feature in a staged way.\n\n## Implementation Steps\n- Design API changes\n- Implement backend flow\n- Add tests",
    changedFiles: [],
    logs: ["Provider returned a plan."]
  });

  const firstRun = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createPlanConfig(),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/new-flow",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(firstRun.status, "output_ready");

  const secondRun = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    executionRepository,
    checkRunRepository,
    executionWorkspace,
    executionProvider,
    createPlanConfig(),
    baseProjectContext,
    ticket.id,
    {
      currentBranch: "feature/new-flow",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(secondRun.status, "blocked");
  assert.equal(secondRun.blocker, "plan_review");
  assert.equal(
    secondRun.reason,
    "A generated plan is waiting for review. Approve, reject, or regenerate it before continuing."
  );
});

test("generateWorkerPlanForStoredTicket derives worker plans and dependency-aware work items from an approved plan", async () => {
  const ticket = createTicket("ticket-7", "Implement a new feature workflow");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const workerPlanRepository = new InMemoryWorkerPlanRepository();
  const workItemRepository = new InMemoryWorkItemRepository();
  const approvedPlanArtifact = await planArtifactRepository.create({
    ticketId: ticket.id,
    sourceExecutionId: "1",
    sourcePromptReviewId: "1",
    version: 1,
    status: "approved",
    rawOutput: "Approved plan",
    structuredPlan: {
      summary: "Deliver the feature in coordinated slices.",
      assumptions: [],
      implementationSteps: [],
      risks: ["Shared API contract might drift."],
      openQuestions: ["Do we need a migration window?"],
      workItems: [
        {
          id: "backend-contract",
          title: "Backend contract",
          summary: "Add the core API and data-layer updates.",
          affectedAreas: ["backend", "data"],
          suggestedMode: "implement_only",
          dependsOn: []
        },
        {
          id: "frontend-flow",
          title: "Frontend flow",
          summary: "Update the UI once the contract is ready.",
          affectedAreas: ["frontend"],
          suggestedMode: "implement_only",
          dependsOn: ["backend-contract"]
        },
        {
          id: "test-coverage",
          title: "Test coverage",
          summary: "Add regression and integration tests for the new flow.",
          affectedAreas: ["tests", "integration"],
          suggestedMode: "implement_and_test",
          dependsOn: ["backend-contract", "frontend-flow"]
        }
      ]
    },
    classificationSnapshot: {
      taskType: "feature",
      risk: "medium",
      complexity: "high",
      affectedAreas: ["backend", "frontend", "data", "tests"],
      detectedSignals: ["feature"],
      suggestedProfile: "feature",
      suggestedProviderId: "primary",
      suggestedModelTier: "strong",
      suggestedModel: "gpt-5",
      suggestedMode: "plan_then_implement",
      approvalRequired: false,
      reason: "Feature work with multiple affected areas."
    },
    executionPlanSnapshot: createExecutionPlan(
      {
        ...ticket,
        classification: {
          taskType: "feature",
          risk: "medium",
          complexity: "high",
          affectedAreas: ["backend", "frontend", "data", "tests"],
          detectedSignals: ["feature"],
          suggestedProfile: "feature",
          suggestedProviderId: "primary",
          suggestedModelTier: "strong",
          suggestedModel: "gpt-5",
          suggestedMode: "plan_then_implement",
          approvalRequired: false,
          reason: "Feature work with multiple affected areas."
        }
      },
      createPlanConfig()
    )
  });

  const result = await generateWorkerPlanForStoredTicket(
    ticketRepository,
    planArtifactRepository,
    workerPlanRepository,
    workItemRepository,
    createPlanConfig(),
    ticket.id,
    "Generate worker plan after plan approval."
  );

  assert.equal(result.workerPlan.status, "ready");
  assert.equal(result.workerPlan.sourcePlanArtifactId, approvedPlanArtifact.id);
  assert.equal(result.workItems.length, 3);
  assert.equal(result.workItems[0]?.status, "ready");
  assert.equal(result.workItems[1]?.status, "blocked");
  assert.equal(result.workItems[2]?.status, "blocked");
  assert.equal(result.workItems[0]?.role, "data");
  assert.equal(result.workItems[1]?.role, "frontend");
  assert.equal(result.workItems[2]?.role, "integration");
  assert.equal(result.workItems[0]?.branchStrategy, "isolated_worktree");
  assert.equal(result.workItems[1]?.dependsOn[0], "backend-contract");
  assert.match(result.workItems[2]?.reviewNotes.join(" ") ?? "", /Shared API contract might drift\./);
});

test("runWorkerPlanForStoredTicket executes ready work items sequentially and unblocks dependencies", async () => {
  const ticket = createTicket("ticket-8", "Coordinate worker plan execution");
  const ticketRepository = new InMemoryTicketRepository(ticket);
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const workerPlanRepository = new InMemoryWorkerPlanRepository();
  const workItemRepository = new InMemoryWorkItemRepository();
  const executionRepository = new InMemoryExecutionRepository();
  await planArtifactRepository.create({
    ticketId: ticket.id,
    sourceExecutionId: "1",
    sourcePromptReviewId: "1",
    version: 1,
    status: "approved",
    rawOutput: "Approved plan",
    structuredPlan: {
      summary: "Run backend first, then UI.",
      assumptions: [],
      implementationSteps: [],
      risks: [],
      openQuestions: [],
      workItems: [
        {
          id: "backend-step",
          title: "Backend step",
          summary: "Implement the backend changes first.",
          affectedAreas: ["backend"],
          suggestedMode: "implement_only",
          dependsOn: []
        },
        {
          id: "frontend-step",
          title: "Frontend step",
          summary: "Update the frontend once backend is ready.",
          affectedAreas: ["frontend"],
          suggestedMode: "implement_only",
          dependsOn: ["backend-step"]
        }
      ]
    },
    classificationSnapshot: {
      taskType: "feature",
      risk: "medium",
      complexity: "medium",
      affectedAreas: ["backend", "frontend"],
      detectedSignals: ["feature"],
      suggestedProfile: "feature",
      suggestedProviderId: "primary",
      suggestedModelTier: "strong",
      suggestedModel: "gpt-5",
      suggestedMode: "plan_then_implement",
      approvalRequired: false,
      reason: "Feature split into two work items."
    },
    executionPlanSnapshot: createExecutionPlan(
      {
        ...ticket,
        classification: {
          taskType: "feature",
          risk: "medium",
          complexity: "medium",
          affectedAreas: ["backend", "frontend"],
          detectedSignals: ["feature"],
          suggestedProfile: "feature",
          suggestedProviderId: "primary",
          suggestedModelTier: "strong",
          suggestedModel: "gpt-5",
          suggestedMode: "plan_then_implement",
          approvalRequired: false,
          reason: "Feature split into two work items."
        }
      },
      createPlanConfig()
    )
  });

  const generated = await generateWorkerPlanForStoredTicket(
    ticketRepository,
    planArtifactRepository,
    workerPlanRepository,
    workItemRepository,
    createPlanConfig(),
    ticket.id
  );
  const workItemsById = new Map(generated.workItems.map((workItem) => [workItem.id, workItem]));

  const result = await runWorkerPlanForStoredTicket(
    ticketRepository,
    planArtifactRepository,
    workerPlanRepository,
    workItemRepository,
    executionRepository,
    new InMemoryCheckRunRepository(),
    createPlanConfig(),
    baseProjectContext,
    ticket.id,
    {
      providerForWorkItem: (workItem) =>
        new FakeExecutionProvider({
          success: true,
          summary: `Completed ${workItem.title}.`,
          artifactKind: "workspace_changes",
          changedFiles: [`src/${workItem.key}.ts`],
          logs: [`Ran ${workItem.title}.`]
        }),
      prepareWorkspace: async ({ workItem }) => ({
        branchName: `opentop/test-${workItem.key}`,
        repositoryPath: `/tmp/opentop/${workItem.key}`,
        repositoryState: {
          currentBranch: `opentop/test-${workItem.key}`,
          isClean: true,
          changedFiles: []
        },
        logs: [`Prepared workspace for ${workItem.title}.`],
        strategy: workItem.branchStrategy,
        workspace: new FakeExecutionWorkspace(
          {
            branchName: `opentop/test-${workItem.key}`,
            logs: []
          },
          {
            currentBranch: `opentop/test-${workItem.key}`,
            isClean: false,
            changedFiles: [`src/${workItem.key}.ts`]
          }
        )
      })
    }
  );

  assert.equal(result.status, "integration_ready");
  assert.equal(result.executions.length, 2);
  assert.equal(result.workItems.find((workItem) => workItem.key === "backend-step")?.status, "done");
  assert.equal(result.workItems.find((workItem) => workItem.key === "frontend-step")?.status, "done");
  assert.equal(result.executions.every((execution) => execution.runKind === "work_item"), true);
  assert.equal(result.workerPlan.status, "integration_ready");
  assert.match(result.integrationSummary, /integration/i);
  assert.equal(result.integrationIssues.length > 0, true);
  assert.equal(workItemsById.size, 2);
});

async function approveLatestPromptReview(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  ticketId: string
): Promise<PromptReview> {
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const latestPromptReview = (await promptReviewRepository.listByTicketId(ticketId))[0];

  if (latestPromptReview) {
    return approvePromptReviewForStoredTicket(
      ticketRepository,
      promptReviewRepository,
      config,
      baseProjectContext,
      ticketId,
      latestPromptReview.id,
      undefined,
      { planArtifactRepository }
    );
  }

  const preparedRun = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    new InMemoryExecutionRepository(),
    new InMemoryCheckRunRepository(),
    new FakeExecutionWorkspace(
      {
        branchName: "unused",
        logs: []
      },
      {
        currentBranch: "feature/prepare-prompt",
        isClean: true,
        changedFiles: []
      }
    ),
    new FakeExecutionProvider({
      success: true,
      summary: "Seed review.",
      artifactKind: "review_output",
      outputKind: "review_note",
      outputText: "Seed review.",
      changedFiles: [],
      logs: []
    }),
    config,
    baseProjectContext,
    ticketId,
    {
      currentBranch: "feature/prepare-prompt",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(preparedRun.status, "blocked");

  return approvePromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    baseProjectContext,
    ticketId,
    preparedRun.promptReview!.id,
    undefined,
    { planArtifactRepository }
  );
}

async function rejectLatestPromptReview(
  ticketRepository: TicketRepository,
  promptReviewRepository: PromptReviewRepository,
  config: OpenTopConfig,
  ticketId: string
): Promise<PromptReview> {
  const planArtifactRepository = new InMemoryPlanArtifactRepository();
  const seededRun = await startExecutionForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    planArtifactRepository,
    new InMemoryExecutionRepository(),
    new InMemoryCheckRunRepository(),
    new FakeExecutionWorkspace(
      {
        branchName: "unused",
        logs: []
      },
      {
        currentBranch: "feature/reject-prompt",
        isClean: true,
        changedFiles: []
      }
    ),
    new FakeExecutionProvider({
      success: true,
      summary: "Seed rejection.",
      artifactKind: "review_output",
      outputKind: "review_note",
      outputText: "Seed rejection.",
      changedFiles: [],
      logs: []
    }),
    config,
    baseProjectContext,
    ticketId,
    {
      currentBranch: "feature/reject-prompt",
      isClean: true,
      changedFiles: []
    }
  );

  assert.equal(seededRun.status, "blocked");

  return rejectPromptReviewForStoredTicket(
    ticketRepository,
    promptReviewRepository,
    config,
    baseProjectContext,
    ticketId,
    seededRun.promptReview!.id,
    undefined,
    { planArtifactRepository }
  );
}
