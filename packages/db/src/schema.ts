import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ticketsTable = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  externalId: text("external_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  labels: text("labels").notNull(),
  status: text("status").notNull(),
  resolutionType: text("resolution_type"),
  resolutionNote: text("resolution_note"),
  resolvedAt: text("resolved_at"),
  reopenedAt: text("reopened_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const executionsTable = sqliteTable("executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull(),
  workerPlanId: integer("worker_plan_id"),
  workItemId: integer("work_item_id"),
  profileId: text("profile_id").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  status: text("status").notNull(),
  runKind: text("run_kind").notNull(),
  branchName: text("branch_name").notNull(),
  workspacePath: text("workspace_path").notNull(),
  promptSnapshot: text("prompt_snapshot").notNull(),
  classificationJson: text("classification_json").notNull(),
  artifactKind: text("artifact_kind").notNull(),
  outputKind: text("output_kind"),
  outputText: text("output_text"),
  reviewStatus: text("review_status").notNull(),
  reviewerComment: text("reviewer_comment"),
  reviewedAt: text("reviewed_at"),
  diffSummaryJson: text("diff_summary_json"),
  riskSummaryJson: text("risk_summary_json"),
  pullRequestJson: text("pull_request_json"),
  logs: text("logs").notNull(),
  changedFiles: text("changed_files").notNull(),
  pullRequestUrl: text("pull_request_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const checkRunsTable = sqliteTable("check_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  executionId: integer("execution_id").notNull(),
  name: text("name").notNull(),
  command: text("command"),
  status: text("status").notNull(),
  exitCode: integer("exit_code"),
  output: text("output").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const promptReviewsTable = sqliteTable("prompt_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  promptSnapshot: text("prompt_snapshot").notNull(),
  sourcesJson: text("sources_json").notNull(),
  contextSummaryJson: text("context_summary_json").notNull(),
  classificationJson: text("classification_json").notNull(),
  intelligenceJson: text("intelligence_json"),
  executionPlanJson: text("execution_plan_json").notNull(),
  reviewerComment: text("reviewer_comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const planArtifactsTable = sqliteTable("plan_artifacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull(),
  sourceExecutionId: integer("source_execution_id").notNull(),
  sourcePromptReviewId: integer("source_prompt_review_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  rawOutput: text("raw_output").notNull(),
  structuredPlanJson: text("structured_plan_json").notNull(),
  classificationJson: text("classification_json").notNull(),
  executionPlanJson: text("execution_plan_json").notNull(),
  reviewerComment: text("reviewer_comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const workerPlansTable = sqliteTable("worker_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull(),
  sourcePlanArtifactId: integer("source_plan_artifact_id").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  integrationSummary: text("integration_summary"),
  classificationJson: text("classification_json").notNull(),
  executionPlanJson: text("execution_plan_json").notNull(),
  reviewerComment: text("reviewer_comment"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const workItemsTable = sqliteTable("work_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workerPlanId: integer("worker_plan_id").notNull(),
  ticketId: integer("ticket_id").notNull(),
  sourcePlanArtifactId: integer("source_plan_artifact_id").notNull(),
  sourcePlanWorkItemId: text("source_plan_work_item_id"),
  key: text("key").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  affectedAreasJson: text("affected_areas_json").notNull(),
  dependsOnJson: text("depends_on_json").notNull(),
  suggestedProviderId: text("suggested_provider_id").notNull(),
  suggestedModelTier: text("suggested_model_tier").notNull(),
  suggestedModelId: text("suggested_model_id").notNull(),
  suggestedMode: text("suggested_mode").notNull(),
  branchStrategy: text("branch_strategy").notNull(),
  reviewNotesJson: text("review_notes_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
