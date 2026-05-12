import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { findOpenTopDirectory, type Ticket, type TicketCreateInput, type TicketRepository } from "@opentop/core";
import initSqlJs, { type Database } from "sql.js";
import { ticketsTable } from "./schema.js";

export interface SqliteTicketRepositoryOptions {
  filePath?: string;
  startDirectory?: string;
}

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
}

export async function createSqliteTicketRepository(
  options: SqliteTicketRepositoryOptions = {}
): Promise<SqliteTicketRepository> {
  const filePath = await resolveDatabasePath(options);
  await mkdir(dirname(filePath), { recursive: true });

  const SQL = await initSqlJs();
  const databaseBuffer = await readDatabaseFile(filePath);
  const sqlite = databaseBuffer ? new SQL.Database(databaseBuffer) : new SQL.Database();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      labels TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await persistDatabase(sqlite, filePath);

  const database = drizzle(sqlite);
  return new SqliteTicketRepository(database, sqlite, filePath);
}

async function resolveDatabasePath(options: SqliteTicketRepositoryOptions): Promise<string> {
  if (options.filePath) {
    return resolve(options.filePath);
  }

  const openTopDirectory = await findOpenTopDirectory(options.startDirectory);
  return join(openTopDirectory, "state", "opentop.db");
}

async function readDatabaseFile(filePath: string): Promise<Uint8Array | undefined> {
  try {
    await access(filePath);
    const file = await readFile(filePath);
    return new Uint8Array(file);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function persistDatabase(sqlite: Database, filePath: string): Promise<void> {
  const bytes = sqlite.export();
  await writeFile(filePath, Buffer.from(bytes));
}

function mapTicketRow(row: typeof ticketsTable.$inferSelect): Ticket {
  return {
    id: String(row.id),
    source: row.source as Ticket["source"],
    externalId: row.externalId ?? undefined,
    title: row.title,
    description: row.description,
    labels: parseLabels(row.labels),
    status: row.status as Ticket["status"]
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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
