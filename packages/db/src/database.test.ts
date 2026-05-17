import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenTopSqliteContext, getSchemaVersion, persistDatabase } from "./database.js";

test("createOpenTopSqliteContext initializes and persists the latest schema version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opentop-db-"));
  const filePath = join(directory, "opentop.db");

  try {
    const first = await createOpenTopSqliteContext({ filePath });
    assert.equal(first.schemaVersion, 5);
    assert.equal(getSchemaVersion(first.sqlite), 5);

    await persistDatabase(first.sqlite, first.filePath);
    first.sqlite.close();

    const reopened = await createOpenTopSqliteContext({ filePath });
    assert.equal(reopened.schemaVersion, 5);
    assert.equal(getSchemaVersion(reopened.sqlite), 5);
    reopened.sqlite.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createOpenTopSqliteContext upgrades older execution schemas in place", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opentop-db-"));
  const filePath = join(directory, "legacy.db");

  try {
    const legacy = await createOpenTopSqliteContext({ filePath });
    legacy.sqlite.exec("DELETE FROM opentop_meta WHERE key = 'schema_version';");
    legacy.sqlite.exec("ALTER TABLE executions RENAME TO executions_latest;");
    legacy.sqlite.exec(`
      CREATE TABLE executions (
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
    legacy.sqlite.exec("DROP TABLE executions_latest;");
    await persistDatabase(legacy.sqlite, filePath);
    legacy.sqlite.close();

    const upgraded = await createOpenTopSqliteContext({ filePath });
    const columns = upgraded.sqlite
      .exec("PRAGMA table_info(executions);")[0]
      ?.values?.map((row) => String(row[1])) ?? [];

    const ticketColumns = upgraded.sqlite
      .exec("PRAGMA table_info(tickets);")[0]
      ?.values?.map((row) => String(row[1])) ?? [];

    assert.equal(upgraded.schemaVersion, 5);
    assert.ok(columns.includes("artifact_kind"));
    assert.ok(columns.includes("review_status"));
    assert.ok(columns.includes("pull_request_json"));
    assert.ok(ticketColumns.includes("resolution_type"));
    assert.ok(ticketColumns.includes("resolution_note"));
    assert.ok(ticketColumns.includes("resolved_at"));
    assert.ok(ticketColumns.includes("reopened_at"));
    upgraded.sqlite.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
