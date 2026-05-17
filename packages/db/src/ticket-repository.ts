import { desc, eq } from "drizzle-orm";
import {
  findOpenTopDirectory,
  type Ticket,
  type TicketCreateInput,
  type TicketRepository,
  type TicketUpdateInput
} from "@opentop/core";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { ticketsTable } from "./schema.js";

export class SqliteTicketRepository implements TicketRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: TicketCreateInput): Promise<Ticket> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(ticketsTable)
      .values({
        source: input.source,
        externalId: input.externalId,
        title: input.title,
      description: input.description,
      labels: JSON.stringify(input.labels),
      status: input.status ?? "inbox",
      resolutionType: input.resolutionType ?? null,
      resolutionNote: input.resolutionNote ?? null,
      resolvedAt: input.resolvedAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapTicketRow(inserted);
  }

  async findById(id: string): Promise<Ticket | null> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(ticketsTable).where(eq(ticketsTable.id, numericId)).get();
    return row ? mapTicketRow(row) : null;
  }

  async list(): Promise<Ticket[]> {
    const rows = this.database.select().from(ticketsTable).orderBy(desc(ticketsTable.id)).all();
    return rows.map(mapTicketRow);
  }

  async update(id: string, input: TicketUpdateInput): Promise<Ticket> {
    const numericId = Number(id);

    if (!Number.isInteger(numericId)) {
      throw new Error(`Ticket "${id}" is not a valid numeric ticket id.`);
    }

    const current = this.database.select().from(ticketsTable).where(eq(ticketsTable.id, numericId)).get();

    if (!current) {
      throw new Error(`Ticket "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(ticketsTable)
      .set({
        status: input.status ?? current.status,
        resolutionType: input.resolutionType ?? null,
        resolutionNote: input.resolutionNote ?? null,
        resolvedAt: input.resolvedAt ?? null,
        updatedAt: new Date().toISOString()
      })
      .where(eq(ticketsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapTicketRow(updated);
  }
}

export async function createSqliteTicketRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqliteTicketRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqliteTicketRepository(database, sqlite, filePath);
}

function mapTicketRow(row: typeof ticketsTable.$inferSelect): Ticket {
  return {
    id: String(row.id),
    source: row.source as Ticket["source"],
    externalId: row.externalId ?? undefined,
    title: row.title,
    description: row.description,
    labels: parseLabels(row.labels),
    status: row.status as Ticket["status"],
    resolutionType: (row.resolutionType as Ticket["resolutionType"] | null) ?? undefined,
    resolutionNote: row.resolutionNote ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined
  };
}

function parseLabels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}
