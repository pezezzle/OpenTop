import { getAgentProfile, getModel, type OpenTopConfig } from "./config.js";
import { classifyTicket } from "./classifier.js";
import type { ExecutionPlan, Ticket } from "./types.js";

export function createExecutionPlan(ticket: Ticket, config: OpenTopConfig): ExecutionPlan {
  const classification = ticket.classification ?? classifyTicket(ticket, config);
  const profile = getAgentProfile(config, classification.suggestedProfile);
  const model = getModel(config, profile.modelTier);

  return {
    ticket,
    classification,
    profile,
    providerId: model.provider,
    modelId: model.model,
    branchName: createBranchName(ticket)
  };
}

export function createBranchName(ticket: Ticket): string {
  const issuePart = ticket.externalId ?? ticket.id;
  const slug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `opentop/issue-${issuePart}-${slug || "ticket"}`;
}
