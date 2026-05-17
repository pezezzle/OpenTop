import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  Classification,
  ExecutionPlan,
  PromptContextSummary,
  PromptReview,
  PromptReviewCreateInput,
  PromptReviewRepository,
  PromptReviewUpdateInput,
  TicketIntelligenceSummary
} from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { promptReviewsTable } from "./schema.js";

export class SqlitePromptReviewRepository implements PromptReviewRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: PromptReviewCreateInput): Promise<PromptReview> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(promptReviewsTable)
      .values({
        ticketId: Number(input.ticketId),
        version: input.version,
        status: input.status,
        promptSnapshot: input.promptSnapshot,
        sourcesJson: JSON.stringify(input.sources),
        contextSummaryJson: JSON.stringify(input.contextSummary),
        classificationJson: JSON.stringify(input.classificationSnapshot),
        intelligenceJson: input.intelligenceSummary ? JSON.stringify(input.intelligenceSummary) : null,
        executionPlanJson: JSON.stringify(input.executionPlanSnapshot),
        reviewerComment: input.reviewerComment,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapPromptReviewRow(inserted);
  }

  async findById(id: string): Promise<PromptReview | null> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(promptReviewsTable).where(eq(promptReviewsTable.id, numericId)).get();
    return row ? mapPromptReviewRow(row) : null;
  }

  async listByTicketId(ticketId: string): Promise<PromptReview[]> {
    const numericTicketId = Number(ticketId);

    if (!Number.isInteger(numericTicketId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(promptReviewsTable)
      .where(eq(promptReviewsTable.ticketId, numericTicketId))
      .orderBy(desc(promptReviewsTable.version), desc(promptReviewsTable.id))
      .all();

    return rows.map(mapPromptReviewRow);
  }

  async update(id: string, input: PromptReviewUpdateInput): Promise<PromptReview> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      throw new Error(`Prompt review "${id}" is not a valid numeric review ID.`);
    }

    const existing = this.database.select().from(promptReviewsTable).where(eq(promptReviewsTable.id, numericId)).get();

    if (!existing) {
      throw new Error(`Prompt review "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(promptReviewsTable)
      .set({
        status: input.status ?? existing.status,
        promptSnapshot: input.promptSnapshot ?? existing.promptSnapshot,
        sourcesJson: input.sources ? JSON.stringify(input.sources) : existing.sourcesJson,
        contextSummaryJson: input.contextSummary
          ? JSON.stringify(input.contextSummary)
          : existing.contextSummaryJson,
        classificationJson: input.classificationSnapshot
          ? JSON.stringify(input.classificationSnapshot)
          : existing.classificationJson,
        intelligenceJson:
          input.intelligenceSummary !== undefined
            ? JSON.stringify(input.intelligenceSummary)
            : existing.intelligenceJson,
        executionPlanJson: input.executionPlanSnapshot
          ? JSON.stringify(input.executionPlanSnapshot)
          : existing.executionPlanJson,
        reviewerComment: input.reviewerComment ?? existing.reviewerComment,
        updatedAt: new Date().toISOString()
      })
      .where(eq(promptReviewsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapPromptReviewRow(updated);
  }
}

export async function createSqlitePromptReviewRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqlitePromptReviewRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqlitePromptReviewRepository(database, sqlite, filePath);
}

function mapPromptReviewRow(row: typeof promptReviewsTable.$inferSelect): PromptReview {
  return {
    id: String(row.id),
    ticketId: String(row.ticketId),
    version: row.version,
    status: row.status as PromptReview["status"],
    promptSnapshot: row.promptSnapshot,
    sources: parseStringArray(row.sourcesJson),
    contextSummary: parseJson<PromptContextSummary>(row.contextSummaryJson),
    classificationSnapshot: parseJson<Classification>(row.classificationJson),
    intelligenceSummary: row.intelligenceJson
      ? parseJson<TicketIntelligenceSummary>(row.intelligenceJson)
      : undefined,
    executionPlanSnapshot: parseJson<ExecutionPlan>(row.executionPlanJson),
    reviewerComment: row.reviewerComment ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}
