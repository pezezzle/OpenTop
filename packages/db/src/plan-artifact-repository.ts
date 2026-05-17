import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  Classification,
  ExecutionPlan,
  PlanArtifact,
  PlanArtifactCreateInput,
  PlanArtifactRepository,
  PlanArtifactUpdateInput,
  StructuredPlan
} from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { planArtifactsTable } from "./schema.js";

export class SqlitePlanArtifactRepository implements PlanArtifactRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: PlanArtifactCreateInput): Promise<PlanArtifact> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(planArtifactsTable)
      .values({
        ticketId: Number(input.ticketId),
        sourceExecutionId: Number(input.sourceExecutionId),
        sourcePromptReviewId: Number(input.sourcePromptReviewId),
        version: input.version,
        status: input.status,
        rawOutput: input.rawOutput,
        structuredPlanJson: JSON.stringify(input.structuredPlan),
        classificationJson: JSON.stringify(input.classificationSnapshot),
        executionPlanJson: JSON.stringify(input.executionPlanSnapshot),
        reviewerComment: input.reviewerComment,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapPlanArtifactRow(inserted);
  }

  async findById(id: string): Promise<PlanArtifact | null> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(planArtifactsTable).where(eq(planArtifactsTable.id, numericId)).get();
    return row ? mapPlanArtifactRow(row) : null;
  }

  async listByTicketId(ticketId: string): Promise<PlanArtifact[]> {
    const numericTicketId = Number(ticketId);

    if (!Number.isInteger(numericTicketId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(planArtifactsTable)
      .where(eq(planArtifactsTable.ticketId, numericTicketId))
      .orderBy(desc(planArtifactsTable.version), desc(planArtifactsTable.id))
      .all();

    return rows.map(mapPlanArtifactRow);
  }

  async update(id: string, input: PlanArtifactUpdateInput): Promise<PlanArtifact> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      throw new Error(`Plan artifact "${id}" is not a valid numeric plan artifact ID.`);
    }

    const existing = this.database.select().from(planArtifactsTable).where(eq(planArtifactsTable.id, numericId)).get();

    if (!existing) {
      throw new Error(`Plan artifact "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(planArtifactsTable)
      .set({
        status: input.status ?? existing.status,
        rawOutput: input.rawOutput ?? existing.rawOutput,
        structuredPlanJson: input.structuredPlan ? JSON.stringify(input.structuredPlan) : existing.structuredPlanJson,
        classificationJson: input.classificationSnapshot
          ? JSON.stringify(input.classificationSnapshot)
          : existing.classificationJson,
        executionPlanJson: input.executionPlanSnapshot
          ? JSON.stringify(input.executionPlanSnapshot)
          : existing.executionPlanJson,
        reviewerComment: input.reviewerComment ?? existing.reviewerComment,
        updatedAt: new Date().toISOString()
      })
      .where(eq(planArtifactsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapPlanArtifactRow(updated);
  }
}

export async function createSqlitePlanArtifactRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqlitePlanArtifactRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqlitePlanArtifactRepository(database, sqlite, filePath);
}

function mapPlanArtifactRow(row: typeof planArtifactsTable.$inferSelect): PlanArtifact {
  return {
    id: String(row.id),
    ticketId: String(row.ticketId),
    sourceExecutionId: String(row.sourceExecutionId),
    sourcePromptReviewId: String(row.sourcePromptReviewId),
    version: row.version,
    status: row.status as PlanArtifact["status"],
    rawOutput: row.rawOutput,
    structuredPlan: parseJson<StructuredPlan>(row.structuredPlanJson),
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
