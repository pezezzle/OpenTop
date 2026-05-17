import type { ExecutionMode, RiskLevel } from "@opentop/shared";
import { getAgentProfile, getModel, type OpenTopConfig } from "./config.js";
import { classifyTicket } from "./classifier.js";
import type { ExecutionProvider } from "./repositories.js";
import type {
  Classification,
  RefinedTicketBrief,
  TaskCategory,
  Ticket,
  TicketIntelligenceResult,
  TicketIntelligenceService,
  TicketIntelligenceSummary
} from "./types.js";

const TASK_TYPES = [
  "bugfix",
  "small_change",
  "feature",
  "architecture",
  "refactor",
  "test",
  "docs",
  "security",
  "migration",
  "integration"
] satisfies TaskCategory[];

const RISK_LEVELS = ["low", "medium", "high", "critical"] satisfies RiskLevel[];
const COMPLEXITY_LEVELS = ["low", "medium", "high"] as const;
const EXECUTION_MODES = [
  "plan_only",
  "implement_only",
  "implement_and_test",
  "plan_then_implement",
  "review_only",
  "fix_build",
  "draft_pr"
] satisfies ExecutionMode[];

export interface ResolveTicketIntelligenceInput {
  ticket: Ticket;
  config: OpenTopConfig;
  repositoryPath: string;
  intelligenceService?: TicketIntelligenceService;
}

export interface ResolveTicketIntelligenceResult {
  classification: Classification;
  intelligenceSummary?: TicketIntelligenceSummary;
}

export interface CreateAiTicketIntelligenceServiceOptions {
  providerId: string;
  model: string;
  executionProvider: ExecutionProvider;
}

export async function resolveTicketIntelligence(
  input: ResolveTicketIntelligenceInput
): Promise<ResolveTicketIntelligenceResult> {
  const deterministicClassification = classifyTicket(input.ticket, input.config);

  if (!input.intelligenceService) {
    return {
      classification: deterministicClassification,
      intelligenceSummary: {
        source: "deterministic",
        missingInformation: []
      }
    };
  }

  try {
    const assisted = await input.intelligenceService.analyze({
      ticket: input.ticket,
      deterministicClassification,
      config: input.config,
      repositoryPath: input.repositoryPath
    });

    if (!assisted) {
      return {
        classification: deterministicClassification,
        intelligenceSummary: {
          source: "deterministic",
          missingInformation: []
        }
      };
    }

    const classification = mergeClassification(input.config, deterministicClassification, assisted);

    return {
      classification,
      intelligenceSummary: {
        source: "ai_assisted",
        confidence: assisted.confidence,
        reasoning: assisted.classification.reason ?? classification.reason,
        missingInformation: assisted.missingInformation ?? [],
        refinedBrief: normalizeRefinedBrief(assisted.refinedBrief)
      }
    };
  } catch {
    return {
      classification: deterministicClassification,
      intelligenceSummary: {
        source: "deterministic",
        missingInformation: []
      }
    };
  }
}

export function createAiTicketIntelligenceService(
  options: CreateAiTicketIntelligenceServiceOptions
): TicketIntelligenceService {
  return {
    async analyze(request) {
      const response = await options.executionProvider.run({
        ticketTitle: request.ticket.title,
        ticketDescription: request.ticket.description,
        repositoryPath: request.repositoryPath,
        branchName: "none",
        agentProfile: "ticket-intelligence",
        model: options.model,
        mode: "review_only",
        projectRules: "",
        prompt: buildTicketIntelligencePrompt(request, options)
      });

      if (!response.success) {
        return null;
      }

      return parseTicketIntelligenceResponse(response.summary || response.outputText || "");
    }
  };
}

function mergeClassification(config: OpenTopConfig, deterministic: Classification, assisted: TicketIntelligenceResult): Classification {
  const taskType = isTaskType(assisted.classification.taskType) ? assisted.classification.taskType : deterministic.taskType;
  const risk = isRiskLevel(assisted.classification.risk) ? assisted.classification.risk : deterministic.risk;
  const complexity = isComplexityLevel(assisted.classification.complexity)
    ? assisted.classification.complexity
    : deterministic.complexity;
  const affectedAreas = normalizeStringList(assisted.classification.affectedAreas, deterministic.affectedAreas);
  const detectedSignals = normalizeStringList(assisted.classification.detectedSignals, deterministic.detectedSignals);
  const suggestedProfile = resolveSuggestedProfile(config, assisted.classification.suggestedProfile, deterministic.suggestedProfile);
  const baseProfile = getAgentProfile(config, suggestedProfile);
  const suggestedModelTier = resolveSuggestedModelTier(config, assisted.classification.suggestedModelTier, baseProfile.modelTier);
  const model = getModel(config, suggestedModelTier);
  const suggestedMode = resolveSuggestedMode(assisted.classification.suggestedMode, baseProfile.mode);
  const approvalRequired =
    assisted.classification.approvalRequired ??
    baseProfile.requiresApproval ??
    deterministic.approvalRequired;
  const reason = assisted.classification.reason?.trim()
    ? `AI-assisted classification: ${assisted.classification.reason.trim()}`
    : deterministic.reason;

  return {
    taskType,
    risk,
    complexity,
    affectedAreas,
    detectedSignals: detectedSignals.length > 0 ? uniqueList([...detectedSignals, "ai-assisted"]) : [...deterministic.detectedSignals, "ai-assisted"],
    suggestedProfile,
    suggestedProviderId: model.provider,
    suggestedModelTier,
    suggestedModel: model.model,
    suggestedMode,
    approvalRequired,
    reason
  };
}

function normalizeRefinedBrief(brief: RefinedTicketBrief | undefined): RefinedTicketBrief | undefined {
  if (!brief) {
    return undefined;
  }

  const summary = brief.summary?.trim() ?? "";
  const objective = brief.objective?.trim() ?? "";
  const scope = normalizeStringList(brief.scope, []);
  const acceptanceCriteria = normalizeStringList(brief.acceptanceCriteria, []);
  const constraints = normalizeStringList(brief.constraints, []);
  const openQuestions = normalizeStringList(brief.openQuestions, []);

  if (
    summary.length === 0 &&
    objective.length === 0 &&
    scope.length === 0 &&
    acceptanceCriteria.length === 0 &&
    constraints.length === 0 &&
    openQuestions.length === 0
  ) {
    return undefined;
  }

  return {
    summary,
    objective,
    scope,
    acceptanceCriteria,
    constraints,
    openQuestions
  };
}

function buildTicketIntelligencePrompt(
  request: {
    ticket: Ticket;
    deterministicClassification: Classification;
    config: OpenTopConfig;
  },
  options: CreateAiTicketIntelligenceServiceOptions
): string {
  const profileGuidance = Object.entries(request.config.agentProfiles)
    .map(([id, profile]) => {
      return `- ${id}: mode=${profile.mode}, modelTier=${profile.modelTier}, requiresApproval=${profile.requiresApproval ? "yes" : "no"}${profile.description ? `, description=${profile.description}` : ""}`;
    })
    .join("\n");
  const modelTiers = Object.entries(request.config.models)
    .map(([tier, model]) => `- ${tier}: provider=${model.provider}, model=${model.model}`)
    .join("\n");

  return [
    "You are OpenTop's ticket intelligence layer.",
    "Return JSON only. Do not wrap it in markdown fences.",
    "",
    "Allowed values:",
    `- taskType: ${TASK_TYPES.join(", ")}`,
    `- risk: ${RISK_LEVELS.join(", ")}`,
    `- complexity: ${COMPLEXITY_LEVELS.join(", ")}`,
    `- suggestedMode: ${EXECUTION_MODES.join(", ")}`,
    "",
    "Agent profiles:",
    profileGuidance,
    "",
    "Available model tiers:",
    modelTiers,
    "",
    "Current deterministic baseline:",
    JSON.stringify(request.deterministicClassification, null, 2),
    "",
    "Ticket:",
    JSON.stringify(
      {
        title: request.ticket.title,
        description: request.ticket.description,
        labels: request.ticket.labels
      },
      null,
      2
    ),
    "",
    "Choose the best execution framing for this ticket. Improve the user's intent, not just the wording.",
    "Use conservative approval guidance for auth, security, migrations, destructive data changes, or unclear high-risk work.",
    "",
    "Return this exact JSON shape:",
    JSON.stringify(
      {
        classification: {
          taskType: "feature",
          risk: "medium",
          complexity: "medium",
          affectedAreas: ["frontend"],
          detectedSignals: ["ui wording", "branch context"],
          suggestedProfile: "feature",
          suggestedModelTier: "cheap",
          suggestedMode: "implement_and_test",
          approvalRequired: false,
          reason: "Short explanation of why this routing is appropriate."
        },
        refinedBrief: {
          summary: "One-sentence improved summary.",
          objective: "What should be accomplished.",
          scope: ["Concrete in-scope bullet", "Another in-scope bullet"],
          acceptanceCriteria: ["What should be true when this is done."],
          constraints: ["Any guardrails or things not to do."],
          openQuestions: ["Only include if genuinely unresolved."]
        },
        confidence: "medium",
        missingInformation: ["Only include if the ticket is underspecified."]
      },
      null,
      2
    ),
    "",
    `Assistant runtime: provider=${options.providerId}, model=${options.model}`
  ].join("\n");
}

function parseTicketIntelligenceResponse(raw: string): TicketIntelligenceResult | null {
  const payload = extractFirstJsonObject(raw);

  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as TicketIntelligenceResult;
    return parsed && typeof parsed === "object" && parsed.classification ? parsed : null;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1).trim();
}

function resolveSuggestedProfile(config: OpenTopConfig, candidate: string | undefined, fallback: string): string {
  if (candidate && config.agentProfiles[candidate]) {
    return candidate;
  }

  return fallback;
}

function resolveSuggestedModelTier(config: OpenTopConfig, candidate: string | undefined, fallback: string): string {
  if (candidate && config.models[candidate]) {
    return candidate;
  }

  return fallback;
}

function resolveSuggestedMode(candidate: string | undefined, fallback: ExecutionMode): ExecutionMode {
  if (candidate && EXECUTION_MODES.includes(candidate as ExecutionMode)) {
    return candidate as ExecutionMode;
  }

  return fallback;
}

function normalizeStringList(value: string[] | undefined, fallback: string[]): string[] {
  const normalized = uniqueList(
    (value ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );

  return normalized.length > 0 ? normalized : fallback;
}

function uniqueList(values: string[]): string[] {
  return [...new Set(values)];
}

function isTaskType(value: string | undefined): value is TaskCategory {
  return typeof value === "string" && TASK_TYPES.includes(value as TaskCategory);
}

function isRiskLevel(value: string | undefined): value is RiskLevel {
  return typeof value === "string" && RISK_LEVELS.includes(value as RiskLevel);
}

function isComplexityLevel(value: string | undefined): value is Classification["complexity"] {
  return typeof value === "string" && COMPLEXITY_LEVELS.includes(value as Classification["complexity"]);
}
