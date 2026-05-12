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
