import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  Classification,
  ExecutionPlan,
  WorkerPlan,
  WorkerPlanCreateInput,
  WorkerPlanRepository,
  WorkerPlanUpdateInput
} from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { workerPlansTable } from "./schema.js";

export class SqliteWorkerPlanRepository implements WorkerPlanRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: WorkerPlanCreateInput): Promise<WorkerPlan> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(workerPlansTable)
      .values({
        ticketId: Number(input.ticketId),
        sourcePlanArtifactId: Number(input.sourcePlanArtifactId),
        version: input.version,
        status: input.status,
        summary: input.summary,
        integrationSummary: input.integrationSummary,
        classificationJson: JSON.stringify(input.classificationSnapshot),
        executionPlanJson: JSON.stringify(input.executionPlanSnapshot),
        reviewerComment: input.reviewerComment,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapWorkerPlanRow(inserted);
  }

  async findById(id: string): Promise<WorkerPlan | null> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(workerPlansTable).where(eq(workerPlansTable.id, numericId)).get();
    return row ? mapWorkerPlanRow(row) : null;
  }

  async listByTicketId(ticketId: string): Promise<WorkerPlan[]> {
    const numericTicketId = Number(ticketId);
    if (!Number.isInteger(numericTicketId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(workerPlansTable)
      .where(eq(workerPlansTable.ticketId, numericTicketId))
      .orderBy(desc(workerPlansTable.version), desc(workerPlansTable.id))
      .all();

    return rows.map(mapWorkerPlanRow);
  }

  async update(id: string, input: WorkerPlanUpdateInput): Promise<WorkerPlan> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      throw new Error(`Worker plan "${id}" is not a valid numeric worker plan ID.`);
    }

    const existing = this.database.select().from(workerPlansTable).where(eq(workerPlansTable.id, numericId)).get();
    if (!existing) {
      throw new Error(`Worker plan "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(workerPlansTable)
      .set({
        status: input.status ?? existing.status,
        summary: input.summary ?? existing.summary,
        integrationSummary: input.integrationSummary ?? existing.integrationSummary,
        classificationJson: input.classificationSnapshot
          ? JSON.stringify(input.classificationSnapshot)
          : existing.classificationJson,
        executionPlanJson: input.executionPlanSnapshot
          ? JSON.stringify(input.executionPlanSnapshot)
          : existing.executionPlanJson,
        reviewerComment: input.reviewerComment ?? existing.reviewerComment,
        updatedAt: new Date().toISOString()
      })
      .where(eq(workerPlansTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapWorkerPlanRow(updated);
  }
}

export async function createSqliteWorkerPlanRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqliteWorkerPlanRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqliteWorkerPlanRepository(database, sqlite, filePath);
}

function mapWorkerPlanRow(row: typeof workerPlansTable.$inferSelect): WorkerPlan {
  return {
    id: String(row.id),
    ticketId: String(row.ticketId),
    sourcePlanArtifactId: String(row.sourcePlanArtifactId),
    version: row.version,
    status: row.status as WorkerPlan["status"],
    summary: row.summary ?? undefined,
    integrationSummary: row.integrationSummary ?? undefined,
    classificationSnapshot: parseJson<Classification>(row.classificationJson),
    executionPlanSnapshot: parseJson<ExecutionPlan>(row.executionPlanJson),
    reviewerComment: row.reviewerComment ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}
