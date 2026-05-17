import type { ExecutionMode } from "@opentop/shared";
import type { ReviewOutputKind } from "./types.js";

export function classifyReviewOutput(prompt: string, content: string, mode: ExecutionMode): ReviewOutputKind {
  const normalizedPrompt = prompt.toLowerCase();
  const normalizedContent = content.toLowerCase();

  if (mode === "plan_only" || normalizedPrompt.includes("worker plan") || normalizedPrompt.includes("implementation plan")) {
    return "plan";
  }

  if (
    normalizedContent.includes("```diff") ||
    normalizedContent.includes("*** begin patch") ||
    normalizedContent.includes("diff --git") ||
    normalizedPrompt.includes("patch")
  ) {
    return "patch_proposal";
  }

  if (mode === "review_only" || normalizedPrompt.includes("review")) {
    return "review_note";
  }

  return "general";
}
