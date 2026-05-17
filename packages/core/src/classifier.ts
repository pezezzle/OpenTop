import type { ComplexityLevel, ExecutionMode, RiskLevel } from "@opentop/shared";
import { getAgentProfile, getModel, getProvider, type OpenTopConfig } from "./config.js";
import type { Classification, TaskCategory, Ticket } from "./types.js";

const taskCategoryOrder: TaskCategory[] = [
  "security",
  "migration",
  "architecture",
  "integration",
  "refactor",
  "test",
  "docs",
  "bugfix",
  "small_change",
  "feature"
];

const taskIndicators: Record<TaskCategory, string[]> = {
  bugfix: ["bug", "fix", "broken", "failing", "regression", "error", "hotfix"],
  small_change: ["rename", "copy change", "label", "text change", "typo", "small change", "minor"],
  feature: ["feature", "add support", "new flow", "implement", "build"],
  architecture: ["architecture", "design", "platform", "foundation", "system design", "domain model"],
  refactor: ["refactor", "cleanup", "restructure", "technical debt", "simplify", "extract"],
  test: ["test", "coverage", "spec", "e2e", "unit test", "integration test"],
  docs: ["docs", "documentation", "readme", "changelog", "guide", "docs site"],
  security: ["security", "auth", "permission", "secret", "encryption", "vulnerability", "rbac"],
  migration: ["migration", "schema", "backfill", "upgrade", "data migration", "rollout"],
  integration: ["integration", "webhook", "queue", "sync", "third-party", "api contract", "event bus"]
};

const areaHints: Record<string, string[]> = {
  backend: ["api", "server", "endpoint", "database", "schema", "migration", "auth"],
  frontend: ["ui", "frontend", "react", "css", "layout", "button", "screen", "form"],
  tests: ["test", "coverage", "spec", "e2e", "unit"],
  docs: ["docs", "documentation", "readme", "changelog", "guide"],
  data: ["database", "schema", "backfill", "migration", "seed", "query"],
  ci: ["ci", "pipeline", "workflow", "github actions", "buildkite"],
  integration: ["integration", "webhook", "queue", "third-party", "sync", "event bus"],
  security: ["security", "auth", "permission", "secret", "rbac", "encryption"]
};

const criticalRiskKeywords = ["data loss", "sev0", "production outage", "incident", "credential leak"];
const highRiskKeywords = [
  "security",
  "auth",
  "permission",
  "migration",
  "billing",
  "multi-tenant",
  "tenant isolation",
  "breaking change"
];
const highComplexityKeywords = [
  "orchestration",
  "distributed",
  "cross-service",
  "platform",
  "state machine",
  "multi-step workflow"
];

export function classifyTicket(ticket: Ticket, config: OpenTopConfig): Classification {
  const analysis = analyzeTicket(ticket);
  const routingDecision = resolveRoutingDecision(ticket, analysis, config);
  const profile = getAgentProfile(config, routingDecision.profileId);
  const suggestedMode = routingDecision.mode ?? deriveSuggestedMode(analysis, profile.mode);
  const suggestedModelTier = routingDecision.modelTier ?? deriveSuggestedModelTier(analysis, profile.modelTier);
  const selectedModel = selectModelTarget(config, suggestedModelTier, suggestedMode, analysis);
  const approvalRequired =
    routingDecision.requiresApproval ??
    (profile.requiresApproval ||
      analysis.risk === "high" ||
      analysis.risk === "critical" ||
      analysis.taskType === "security" ||
      analysis.taskType === "migration");

  return {
    taskType: analysis.taskType,
    risk: analysis.risk,
    complexity: analysis.complexity,
    affectedAreas: analysis.affectedAreas,
    detectedSignals: analysis.detectedSignals,
    suggestedProfile: profile.id,
    suggestedProviderId: selectedModel.providerId,
    suggestedModelTier: selectedModel.tier,
    suggestedModel: selectedModel.modelId,
    suggestedMode,
    approvalRequired,
    reason: [
      `Classified ticket as "${analysis.taskType}" with ${analysis.risk} risk and ${analysis.complexity} complexity.`,
      `Matched profile "${profile.id}" and selected model tier "${selectedModel.tier}" (${selectedModel.providerId}/${selectedModel.modelId}).`,
      selectedModel.reason
    ].join(" ")
  };
}

interface TicketAnalysis {
  taskType: TaskCategory;
  risk: RiskLevel;
  complexity: ComplexityLevel;
  affectedAreas: string[];
  detectedSignals: string[];
  labels: string[];
  text: string;
}

interface RoutingDecision {
  profileId: string;
  modelTier?: string;
  mode?: ExecutionMode;
  requiresApproval?: boolean;
}

interface SelectedModelTarget {
  tier: string;
  providerId: string;
  modelId: string;
  reason: string;
}

function analyzeTicket(ticket: Ticket): TicketAnalysis {
  const labels = ticket.labels.map((label) => label.toLowerCase());
  const text = normalizeForMatching(`${ticket.title} ${ticket.description} ${ticket.labels.join(" ")}`);
  const detectedSignals = new Set<string>();
  const taskType = resolveTaskType(labels, text, detectedSignals);
  const affectedAreas = resolveAffectedAreas(text, detectedSignals);
  const risk = resolveRisk(labels, text, taskType, detectedSignals);
  const complexity = resolveComplexity(text, taskType, risk, affectedAreas, detectedSignals);

  return {
    taskType,
    risk,
    complexity,
    affectedAreas,
    detectedSignals: [...detectedSignals],
    labels,
    text
  };
}

function resolveTaskType(labels: string[], text: string, detectedSignals: Set<string>): TaskCategory {
  for (const taskType of taskCategoryOrder) {
    const matchedLabel = labels.find((label) => label === taskType || label.replace(/[_\s-]+/g, "_") === taskType);

    if (matchedLabel) {
      detectedSignals.add(`label:${matchedLabel}`);
      detectedSignals.add(`task:${taskType}`);
      return taskType;
    }
  }

  for (const taskType of taskCategoryOrder) {
    const matchedKeyword = taskIndicators[taskType].find((keyword) => containsIndicator(text, keyword));

    if (matchedKeyword) {
      detectedSignals.add(`keyword:${matchedKeyword}`);
      detectedSignals.add(`task:${taskType}`);
      return taskType;
    }
  }

  detectedSignals.add("task:feature");
  return "feature";
}

function resolveRisk(
  labels: string[],
  text: string,
  taskType: TaskCategory,
  detectedSignals: Set<string>
): RiskLevel {
  if (labels.includes("critical") || criticalRiskKeywords.some((keyword) => containsIndicator(text, keyword))) {
    detectedSignals.add(labels.includes("critical") ? "label:critical" : "risk:critical-keyword");
    return "critical";
  }

  if (
    taskType === "security" ||
    taskType === "migration" ||
    taskType === "architecture" ||
    highRiskKeywords.some((keyword) => containsIndicator(text, keyword))
  ) {
    detectedSignals.add(`risk:${taskType === "feature" ? "high-keyword" : taskType}`);
    return "high";
  }

  if (taskType === "docs" || taskType === "small_change" || taskType === "test" || taskType === "bugfix") {
    detectedSignals.add(`risk:${taskType}`);
    return "low";
  }

  return "medium";
}

function resolveComplexity(
  text: string,
  taskType: TaskCategory,
  risk: RiskLevel,
  affectedAreas: string[],
  detectedSignals: Set<string>
): ComplexityLevel {
  if (
    risk === "critical" ||
    taskType === "architecture" ||
    taskType === "migration" ||
    highComplexityKeywords.some((keyword) => containsIndicator(text, keyword)) ||
    affectedAreas.length >= 3
  ) {
    detectedSignals.add("complexity:high");
    return "high";
  }

  if (
    risk === "high" ||
    taskType === "feature" ||
    taskType === "refactor" ||
    taskType === "integration" ||
    affectedAreas.length >= 2
  ) {
    detectedSignals.add("complexity:medium");
    return "medium";
  }

  detectedSignals.add("complexity:low");
  return "low";
}

function resolveAffectedAreas(text: string, detectedSignals: Set<string>): string[] {
  const areas = new Set<string>();

  for (const [area, keywords] of Object.entries(areaHints)) {
    const matchedKeyword = keywords.find((keyword) => containsIndicator(text, keyword));

    if (matchedKeyword) {
      areas.add(area);
      detectedSignals.add(`area:${area}`);
      detectedSignals.add(`keyword:${matchedKeyword}`);
    }
  }

  return areas.size > 0 ? [...areas] : ["unknown"];
}

function resolveRoutingDecision(ticket: Ticket, analysis: TicketAnalysis, config: OpenTopConfig): RoutingDecision {
  const defaultRule = config.routing.rules.find((rule) => "default" in rule);

  if (!defaultRule || !("default" in defaultRule)) {
    throw new Error("OpenTop config requires a default routing rule.");
  }

  const matchedRule = config.routing.rules.find((rule) => "when" in rule && routingRuleMatches(rule.when, ticket, analysis));
  const action = matchedRule && "when" in matchedRule ? matchedRule : defaultRule.default;
  const profileId = action.profile ?? defaultRule.default.profile;

  return {
    profileId,
    modelTier: action.modelTier,
    mode: action.mode,
    requiresApproval: action.requiresApproval
  };
}

function routingRuleMatches(
  when: {
    labels?: string[];
    keywords?: string[];
    taskTypes?: TaskCategory[];
    risk?: RiskLevel[];
    complexity?: ComplexityLevel[];
    affectedAreas?: string[];
  },
  ticket: Ticket,
  analysis: TicketAnalysis
): boolean {
  const labelMatch =
    when.labels === undefined ||
    when.labels.some((label) => analysis.labels.includes(label.toLowerCase()));
  const keywordMatch =
    when.keywords === undefined ||
    when.keywords.some((keyword) => containsIndicator(analysis.text, keyword));
  const taskTypeMatch = when.taskTypes === undefined || when.taskTypes.includes(analysis.taskType);
  const riskMatch = when.risk === undefined || when.risk.includes(analysis.risk);
  const complexityMatch = when.complexity === undefined || when.complexity.includes(analysis.complexity);
  const areaMatch =
    when.affectedAreas === undefined ||
    when.affectedAreas.some((area) => analysis.affectedAreas.includes(area.toLowerCase()));

  if (labelMatch && keywordMatch && taskTypeMatch && riskMatch && complexityMatch && areaMatch) {
    return true;
  }

  return false;
}

function normalizeForMatching(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()} `;
}

function containsIndicator(normalizedText: string, indicator: string): boolean {
  const normalizedIndicator = normalizeForMatching(indicator).trim();

  if (!normalizedIndicator) {
    return false;
  }

  return normalizedText.includes(` ${normalizedIndicator} `);
}

function deriveSuggestedMode(analysis: TicketAnalysis, fallbackMode: ExecutionMode): ExecutionMode {
  if (analysis.taskType === "architecture" || analysis.taskType === "security" || analysis.taskType === "migration") {
    return "plan_only";
  }

  if (analysis.taskType === "feature" || analysis.taskType === "integration" || analysis.taskType === "refactor") {
    return analysis.complexity === "high" ? "plan_then_implement" : fallbackMode;
  }

  if (analysis.taskType === "docs") {
    return "implement_only";
  }

  if (analysis.taskType === "small_change") {
    return "implement_only";
  }

  return fallbackMode;
}

function deriveSuggestedModelTier(analysis: TicketAnalysis, fallbackTier: string): string {
  if (
    analysis.risk === "high" ||
    analysis.risk === "critical" ||
    analysis.complexity === "high" ||
    analysis.taskType === "feature" ||
    analysis.taskType === "architecture" ||
    analysis.taskType === "security" ||
    analysis.taskType === "migration" ||
    analysis.taskType === "integration" ||
    analysis.taskType === "refactor"
  ) {
    return "strong";
  }

  if (
    analysis.taskType === "bugfix" ||
    analysis.taskType === "small_change" ||
    analysis.taskType === "docs" ||
    analysis.taskType === "test"
  ) {
    return "cheap";
  }

  return fallbackTier;
}

function selectModelTarget(
  config: OpenTopConfig,
  preferredTier: string,
  suggestedMode: ExecutionMode,
  analysis: TicketAnalysis
): SelectedModelTarget {
  const candidates = Object.entries(config.models).map(([tier, model]) => {
    const provider = getProvider(config, model.provider);
    const capability = inferProviderRoutingHints(provider.type, provider.connection.method);
    const priority = buildTierPriority(preferredTier, config).indexOf(tier);
    const requiresWorkspace = modeRequiresLocalWorkspace(suggestedMode);
    const prefersWorkspace = requiresWorkspace || suggestedMode === "plan_then_implement";
    const prefersStructuredOutput =
      suggestedMode === "plan_only" ||
      suggestedMode === "review_only" ||
      suggestedMode === "plan_then_implement" ||
      analysis.complexity === "high";
    let score = 120 - Math.max(priority, 0) * 20;

    if (prefersWorkspace) {
      score += capability.supportsLocalWorkspace ? (requiresWorkspace ? 25 : 15) : requiresWorkspace ? -25 : -10;
    }

    if (prefersStructuredOutput) {
      score += capability.supportsStructuredOutput ? 25 : -10;
    }

    if (capability.supportsMultiRunOrchestration) {
      score += 5;
    }

    if (analysis.taskType === "security" || analysis.taskType === "architecture") {
      score += capability.supportsStructuredOutput ? 10 : 0;
    }

    return {
      tier,
      providerId: model.provider,
      modelId: model.model,
      score,
      capability
    };
  });

  if (candidates.length === 0) {
    const fallbackModel = getModel(config, preferredTier);
    return {
      tier: preferredTier,
      providerId: fallbackModel.provider,
      modelId: fallbackModel.model,
      reason: "No alternate model tiers were configured, so OpenTop kept the preferred tier."
    };
  }

  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  const selectedProvider = getProvider(config, selected.providerId);

  return {
    tier: selected.tier,
    providerId: selected.providerId,
    modelId: selected.modelId,
    reason: [
      modeRequiresLocalWorkspace(suggestedMode) && selected.capability.supportsLocalWorkspace
        ? `Selected provider "${selected.providerId}" because it can work with a local repository for mode "${suggestedMode}".`
        : `Selected provider "${selected.providerId}" as the best configured fit for mode "${suggestedMode}".`,
      selected.capability.supportsStructuredOutput
        ? "Structured output support improves planning and review-oriented tasks."
        : "Provider is treated as execution-first rather than structured-output-first.",
      `Provider type "${selectedProvider.type}" scored highest among configured model tiers.`
    ].join(" ")
  };
}

function buildTierPriority(preferredTier: string, config: OpenTopConfig): string[] {
  const configuredTiers = Object.keys(config.models);
  const preferredOrder =
    preferredTier === "cheap"
      ? ["cheap", "local", "strong"]
      : preferredTier === "local"
        ? ["local", "strong", "cheap"]
        : ["strong", "local", "cheap"];

  return [...new Set([...preferredOrder, preferredTier, ...configuredTiers])];
}

function inferProviderRoutingHints(type: string, method: string): {
  supportsLocalWorkspace: boolean;
  supportsStructuredOutput: boolean;
  supportsMultiRunOrchestration: boolean;
} {
  if (type === "codex-cli" || type === "custom-shell" || method === "local_cli" || method === "custom_command") {
    return {
      supportsLocalWorkspace: true,
      supportsStructuredOutput: false,
      supportsMultiRunOrchestration: true
    };
  }

  if (type === "anthropic-api" && method === "api_key") {
    return {
      supportsLocalWorkspace: false,
      supportsStructuredOutput: true,
      supportsMultiRunOrchestration: true
    };
  }

  if (
    (type === "openai-api" || type === "openrouter-api" || type === "deepseek-api") &&
    (method === "api_key" || method === "oauth")
  ) {
    return {
      supportsLocalWorkspace: false,
      supportsStructuredOutput: true,
      supportsMultiRunOrchestration: true
    };
  }

  if (type === "openai-codex" && method === "oauth") {
    return {
      supportsLocalWorkspace: false,
      supportsStructuredOutput: false,
      supportsMultiRunOrchestration: false
    };
  }

  return {
    supportsLocalWorkspace: method === "local_model",
    supportsStructuredOutput: false,
    supportsMultiRunOrchestration: method === "local_model"
  };
}

function modeRequiresLocalWorkspace(mode: ExecutionMode): boolean {
  return (
    mode === "implement_only" ||
    mode === "implement_and_test" ||
    mode === "fix_build" ||
    mode === "draft_pr"
  );
}
