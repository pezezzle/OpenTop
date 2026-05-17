import { asc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type {
  CheckRun,
  CheckRunCreateInput,
  CheckRunRepository,
  CheckRunUpdateInput
} from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { checkRunsTable } from "./schema.js";

export class SqliteCheckRunRepository implements CheckRunRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: CheckRunCreateInput): Promise<CheckRun> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(checkRunsTable)
      .values({
        executionId: Number(input.executionId),
        name: input.name,
        command: input.command,
        status: input.status,
        exitCode: input.exitCode ?? null,
        output: input.output,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapCheckRunRow(inserted);
  }

  async findById(id: string): Promise<CheckRun | null> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(checkRunsTable).where(eq(checkRunsTable.id, numericId)).get();
    return row ? mapCheckRunRow(row) : null;
  }

  async listByExecutionId(executionId: string): Promise<CheckRun[]> {
    const numericExecutionId = Number(executionId);

    if (!Number.isInteger(numericExecutionId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(checkRunsTable)
      .where(eq(checkRunsTable.executionId, numericExecutionId))
      .orderBy(asc(checkRunsTable.id))
      .all();

    return rows.map(mapCheckRunRow);
  }

  async update(id: string, input: CheckRunUpdateInput): Promise<CheckRun> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      throw new Error(`Check run "${id}" is not a valid numeric check-run ID.`);
    }

    const existing = this.database.select().from(checkRunsTable).where(eq(checkRunsTable.id, numericId)).get();

    if (!existing) {
      throw new Error(`Check run "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(checkRunsTable)
      .set({
        status: input.status ?? existing.status,
        exitCode: input.exitCode ?? existing.exitCode,
        output: input.output ?? existing.output,
        updatedAt: new Date().toISOString()
      })
      .where(eq(checkRunsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapCheckRunRow(updated);
  }
}

export async function createSqliteCheckRunRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqliteCheckRunRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqliteCheckRunRepository(database, sqlite, filePath);
}

function mapCheckRunRow(row: typeof checkRunsTable.$inferSelect): CheckRun {
  return {
    id: String(row.id),
    executionId: String(row.executionId),
    name: row.name,
    command: row.command ?? undefined,
    status: row.status as CheckRun["status"],
    exitCode: row.exitCode ?? undefined,
    output: row.output,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
