import { createExecutionPlan } from "./execution.js";
import type { BuiltPrompt, OpenTopProjectContext, PromptBuildInput } from "./types.js";

export function buildAgentPrompt(input: PromptBuildInput): BuiltPrompt {
  const executionPlan = input.executionPlan ?? createExecutionPlan(input.ticket, input.config);
  const templateName = resolvePromptTemplateName(executionPlan.profile.id, executionPlan.profile.mode, input.projectContext);
  const template = input.projectContext.prompts[templateName];
  const sections = buildRelevantSections(input.projectContext, template, input.ticket.title, input.ticket.description);
  const sources = collectSources(templateName, sections, input.projectContext);

  const prompt = [
    "# OpenTop Controlled Agent Prompt",
    "",
    "## Execution Contract",
    `Project: ${input.config.project.name}`,
    `Ticket ID: ${input.ticket.externalId ?? input.ticket.id}`,
    `Source: ${input.ticket.source}`,
    `Branch: ${executionPlan.branchName}`,
    `Agent profile: ${executionPlan.profile.id}`,
    `Model: ${executionPlan.providerId}/${executionPlan.modelId}`,
    `Execution mode: ${executionPlan.profile.mode}`,
    `Approval required: ${executionPlan.classification.approvalRequired ? "yes" : "no"}`,
    "",
    "## Ticket",
    `Title: ${input.ticket.title}`,
    `Description: ${input.ticket.description.trim() || "No description provided."}`,
    `Labels: ${input.ticket.labels.length > 0 ? input.ticket.labels.join(", ") : "none"}`,
    "",
    "## Classification",
    `Risk: ${executionPlan.classification.risk}`,
    `Complexity: ${executionPlan.classification.complexity}`,
    `Affected areas: ${executionPlan.classification.affectedAreas.join(", ")}`,
    `Suggested profile: ${executionPlan.classification.suggestedProfile}`,
    `Suggested model tier: ${executionPlan.classification.suggestedModelTier}`,
    `Suggested mode: ${executionPlan.classification.suggestedMode}`,
    `Reason: ${executionPlan.classification.reason}`,
    "",
    "## Allowed Commands",
    formatList(executionPlan.profile.allowedCommands),
    "",
    "## Agent Role Guidance",
    `Template: ${templateName}`,
    sections.templateObjective ?? "No explicit template objective found.",
    "",
    "Rules:",
    formatList(sections.templateRules),
    "",
    "## Relevant Project Guidance",
    ...formatSection("Project Summary", sections.projectSummary),
    ...formatSection("Architecture Rules", sections.architectureRules),
    ...formatSection("Agent Instructions", sections.agentInstructions),
    ...formatSection("Engineering Rules", sections.engineeringRules),
    ...formatSection("Safety Rules", sections.safetyRules),
    "",
    ...formatMemorySection(sections.memory),
    "",
    "## Important Documentation",
    formatList(sections.documentation),
    "",
    "## Required Response",
    "Return a concise result using this structure:",
    formatList(sections.outputSchema),
    "",
    "Do not restate the whole project context. Focus on the ticket, the selected profile, the allowed commands, and the required response format."
  ]
    .filter((line, index, array) => {
      if (line !== "") {
        return true;
      }

      return array[index - 1] !== "";
    })
    .join("\n");

  return {
    prompt,
    executionPlan,
    sources
  };
}

function resolvePromptTemplateName(
  profileId: string,
  mode: string,
  projectContext: OpenTopProjectContext
): string {
  if (mode === "review_only" && projectContext.prompts.reviewer) {
    return "reviewer";
  }

  if (mode === "plan_only" && projectContext.prompts.planner) {
    return "planner";
  }

  if (projectContext.prompts[profileId]) {
    return profileId;
  }

  if (profileId === "architecture" && projectContext.prompts.planner) {
    return "planner";
  }

  return "feature";
}

function buildRelevantSections(
  projectContext: OpenTopProjectContext,
  template: string | undefined,
  title: string,
  description: string
) {
  const combinedText = `${title} ${description}`.toLowerCase();
  const glossaryMatches = selectRelevantEntries(projectContext.memory.glossary, combinedText, "## ");
  const knownIssueMatches = selectRelevantEntries(projectContext.memory["known-issues"], combinedText, "## ");

  return {
    projectSummary: extractParagraphs(extractSection(projectContext.projectContext, "## Project"), 2),
    architectureRules: extractBulletList(extractSection(projectContext.projectContext, "## Architectural Rules")),
    agentInstructions: extractParagraphs(extractSection(projectContext.projectContext, "## Agent Instructions"), 2),
    documentation: extractCodeReferences(extractSection(projectContext.projectContext, "## Important Documentation")),
    engineeringRules: extractBulletList(extractSection(projectContext.rules, "## Engineering Rules")),
    safetyRules: extractBulletList(extractSection(projectContext.rules, "## Safety Rules")),
    templateObjective: extractParagraphs(extractSection(template, "## Objective"), 2),
    templateRules: extractBulletList(extractSection(template, "## Rules")),
    memory: {
      decisions: extractCompactDecisionSummary(projectContext.memory.decisions),
      conventions: extractBulletList(projectContext.memory.conventions),
      risks: extractBulletList(projectContext.memory.risks),
      glossary: glossaryMatches,
      knownIssues: knownIssueMatches
    },
    outputSchema: extractHeadingList(projectContext.pullRequestTemplate)
  };
}

function collectSources(
  templateName: string,
  sections: ReturnType<typeof buildRelevantSections>,
  projectContext: OpenTopProjectContext
): string[] {
  const sources = [".opentop/opentop.yml"];

  if (hasContent(sections.projectSummary) || hasListContent(sections.architectureRules) || hasContent(sections.agentInstructions)) {
    sources.push(".opentop/project-context.md");
  }

  if (hasListContent(sections.engineeringRules) || hasListContent(sections.safetyRules)) {
    sources.push(".opentop/rules.md");
  }

  if (hasContent(sections.memory.decisions)) {
    sources.push(".opentop/memory/decisions.md");
  }

  if (hasListContent(sections.memory.conventions)) {
    sources.push(".opentop/memory/conventions.md");
  }

  if (hasListContent(sections.memory.risks)) {
    sources.push(".opentop/memory/risks.md");
  }

  if (hasListContent(sections.memory.glossary)) {
    sources.push(".opentop/memory/glossary.md");
  }

  if (hasListContent(sections.memory.knownIssues)) {
    sources.push(".opentop/memory/known-issues.md");
  }

  if (projectContext.prompts[templateName]) {
    sources.push(`.opentop/prompts/${templateName}.md`);
  }

  if (hasListContent(sections.outputSchema)) {
    sources.push(".opentop/templates/pull-request.md");
  }

  return sources;
}

function formatSection(title: string, content: string | string[]): string[] {
  if (typeof content === "string") {
    if (!content.trim()) {
      return [];
    }

    return [`### ${title}`, content, ""];
  }

  if (content.length === 0) {
    return [];
  }

  return [`### ${title}`, formatList(content), ""];
}

function formatMemorySection(memory: ReturnType<typeof buildRelevantSections>["memory"]): string[] {
  const parts = [
    ...formatSection("Decision Summary", memory.decisions),
    ...formatSection("Conventions", memory.conventions),
    ...formatSection("Risks", memory.risks),
    ...formatSection("Relevant Glossary", memory.glossary),
    ...formatSection("Relevant Known Issues", memory.knownIssues)
  ];

  if (parts.length === 0) {
    return [];
  }

  return ["## Relevant Project Memory", "", ...parts];
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function extractSection(markdown: string | undefined, heading: string): string {
  if (!markdown) {
    return "";
  }

  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);

  if (startIndex === -1) {
    return "";
  }

  const collected: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("## ")) {
      break;
    }

    collected.push(line);
  }

  return collected.join("\n").trim();
}

function extractParagraphs(markdown: string | undefined, maxParagraphs: number): string {
  if (!markdown) {
    return "";
  }

  return markdown
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("```"))
    .slice(0, maxParagraphs)
    .join("\n\n");
}

function extractBulletList(markdown: string | undefined): string[] {
  if (!markdown) {
    return [];
  }

  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function extractCodeReferences(markdown: string | undefined): string[] {
  if (!markdown) {
    return [];
  }

  return markdown
    .split(/\r?\n/)
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]))
    .filter(Boolean);
}

function extractHeadingList(markdown: string | undefined): string[] {
  if (!markdown) {
    return ["Summary", "Changed files", "Checks", "Remaining risks", "Open questions"];
  }

  const headings = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("# "))
    .map((line) => line.slice(2).trim())
    .filter((heading) => heading !== "Ticket");

  return headings.length > 0 ? headings : ["Summary", "Changed files", "Checks", "Remaining risks", "Open questions"];
}

function extractCompactDecisionSummary(markdown: string | undefined): string {
  if (!markdown) {
    return "";
  }

  const sections = markdown
    .split(/\r?\n(?=## )/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("## "));

  const summaries = sections.slice(0, 4).map((block) => {
    const [headingLine, ...rest] = block.split(/\r?\n/);
    const heading = headingLine.replace(/^##\s+/, "").trim();
    const decisionLine = rest.find((line) => line.startsWith("Decision:"))?.replace(/^Decision:\s*/, "").trim();
    return decisionLine ? `${heading}: ${decisionLine}` : heading;
  });

  return summaries.join("\n");
}

function selectRelevantEntries(markdown: string | undefined, text: string, headingPrefix: string): string[] {
  if (!markdown) {
    return [];
  }

  const keywords = buildKeywordSet(text);
  const blocks = markdown
    .split(/\r?\n(?=## )/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith(headingPrefix));

  const matches = blocks.filter((block) => {
    const normalized = block.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword));
  });

  return matches.slice(0, 3).map(summarizeBlock);
}

function summarizeBlock(block: string): string {
  const [headingLine, ...rest] = block.split(/\r?\n/);
  const heading = headingLine.replace(/^##\s+/, "").trim();
  const firstContentLine = rest.map((line) => line.trim()).find(Boolean);
  return firstContentLine ? `${heading}: ${firstContentLine}` : heading;
}

function buildKeywordSet(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  return [...new Set(tokens)];
}

function hasContent(value: string): boolean {
  return value.trim().length > 0;
}

function hasListContent(value: string[]): boolean {
  return value.length > 0;
}
