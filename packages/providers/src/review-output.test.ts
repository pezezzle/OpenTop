import test from "node:test";
import assert from "node:assert/strict";
import { classifyReviewOutput } from "./review-output.js";

test("classifyReviewOutput returns plan for planner-style runs", () => {
  const kind = classifyReviewOutput(
    "Generate an implementation plan and worker plan for this feature.",
    "1. Analyze the API\n2. Split work into tasks",
    "plan_only"
  );

  assert.equal(kind, "plan");
});

test("classifyReviewOutput returns patch_proposal for diff-like output", () => {
  const kind = classifyReviewOutput(
    "Prepare a patch for this issue.",
    "```diff\n--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-console.log('old')\n+console.log('new')\n```",
    "implement_only"
  );

  assert.equal(kind, "patch_proposal");
});

test("classifyReviewOutput returns review_note for review runs", () => {
  const kind = classifyReviewOutput(
    "Review this implementation and point out risks.",
    "The change looks fine, but tests are missing for the failure path.",
    "review_only"
  );

  assert.equal(kind, "review_note");
});

test("classifyReviewOutput returns general when no stronger signal exists", () => {
  const kind = classifyReviewOutput(
    "Summarize the result.",
    "Completed the requested analysis.",
    "implement_and_test"
  );

  assert.equal(kind, "general");
});
