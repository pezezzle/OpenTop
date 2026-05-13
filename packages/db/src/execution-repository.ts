import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  Classification,
  Execution,
  ExecutionCreateInput,
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
        profileId: input.profileId,
        providerId: input.providerId,
        modelId: input.modelId,
        status: input.status,
        branchName: input.branchName,
        promptSnapshot: input.promptSnapshot,
        classificationJson: JSON.stringify(input.classificationSnapshot),
        logs: JSON.stringify(input.logs ?? []),
        changedFiles: JSON.stringify(input.changedFiles ?? []),
        pullRequestUrl: input.pullRequestUrl,
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
    profileId: row.profileId,
    providerId: row.providerId,
    modelId: row.modelId,
    status: row.status as Execution["status"],
    branchName: row.branchName,
    promptSnapshot: row.promptSnapshot,
    classificationSnapshot: parseClassification(row.classificationJson),
    logs: parseStringArray(row.logs),
    changedFiles: parseStringArray(row.changedFiles),
    pullRequestUrl: row.pullRequestUrl ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
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
