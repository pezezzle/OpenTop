import type { ExecutionMode } from "@opentop/shared";
import type { Classification, StructuredPlan, StructuredPlanStep, StructuredPlanWorkItem } from "./types.js";

export function parseStructuredPlan(rawOutput: string, classification: Classification): StructuredPlan {
  const normalized = rawOutput.trim();
  const sections = splitSections(normalized);
  const fallbackBullets = extractBulletLines(normalized);
  const summary = extractSummary(normalized);
  const assumptions = extractListFromSections(sections, ["assumptions", "constraints", "notes"]) ?? [];
  const risks = extractListFromSections(sections, ["risks", "risk", "watchouts"]) ?? [];
  const openQuestions = extractListFromSections(sections, ["open questions", "questions", "unknowns"]) ?? [];
  const stepCandidates =
    extractListFromSections(sections, ["implementation steps", "steps", "plan", "approach"]) ||
    fallbackBullets.slice(0, 8);
  const workItemCandidates =
    extractListFromSections(sections, ["work items", "workstreams", "tasks", "deliverables"]) || stepCandidates;
  const implementationSteps = buildImplementationSteps(stepCandidates, classification);
  const workItems = buildWorkItems(workItemCandidates, classification);

  return {
    summary,
    assumptions,
    implementationSteps,
    risks,
    openQuestions,
    workItems
  };
}

export function isStructuredPlanUsable(plan: StructuredPlan): boolean {
  return Boolean(plan.summary || plan.implementationSteps.length > 0 || plan.workItems.length > 0);
}

function splitSections(text: string): Array<{ title: string; lines: string[] }> {
  const lines = text.split("\n");
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const markdownHeading = trimmed.match(/^#{1,6}\s+(.+)$/);
    const labelHeading = /^[A-Za-z][A-Za-z0-9 /()-]{1,80}:$/.test(trimmed)
      ? trimmed.slice(0, -1).trim()
      : undefined;
    const heading = markdownHeading?.[1].trim().toLowerCase() ?? labelHeading?.toLowerCase();

    if (heading) {
      current = { title: heading, lines: [] };
      sections.push(current);
      continue;
    }

    if (!current || !trimmed) {
      continue;
    }

    current.lines.push(trimmed);
  }

  return sections;
}

function extractSummary(text: string): string | undefined {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (paragraph.startsWith("```")) {
      continue;
    }

    const clean = paragraph
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !/^#{1,6}\s+/u.test(line))
      .filter((line) => !/^[-*+]\s+/u.test(line) && !/^\d+\.\s+/u.test(line))
      .join(" ")
      .trim();

    if (clean) {
      return clean;
    }
  }

  return undefined;
}

function extractListFromSections(
  sections: Array<{ title: string; lines: string[] }>,
  headings: string[]
): string[] | undefined {
  const matching = sections.find((section) => headings.some((heading) => section.title.includes(heading)));

  if (!matching) {
    return undefined;
  }

  return matching.lines
    .flatMap((line) => {
      if (/^[-*+]\s+/u.test(line) || /^\d+\.\s+/u.test(line)) {
        return [stripListMarker(line)];
      }

      return line
        .split(/\s*;\s*/u)
        .map((part) => part.trim())
        .filter(Boolean);
    })
    .filter(Boolean);
}

function extractBulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/u.test(line) || /^\d+\.\s+/u.test(line))
    .map(stripListMarker)
    .filter(Boolean);
}

function stripListMarker(value: string): string {
  return value.replace(/^[-*+]\s+/u, "").replace(/^\d+\.\s+/u, "").trim();
}

function buildImplementationSteps(items: string[], classification: Classification): StructuredPlanStep[] {
  return items.slice(0, 8).map((item, index) => {
    const [title, summary] = splitTitleAndSummary(item);
    return {
      id: `step-${index + 1}`,
      title,
      summary,
      acceptanceCriteria: [],
      affectedAreas: classification.affectedAreas
    };
  });
}

function buildWorkItems(items: string[], classification: Classification): StructuredPlanWorkItem[] {
  return items.slice(0, 8).map((item, index) => {
    const [title, summary] = splitTitleAndSummary(item);
    return {
      id: `work-${index + 1}`,
      title,
      summary: summary ?? title,
      affectedAreas: classification.affectedAreas,
      suggestedMode: inferSuggestedMode(classification),
      dependsOn: index === 0 ? [] : [`work-${index}`]
    };
  });
}

function splitTitleAndSummary(item: string): [string, string | undefined] {
  const parts = item.split(/\s+-\s+|:\s+/u);
  const title = parts[0]?.trim() || item.trim();
  const summary = parts.slice(1).join(" - ").trim() || undefined;
  return [title, summary];
}

function inferSuggestedMode(classification: Classification): ExecutionMode {
  if (classification.taskType === "test" || classification.affectedAreas.includes("tests")) {
    return "implement_and_test";
  }

  return "implement_only";
}
