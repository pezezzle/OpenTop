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
  schemaVersion: number;
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
    CREATE TABLE IF NOT EXISTS opentop_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

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
      worker_plan_id INTEGER,
      work_item_id INTEGER,
      profile_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      run_kind TEXT NOT NULL DEFAULT 'ticket',
      branch_name TEXT NOT NULL,
      workspace_path TEXT NOT NULL DEFAULT '',
      prompt_snapshot TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      artifact_kind TEXT NOT NULL DEFAULT 'workspace_changes',
      output_kind TEXT,
      output_text TEXT,
      review_status TEXT NOT NULL DEFAULT 'not_required',
      reviewer_comment TEXT,
      reviewed_at TEXT,
      diff_summary_json TEXT,
      risk_summary_json TEXT,
      pull_request_json TEXT,
      logs TEXT NOT NULL,
      changed_files TEXT NOT NULL,
      pull_request_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      context_summary_json TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      execution_plan_json TEXT NOT NULL,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      source_execution_id INTEGER NOT NULL,
      source_prompt_review_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      raw_output TEXT NOT NULL,
      structured_plan_json TEXT NOT NULL,
      classification_json TEXT NOT NULL,
      execution_plan_json TEXT NOT NULL,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worker_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      source_plan_artifact_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      integration_summary TEXT,
      classification_json TEXT NOT NULL,
      execution_plan_json TEXT NOT NULL,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_plan_id INTEGER NOT NULL,
      ticket_id INTEGER NOT NULL,
      source_plan_artifact_id INTEGER NOT NULL,
      source_plan_work_item_id TEXT,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      affected_areas_json TEXT NOT NULL,
      depends_on_json TEXT NOT NULL,
      suggested_provider_id TEXT NOT NULL,
      suggested_model_tier TEXT NOT NULL,
      suggested_model_id TEXT NOT NULL,
      suggested_mode TEXT NOT NULL,
      branch_strategy TEXT NOT NULL,
      review_notes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS check_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      command TEXT,
      status TEXT NOT NULL,
      exit_code INTEGER,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const schemaVersion = applySchemaMigrations(sqlite);

  return {
    database: drizzle(sqlite),
    sqlite,
    filePath,
    schemaVersion
  };
}

export function getSchemaVersion(sqlite: Database): number {
  try {
    const result = sqlite.exec("SELECT value FROM opentop_meta WHERE key = 'schema_version';");
    const raw = result[0]?.values?.[0]?.[0];
    const parsed = Number(raw ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function applySchemaMigrations(sqlite: Database): number {
  const currentVersion = getSchemaVersion(sqlite);
  const migrations = [
    {
      version: 1,
      apply: () => {
        ensureExecutionColumn(sqlite, "artifact_kind", "TEXT NOT NULL DEFAULT 'workspace_changes'");
        ensureExecutionColumn(sqlite, "worker_plan_id", "INTEGER");
        ensureExecutionColumn(sqlite, "work_item_id", "INTEGER");
        ensureExecutionColumn(sqlite, "run_kind", "TEXT NOT NULL DEFAULT 'ticket'");
        ensureExecutionColumn(sqlite, "workspace_path", "TEXT NOT NULL DEFAULT ''");
        ensureExecutionColumn(sqlite, "output_kind", "TEXT");
        ensureExecutionColumn(sqlite, "output_text", "TEXT");
      }
    },
    {
      version: 2,
      apply: () => {
        ensureExecutionColumn(sqlite, "review_status", "TEXT NOT NULL DEFAULT 'not_required'");
        ensureExecutionColumn(sqlite, "reviewer_comment", "TEXT");
        ensureExecutionColumn(sqlite, "reviewed_at", "TEXT");
        ensureExecutionColumn(sqlite, "diff_summary_json", "TEXT");
        ensureExecutionColumn(sqlite, "risk_summary_json", "TEXT");
        ensureExecutionColumn(sqlite, "pull_request_json", "TEXT");
      }
    },
    {
      version: 3,
      apply: () => {
        ensureWorkerPlanColumn(sqlite, "integration_summary", "TEXT");
      }
    }
  ];

  let appliedVersion = currentVersion;

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    migration.apply();
    appliedVersion = migration.version;
    setMetaValue(sqlite, "schema_version", String(appliedVersion));
  }

  if (appliedVersion === 0) {
    setMetaValue(sqlite, "schema_version", String(migrations.at(-1)?.version ?? 0));
    return migrations.at(-1)?.version ?? 0;
  }

  return appliedVersion;
}

function ensureExecutionColumn(sqlite: Database, columnName: string, columnDefinition: string): void {
  const result = sqlite.exec("PRAGMA table_info(executions);");
  const columns =
    result[0]?.values
      ?.map((row) => String(row[1]))
      .filter((value) => value.length > 0) ?? [];

  if (columns.includes(columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE executions ADD COLUMN ${columnName} ${columnDefinition};`);
}

function ensureWorkerPlanColumn(sqlite: Database, columnName: string, columnDefinition: string): void {
  const result = sqlite.exec("PRAGMA table_info(worker_plans);");
  const columns =
    result[0]?.values
      ?.map((row) => String(row[1]))
      .filter((value) => value.length > 0) ?? [];

  if (columns.includes(columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE worker_plans ADD COLUMN ${columnName} ${columnDefinition};`);
}

function setMetaValue(sqlite: Database, key: string, value: string): void {
  const escapedKey = escapeSqlString(key);
  const escapedValue = escapeSqlString(value);
  sqlite.exec(`
    INSERT INTO opentop_meta (key, value)
    VALUES ('${escapedKey}', '${escapedValue}')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  `);
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
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
