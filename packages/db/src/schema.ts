import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ticketsTable = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  externalId: text("external_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  labels: text("labels").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const executionsTable = sqliteTable("executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull(),
  profileId: text("profile_id").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  status: text("status").notNull(),
  branchName: text("branch_name").notNull(),
  promptSnapshot: text("prompt_snapshot").notNull(),
  classificationJson: text("classification_json").notNull(),
  logs: text("logs").notNull(),
  changedFiles: text("changed_files").notNull(),
  pullRequestUrl: text("pull_request_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
