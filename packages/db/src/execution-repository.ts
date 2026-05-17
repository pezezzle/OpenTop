import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  Classification,
  Execution,
  ExecutionCreateInput,
  ExecutionDiffSummary,
  ExecutionPullRequest,
  ExecutionRunKind,
  ExecutionRiskSummary,
  ExecutionUpdateInput,
  ExecutionRepository
} from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { executionsTable } from "./schema.js";

export class SqliteExecutionRepository implements ExecutionRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: ExecutionCreateInput): Promise<Execution> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(executionsTable)
      .values({
        ticketId: Number(input.ticketId),
        workerPlanId: input.workerPlanId ? Number(input.workerPlanId) : null,
        workItemId: input.workItemId ? Number(input.workItemId) : null,
        profileId: input.profileId,
        providerId: input.providerId,
        modelId: input.modelId,
        status: input.status,
        runKind: input.runKind,
        branchName: input.branchName,
        workspacePath: input.workspacePath,
        promptSnapshot: input.promptSnapshot,
        classificationJson: JSON.stringify(input.classificationSnapshot),
        artifactKind: input.artifactKind ?? "workspace_changes",
        outputKind: input.outputKind,
        outputText: input.outputText,
        reviewStatus: input.reviewStatus ?? "not_required",
        reviewerComment: input.reviewerComment,
        reviewedAt: input.reviewedAt,
        diffSummaryJson: input.diffSummary ? JSON.stringify(input.diffSummary) : null,
        riskSummaryJson: input.riskSummary ? JSON.stringify(input.riskSummary) : null,
        pullRequestJson: input.pullRequest ? JSON.stringify(input.pullRequest) : null,
        logs: JSON.stringify(input.logs ?? []),
        changedFiles: JSON.stringify(input.changedFiles ?? []),
        pullRequestUrl: input.pullRequest?.url ?? input.pullRequestUrl,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapExecutionRow(inserted);
  }

  async findById(id: string): Promise<Execution | null> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(executionsTable).where(eq(executionsTable.id, numericId)).get();
    return row ? mapExecutionRow(row) : null;
  }

  async list(): Promise<Execution[]> {
    const rows = this.database.select().from(executionsTable).orderBy(desc(executionsTable.id)).all();
    return rows.map(mapExecutionRow);
  }

  async listByTicketId(ticketId: string): Promise<Execution[]> {
    const numericTicketId = Number(ticketId);

    if (!Number.isInteger(numericTicketId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.ticketId, numericTicketId))
      .orderBy(desc(executionsTable.id))
      .all();

    return rows.map(mapExecutionRow);
  }

  async listByWorkerPlanId(workerPlanId: string): Promise<Execution[]> {
    const numericWorkerPlanId = Number(workerPlanId);

    if (!Number.isInteger(numericWorkerPlanId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.workerPlanId, numericWorkerPlanId))
      .orderBy(desc(executionsTable.id))
      .all();

    return rows.map(mapExecutionRow);
  }

  async listByWorkItemId(workItemId: string): Promise<Execution[]> {
    const numericWorkItemId = Number(workItemId);

    if (!Number.isInteger(numericWorkItemId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.workItemId, numericWorkItemId))
      .orderBy(desc(executionsTable.id))
      .all();

    return rows.map(mapExecutionRow);
  }

  async update(id: string, input: ExecutionUpdateInput): Promise<Execution> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      throw new Error(`Execution "${id}" is not a valid numeric execution ID.`);
    }

    const existing = this.database.select().from(executionsTable).where(eq(executionsTable.id, numericId)).get();

    if (!existing) {
      throw new Error(`Execution "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(executionsTable)
      .set({
        workerPlanId: input.workerPlanId ? Number(input.workerPlanId) : existing.workerPlanId,
        workItemId: input.workItemId ? Number(input.workItemId) : existing.workItemId,
        status: input.status ?? existing.status,
        runKind: input.runKind ?? existing.runKind,
        branchName: input.branchName ?? existing.branchName,
        workspacePath: input.workspacePath ?? existing.workspacePath,
        artifactKind: input.artifactKind ?? existing.artifactKind,
        outputKind: input.outputKind ?? existing.outputKind,
        outputText: input.outputText ?? existing.outputText,
        reviewStatus: input.reviewStatus ?? existing.reviewStatus,
        reviewerComment: input.reviewerComment ?? existing.reviewerComment,
        reviewedAt: input.reviewedAt ?? existing.reviewedAt,
        diffSummaryJson: input.diffSummary ? JSON.stringify(input.diffSummary) : existing.diffSummaryJson,
        riskSummaryJson: input.riskSummary ? JSON.stringify(input.riskSummary) : existing.riskSummaryJson,
        pullRequestJson: input.pullRequest ? JSON.stringify(input.pullRequest) : existing.pullRequestJson,
        logs: input.logs ? JSON.stringify(input.logs) : existing.logs,
        changedFiles: input.changedFiles ? JSON.stringify(input.changedFiles) : existing.changedFiles,
        pullRequestUrl: input.pullRequest?.url ?? input.pullRequestUrl ?? existing.pullRequestUrl,
        updatedAt: new Date().toISOString()
      })
      .where(eq(executionsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapExecutionRow(updated);
  }
}

export async function createSqliteExecutionRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqliteExecutionRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqliteExecutionRepository(database, sqlite, filePath);
}

function mapExecutionRow(row: typeof executionsTable.$inferSelect): Execution {
  return {
    id: String(row.id),
    ticketId: String(row.ticketId),
    workerPlanId: row.workerPlanId !== null ? String(row.workerPlanId) : undefined,
    workItemId: row.workItemId !== null ? String(row.workItemId) : undefined,
    profileId: row.profileId,
    providerId: row.providerId,
    modelId: row.modelId,
    status: row.status as Execution["status"],
    runKind: parseRunKind(row.runKind),
    branchName: row.branchName,
    workspacePath: row.workspacePath,
    promptSnapshot: row.promptSnapshot,
    classificationSnapshot: parseClassification(row.classificationJson),
    artifactKind: row.artifactKind as Execution["artifactKind"],
    outputKind: parseOptionalOutputKind(row.outputKind),
    outputText: row.outputText ?? undefined,
    reviewStatus: parseReviewStatus(row.reviewStatus),
    reviewerComment: row.reviewerComment ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    diffSummary: parseOptionalDiffSummary(row.diffSummaryJson),
    riskSummary: parseOptionalRiskSummary(row.riskSummaryJson),
    pullRequest: parseOptionalPullRequest(row.pullRequestJson),
    logs: parseStringArray(row.logs),
    changedFiles: parseStringArray(row.changedFiles),
    pullRequestUrl: row.pullRequestUrl ?? parseOptionalPullRequest(row.pullRequestJson)?.url,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseOptionalOutputKind(raw: string | null): Execution["outputKind"] {
  return raw === "plan" || raw === "patch_proposal" || raw === "review_note" || raw === "general" ? raw : undefined;
}

function parseReviewStatus(raw: string): Execution["reviewStatus"] {
  return raw === "pending" || raw === "approved" || raw === "rejected" ? raw : "not_required";
}

function parseRunKind(raw: string): ExecutionRunKind {
  return raw === "planning" || raw === "work_item" ? raw : "ticket";
}

function parseClassification(raw: string): Classification {
  return JSON.parse(raw) as Classification;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function parseOptionalDiffSummary(raw: string | null): ExecutionDiffSummary | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as ExecutionDiffSummary;
  } catch {
    return undefined;
  }
}

function parseOptionalRiskSummary(raw: string | null): ExecutionRiskSummary | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as ExecutionRiskSummary;
  } catch {
    return undefined;
  }
}

function parseOptionalPullRequest(raw: string | null): ExecutionPullRequest | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as ExecutionPullRequest;
  } catch {
    return undefined;
  }
}
