import type { ComplexityLevel, RiskLevel } from "@opentop/shared";
import { getAgentProfile, getModel, type OpenTopConfig } from "./config.js";
import type { Classification, Ticket } from "./types.js";

const highRiskKeywords = ["architecture", "auth", "security", "migration", "multi-tenant"];
const backendHints = ["api", "database", "schema", "migration", "auth", "server"];
const frontendHints = ["ui", "frontend", "react", "css", "layout", "button"];
const testHints = ["test", "coverage", "spec", "e2e"];

export function classifyTicket(ticket: Ticket, config: OpenTopConfig): Classification {
  const profileId = resolveProfileId(ticket, config);
  const profile = getAgentProfile(config, profileId);
  const model = getModel(config, profile.modelTier);
  const searchableText = `${ticket.title} ${ticket.description} ${ticket.labels.join(" ")}`.toLowerCase();
  const risk = resolveRisk(ticket, searchableText, profile.requiresApproval);
  const complexity = resolveComplexity(searchableText, risk);
  const affectedAreas = resolveAffectedAreas(searchableText);

  return {
    risk,
    complexity,
    affectedAreas,
    suggestedProfile: profile.id,
    suggestedModelTier: profile.modelTier,
    suggestedMode: profile.mode,
    approvalRequired: profile.requiresApproval || risk === "high" || risk === "critical",
    reason: `Matched profile "${profile.id}" with model tier "${profile.modelTier}" (${model.provider}/${model.model}).`
  };
}

function resolveProfileId(ticket: Ticket, config: OpenTopConfig): string {
  const labels = ticket.labels.map((label) => label.toLowerCase());
  const text = `${ticket.title} ${ticket.description}`.toLowerCase();

  for (const rule of config.routing.rules) {
    if ("default" in rule) {
      continue;
    }

    const labelMatch = rule.when.labels?.some((label) => labels.includes(label.toLowerCase())) ?? false;
    const keywordMatch = rule.when.keywords?.some((keyword) => text.includes(keyword.toLowerCase())) ?? false;

    if (labelMatch || keywordMatch) {
      return rule.profile;
    }
  }

  const defaultRule = config.routing.rules.find((rule) => "default" in rule);

  if (!defaultRule || !("default" in defaultRule)) {
    throw new Error("OpenTop config requires a default routing rule.");
  }

  return defaultRule.default.profile;
}

function resolveRisk(ticket: Ticket, text: string, profileRequiresApproval: boolean): RiskLevel {
  if (ticket.labels.some((label) => label.toLowerCase() === "critical")) {
    return "critical";
  }

  if (profileRequiresApproval || highRiskKeywords.some((keyword) => text.includes(keyword))) {
    return "high";
  }

  if (ticket.labels.some((label) => ["bug", "docs", "chore"].includes(label.toLowerCase()))) {
    return "low";
  }

  return "medium";
}

function resolveComplexity(text: string, risk: RiskLevel): ComplexityLevel {
  if (risk === "critical" || risk === "high") {
    return "high";
  }

  const complexityHints = ["refactor", "integration", "workflow", "state", "database", "queue"];
  return complexityHints.some((keyword) => text.includes(keyword)) ? "medium" : "low";
}

function resolveAffectedAreas(text: string): string[] {
  const areas = new Set<string>();

  if (backendHints.some((keyword) => text.includes(keyword))) {
    areas.add("backend");
  }

  if (frontendHints.some((keyword) => text.includes(keyword))) {
    areas.add("frontend");
  }

  if (testHints.some((keyword) => text.includes(keyword))) {
    areas.add("tests");
  }

  return areas.size > 0 ? [...areas] : ["unknown"];
}
