export const OPENTOP_NAME = "OpenTop";
export const OPENTOP_FULL_NAME = "Open Ticket Orchestrator Platform";
export const OPENTOP_CLAIM = "The control plane for agentic software development.";

export type TicketSource = "manual" | "github" | "linear" | "jira" | "trello" | "azure-devops";
export type TicketStatus = "inbox" | "classified" | "ready" | "running" | "review" | "done";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ComplexityLevel = "low" | "medium" | "high";
export type ExecutionMode =
  | "plan_only"
  | "implement_only"
  | "implement_and_test"
  | "plan_then_implement"
  | "review_only"
  | "fix_build"
  | "draft_pr";

export type ExecutionBranchPolicy = "new" | "reuse-current" | "manual" | "none";
export type ExecutionStatus =
  | "planned"
  | "queued"
  | "running"
  | "succeeded"
  | "output_ready"
  | "failed"
  | "cancelled";
