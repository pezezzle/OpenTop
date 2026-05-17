import { desc, eq } from "drizzle-orm";
import type { Database } from "sql.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import type { WorkItem, WorkItemCreateInput, WorkItemRepository, WorkItemUpdateInput } from "@opentop/core";
import { createOpenTopSqliteContext, persistDatabase, type SqliteRepositoryOptions } from "./database.js";
import { workItemsTable } from "./schema.js";

export class SqliteWorkItemRepository implements WorkItemRepository {
  constructor(
    private readonly database: SQLJsDatabase<Record<string, never>>,
    private readonly sqlite: Database,
    readonly filePath: string
  ) {}

  async create(input: WorkItemCreateInput): Promise<WorkItem> {
    const timestamp = new Date().toISOString();
    const inserted = this.database
      .insert(workItemsTable)
      .values({
        workerPlanId: Number(input.workerPlanId),
        ticketId: Number(input.ticketId),
        sourcePlanArtifactId: Number(input.sourcePlanArtifactId),
        sourcePlanWorkItemId: input.sourcePlanWorkItemId,
        key: input.key,
        title: input.title,
        summary: input.summary,
        role: input.role,
        status: input.status,
        affectedAreasJson: JSON.stringify(input.affectedAreas),
        dependsOnJson: JSON.stringify(input.dependsOn),
        suggestedProviderId: input.suggestedProviderId,
        suggestedModelTier: input.suggestedModelTier,
        suggestedModelId: input.suggestedModelId,
        suggestedMode: input.suggestedMode,
        branchStrategy: input.branchStrategy,
        reviewNotesJson: JSON.stringify(input.reviewNotes),
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapWorkItemRow(inserted);
  }

  async findById(id: string): Promise<WorkItem | null> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      return null;
    }

    const row = this.database.select().from(workItemsTable).where(eq(workItemsTable.id, numericId)).get();
    return row ? mapWorkItemRow(row) : null;
  }

  async listByTicketId(ticketId: string): Promise<WorkItem[]> {
    const numericTicketId = Number(ticketId);
    if (!Number.isInteger(numericTicketId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(workItemsTable)
      .where(eq(workItemsTable.ticketId, numericTicketId))
      .orderBy(desc(workItemsTable.id))
      .all();

    return rows.map(mapWorkItemRow);
  }

  async listByWorkerPlanId(workerPlanId: string): Promise<WorkItem[]> {
    const numericWorkerPlanId = Number(workerPlanId);
    if (!Number.isInteger(numericWorkerPlanId)) {
      return [];
    }

    const rows = this.database
      .select()
      .from(workItemsTable)
      .where(eq(workItemsTable.workerPlanId, numericWorkerPlanId))
      .orderBy(desc(workItemsTable.id))
      .all();

    return rows.map(mapWorkItemRow);
  }

  async update(id: string, input: WorkItemUpdateInput): Promise<WorkItem> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      throw new Error(`Work item "${id}" is not a valid numeric work item ID.`);
    }

    const existing = this.database.select().from(workItemsTable).where(eq(workItemsTable.id, numericId)).get();
    if (!existing) {
      throw new Error(`Work item "${id}" was not found in the local OpenTop store.`);
    }

    const updated = this.database
      .update(workItemsTable)
      .set({
        title: input.title ?? existing.title,
        summary: input.summary ?? existing.summary,
        role: input.role ?? existing.role,
        status: input.status ?? existing.status,
        affectedAreasJson: input.affectedAreas ? JSON.stringify(input.affectedAreas) : existing.affectedAreasJson,
        dependsOnJson: input.dependsOn ? JSON.stringify(input.dependsOn) : existing.dependsOnJson,
        suggestedProviderId: input.suggestedProviderId ?? existing.suggestedProviderId,
        suggestedModelTier: input.suggestedModelTier ?? existing.suggestedModelTier,
        suggestedModelId: input.suggestedModelId ?? existing.suggestedModelId,
        suggestedMode: input.suggestedMode ?? existing.suggestedMode,
        branchStrategy: input.branchStrategy ?? existing.branchStrategy,
        reviewNotesJson: input.reviewNotes ? JSON.stringify(input.reviewNotes) : existing.reviewNotesJson,
        updatedAt: new Date().toISOString()
      })
      .where(eq(workItemsTable.id, numericId))
      .returning()
      .get();

    await persistDatabase(this.sqlite, this.filePath);
    return mapWorkItemRow(updated);
  }
}

export async function createSqliteWorkItemRepository(
  options: SqliteRepositoryOptions = {}
): Promise<SqliteWorkItemRepository> {
  const { database, sqlite, filePath } = await createOpenTopSqliteContext(options);
  return new SqliteWorkItemRepository(database, sqlite, filePath);
}

function mapWorkItemRow(row: typeof workItemsTable.$inferSelect): WorkItem {
  return {
    id: String(row.id),
    workerPlanId: String(row.workerPlanId),
    ticketId: String(row.ticketId),
    sourcePlanArtifactId: String(row.sourcePlanArtifactId),
    sourcePlanWorkItemId: row.sourcePlanWorkItemId ?? undefined,
    key: row.key,
    title: row.title,
    summary: row.summary,
    role: row.role as WorkItem["role"],
    status: row.status as WorkItem["status"],
    affectedAreas: parseStringArray(row.affectedAreasJson),
    dependsOn: parseStringArray(row.dependsOnJson),
    suggestedProviderId: row.suggestedProviderId,
    suggestedModelTier: row.suggestedModelTier,
    suggestedModelId: row.suggestedModelId,
    suggestedMode: row.suggestedMode as WorkItem["suggestedMode"],
    branchStrategy: row.branchStrategy as WorkItem["branchStrategy"],
    reviewNotes: parseStringArray(row.reviewNotesJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}
