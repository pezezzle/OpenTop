import { createExecutionPlan } from "./execution.js";
import type {
  BuiltPrompt,
  LoadedContextProfile,
  OpenTopProjectContext,
  PlanArtifact,
  PromptBuildInput,
  PromptContextSummary
} from "./types.js";

export function buildAgentPrompt(input: PromptBuildInput): BuiltPrompt {
  const executionPlan = input.executionPlan ?? createExecutionPlan(input.ticket, input.config);
  const executionPhase =
    input.executionPhase ?? (executionPlan.profile.mode === "plan_only" ? "planning" : "implementation");
  const templateName = resolvePromptTemplateName(executionPlan.profile.id, executionPlan.profile.mode, input.projectContext);
  const template = input.projectContext.prompts[templateName];
  const sections = buildRelevantSections(
    input.projectContext,
    template,
    input.ticket.title,
    input.ticket.description,
    executionPlan.classification,
    input.approvedPlanArtifact,
    executionPhase
  );
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
    `Execution phase: ${executionPhase}`,
    `Approval required: ${executionPlan.classification.approvalRequired ? "yes" : "no"}`,
    "",
    "## Ticket",
    `Title: ${input.ticket.title}`,
    `Description: ${input.ticket.description.trim() || "No description provided."}`,
    `Labels: ${input.ticket.labels.length > 0 ? input.ticket.labels.join(", ") : "none"}`,
    ...(input.intelligenceSummary?.source === "ai_assisted" && input.refinedBrief
      ? [
          "",
          "## Refined Brief",
          `Summary: ${input.refinedBrief.summary || "No refined summary provided."}`,
          `Objective: ${input.refinedBrief.objective || "No refined objective provided."}`,
          "Scope:",
          formatList(input.refinedBrief.scope),
          "Acceptance signals:",
          formatList(input.refinedBrief.acceptanceCriteria),
          "Constraints:",
          formatList(input.refinedBrief.constraints),
          "Open questions:",
          formatList(input.refinedBrief.openQuestions)
        ]
      : []),
    "",
    "## Classification",
    `Classification source: ${input.intelligenceSummary?.source === "ai_assisted" ? "ai-assisted" : "deterministic"}`,
    `Task type: ${executionPlan.classification.taskType}`,
    `Risk: ${executionPlan.classification.risk}`,
    `Complexity: ${executionPlan.classification.complexity}`,
    `Affected areas: ${executionPlan.classification.affectedAreas.join(", ")}`,
    `Detected signals: ${executionPlan.classification.detectedSignals.join(", ") || "none"}`,
    `Suggested profile: ${executionPlan.classification.suggestedProfile}`,
    `Suggested provider: ${executionPlan.classification.suggestedProviderId}`,
    `Suggested model tier: ${executionPlan.classification.suggestedModelTier}`,
    `Suggested model: ${executionPlan.classification.suggestedModel}`,
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
    ...formatPlanExecutionSection(executionPhase, input.approvedPlanArtifact),
    "",
    "Rules:",
    formatList(sections.templateRules),
    "",
    "## Context Resolution",
    `Profile mode: ${sections.contextSummary.profileMode}`,
    `Active profiles: ${
      sections.contextSummary.activeProfiles.length > 0
        ? sections.contextSummary.activeProfiles.map((profile) => `${profile.type}:${profile.id}`).join(", ")
        : "none"
    }`,
    `Profile budget: ${sections.contextSummary.budget.usedProfileSections}/${sections.contextSummary.budget.maxProfileSections} sections, ${sections.contextSummary.budget.usedProfileWords}/${sections.contextSummary.budget.maxPromptProfileWords} words`,
    "Influences:",
    formatList(sections.contextSummary.influences),
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
    ...formatProfileSections(sections.profileSelections),
    "",
    "## Important Documentation",
    formatList(sections.documentation),
    "",
    "## Required Response",
    executionPhase === "planning"
      ? "Return a reviewed implementation plan using this structure:"
      : "Return a concise implementation result using this structure:",
    formatList(sections.outputSchema),
    "",
    "Project rules override profile preferences when they conflict. Do not restate the whole project context. Focus on the ticket, the selected profile, the allowed commands, and the required response format."
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
    sources,
    contextSummary: sections.contextSummary,
    intelligenceSummary: input.intelligenceSummary
  };
}

function resolvePromptTemplateName(profileId: string, mode: string, projectContext: OpenTopProjectContext): string {
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
  description: string,
  classification: PromptBuildInput["ticket"]["classification"] extends infer T ? Exclude<T, undefined> : never,
  approvedPlanArtifact: PlanArtifact | undefined,
  executionPhase: "planning" | "implementation"
) {
  const combinedText = `${title} ${description}`.toLowerCase();
  const glossaryMatches = selectRelevantEntries(projectContext.memory.glossary, combinedText, "## ");
  const knownIssueMatches = selectRelevantEntries(projectContext.memory["known-issues"], combinedText, "## ");
  const profileSelections = selectProfileSections(projectContext.activeProfiles, classification, projectContext.settings);
  const contextSummary: PromptContextSummary = {
    profileMode: projectContext.settings.profileMode,
    activeProfiles: projectContext.activeProfiles.map((profile) => ({
      id: profile.id,
      type: profile.type,
      displayName: profile.displayName
    })),
    includedSections: profileSelections.flatMap((profile) =>
      profile.sections.map((section) => `${profile.profile.displayName} -> ${section.label}`)
    ),
    skippedSections: profileSelections.flatMap((profile) => profile.skippedSections),
    influences: buildContextInfluences(projectContext, profileSelections),
    budget: {
      maxPromptProfileWords: projectContext.settings.maxPromptProfileWords,
      maxProfileSections: projectContext.settings.maxProfileSections,
      usedProfileWords: profileSelections.reduce(
        (total, profile) => total + profile.sections.reduce((sectionTotal, section) => sectionTotal + section.wordCount, 0),
        0
      ),
      usedProfileSections: profileSelections.reduce((total, profile) => total + profile.sections.length, 0)
    }
  };

  return {
    projectSummary: extractParagraphs(extractSection(projectContext.projectContext, "## Project"), 2),
    architectureRules: extractBulletList(extractSection(projectContext.projectContext, "## Architectural Rules")).slice(0, 8),
    agentInstructions: extractParagraphs(extractSection(projectContext.projectContext, "## Agent Instructions"), 2),
    documentation: extractCodeReferences(extractSection(projectContext.projectContext, "## Important Documentation")).slice(0, 10),
    engineeringRules: extractBulletList(extractSection(projectContext.rules, "## Engineering Rules")).slice(0, 8),
    safetyRules: extractBulletList(extractSection(projectContext.rules, "## Safety Rules")).slice(0, 8),
    templateObjective: extractParagraphs(extractSection(template, "## Objective"), 2),
    templateRules: extractBulletList(extractSection(template, "## Rules")).slice(0, 8),
    memory: {
      decisions: extractCompactDecisionSummary(projectContext.memory.decisions),
      conventions: extractBulletList(projectContext.memory.conventions).slice(0, 6),
      risks: extractBulletList(projectContext.memory.risks).slice(0, 6),
      glossary: glossaryMatches,
      knownIssues: knownIssueMatches
    },
    profileSelections,
    contextSummary,
    outputSchema:
      extractHeadingList(projectContext.pullRequestTemplate).concat(
        executionPhase === "implementation"
          ? []
          : ["Assumptions", "Implementation steps", "Risks", "Open questions", "Work items"]
      ),
    approvedPlanArtifactSource: approvedPlanArtifact ? `plan artifact v${approvedPlanArtifact.version}` : undefined
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

  if (sections.approvedPlanArtifactSource) {
    sources.push(sections.approvedPlanArtifactSource);
  }

  if (hasListContent(sections.outputSchema)) {
    sources.push(".opentop/templates/pull-request.md");
  }

  for (const profileSelection of sections.profileSelections) {
    for (const section of profileSelection.sections) {
      sources.push(section.source);
    }
  }

  return [...new Set(sources)];
}

type SelectedProfileSection = {
  key: string;
  label: string;
  content: string;
  source: string;
  wordCount: number;
};

type ProfileSelection = {
  profile: LoadedContextProfile;
  sections: SelectedProfileSection[];
  skippedSections: string[];
};

function selectProfileSections(
  profiles: LoadedContextProfile[],
  classification: Exclude<PromptBuildInput["ticket"]["classification"], undefined>,
  settings: OpenTopProjectContext["settings"]
): ProfileSelection[] {
  if (settings.profileMode === "project-only" || settings.profileMode === "manual") {
    return profiles.map((profile) => ({
      profile,
      sections: [],
      skippedSections: Object.keys(profile.sections).map((section) => `${profile.displayName} -> ${section} (profile mode)` )
    }));
  }

  const priorities = buildProfileSectionPriorities(classification);
  let remainingSections = settings.maxProfileSections;
  let remainingWords = settings.maxPromptProfileWords;

  return profiles.map((profile) => {
    const maxSections = Math.min(profile.promptBudget.maxProfileSections ?? settings.maxProfileSections, remainingSections);
    const maxWords = Math.min(profile.promptBudget.maxProfileWords ?? settings.maxPromptProfileWords, remainingWords);
    const selected: SelectedProfileSection[] = [];
    const skippedSections: string[] = [];
    let profileWords = 0;

    for (const key of priorities) {
      const content = profile.sections[key];

      if (!content) {
        continue;
      }

      if (selected.length >= maxSections || remainingSections <= 0) {
        skippedSections.push(`${profile.displayName} -> ${key} (section budget)`);
        continue;
      }

      const compacted = compactMarkdown(content, 140);
      const wordCount = countWords(compacted);

      if (wordCount === 0) {
        continue;
      }

      if (profileWords + wordCount > maxWords || remainingWords - wordCount < 0) {
        skippedSections.push(`${profile.displayName} -> ${key} (word budget)`);
        continue;
      }

      selected.push({
        key,
        label: formatProfileSectionLabel(key),
        content: compacted,
        source: `${profile.sourcePath}/${key}.md`,
        wordCount
      });
      profileWords += wordCount;
      remainingWords -= wordCount;
      remainingSections -= 1;
    }

    for (const key of Object.keys(profile.sections)) {
      if (!priorities.includes(key) && selected.every((section) => section.key !== key)) {
        skippedSections.push(`${profile.displayName} -> ${key} (not relevant)`);
      }
    }

    return {
      profile,
      sections: selected,
      skippedSections
    };
  });
}

function buildProfileSectionPriorities(
  classification: Exclude<PromptBuildInput["ticket"]["classification"], undefined>
): string[] {
  const priorities = ["summary", "prompt-preferences", "developer-style", "ticket-guidelines"];

  if (
    classification.affectedAreas.includes("backend") ||
    classification.affectedAreas.includes("data") ||
    classification.taskType === "architecture" ||
    classification.taskType === "security" ||
    classification.taskType === "migration" ||
    classification.taskType === "integration"
  ) {
    priorities.push("architecture");
  }

  if (classification.affectedAreas.includes("frontend") || classification.taskType === "docs") {
    priorities.push("ui-style", "styling");
  }

  if (classification.affectedAreas.includes("frontend") || classification.taskType === "feature") {
    priorities.push("forms");
  }

  if (classification.affectedAreas.includes("tests") || classification.suggestedMode === "implement_and_test") {
    priorities.push("testing-preferences");
  }

  return [...new Set(priorities)];
}

function buildContextInfluences(projectContext: OpenTopProjectContext, profileSelections: ProfileSelection[]): string[] {
  const influences: string[] = [];

  if (projectContext.projectContext) {
    influences.push("project context summary");
  }

  if (projectContext.rules) {
    influences.push("project engineering and safety rules");
  }

  if (Object.keys(projectContext.memory).length > 0) {
    influences.push("project memory");
  }

  for (const profileSelection of profileSelections) {
    if (profileSelection.sections.length > 0) {
      influences.push(
        `${profileSelection.profile.type} profile ${profileSelection.profile.displayName}: ${profileSelection.sections
          .map((section) => section.label)
          .join(", ")}`
      );
    }
  }

  return influences.length > 0 ? influences : ["OpenTop defaults only"];
}

function formatProfileSections(profileSelections: ProfileSelection[]): string[] {
  const sections: string[] = [];

  for (const profileSelection of profileSelections) {
    if (profileSelection.sections.length === 0) {
      continue;
    }

    sections.push("## Selected Context Profile Guidance", "");
    sections.push(
      `### ${profileSelection.profile.displayName} (${profileSelection.profile.type})`,
      profileSelection.profile.description ?? "No profile description provided.",
      ""
    );

    for (const section of profileSelection.sections) {
      sections.push(`#### ${section.label}`, section.content, "");
    }
  }

  return sections;
}

function formatPlanExecutionSection(
  executionPhase: "planning" | "implementation",
  approvedPlanArtifact: PlanArtifact | undefined
): string[] {
  if (executionPhase === "planning") {
    return [
      "## Planning Instructions",
      "",
      "This run is in planning mode.",
      "Return a structured implementation plan before any code-changing execution starts.",
      "Be explicit about assumptions, implementation steps, risks, open questions, and work items.",
      ""
    ];
  }

  if (!approvedPlanArtifact) {
    return [];
  }

  return [
    "## Approved Plan",
    "",
    `Use approved plan version v${approvedPlanArtifact.version} as the implementation contract for this run.`,
    ...(approvedPlanArtifact.structuredPlan.summary
      ? ["### Plan Summary", approvedPlanArtifact.structuredPlan.summary, ""]
      : []),
    ...formatSection(
      "Implementation Steps",
      approvedPlanArtifact.structuredPlan.implementationSteps.map((step) =>
        step.summary ? `${step.title}: ${step.summary}` : step.title
      )
    ),
    ...formatSection(
      "Work Items",
      approvedPlanArtifact.structuredPlan.workItems.map((workItem) =>
        `${workItem.title}: ${workItem.summary} (${workItem.affectedAreas.join(", ")})`
      )
    ),
    ...formatSection("Plan Risks", approvedPlanArtifact.structuredPlan.risks),
    ...formatSection("Open Questions", approvedPlanArtifact.structuredPlan.openQuestions)
  ];
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

function compactMarkdown(markdown: string, maxWords: number): string {
  const normalized = markdown
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();

  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length <= maxWords) {
    return normalized;
  }

  return `${words.slice(0, maxWords).join(" ")} ...`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function formatProfileSectionLabel(key: string): string {
  return key.replace(/-/g, " ");
}

function hasContent(value: string): boolean {
  return value.trim().length > 0;
}

function hasListContent(value: string[]): boolean {
  return value.length > 0;
}
