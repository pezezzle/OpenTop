import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { findOpenTopDirectory } from "@opentop/core";
import initSqlJs, { type Database } from "sql.js";

export interface SqliteRepositoryOptions {
  filePath?: string;
  startDirectory?: string;
}

export interface OpenTopSqliteContext {
  database: SQLJsDatabase<Record<string, never>>;
  sqlite: Database;
  filePath: string;
}

export async function createOpenTopSqliteContext(
  options: SqliteRepositoryOptions = {}
): Promise<OpenTopSqliteContext> {
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
    );

    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      profile_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      logs TEXT NOT NULL,
      changed_files TEXT NOT NULL,
      pull_request_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    database: drizzle(sqlite),
    sqlite,
    filePath
  };
}

export async function persistDatabase(sqlite: Database, filePath: string): Promise<void> {
  const bytes = sqlite.export();
  await writeFile(filePath, Buffer.from(bytes));
}

async function resolveDatabasePath(options: SqliteRepositoryOptions): Promise<string> {
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

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
