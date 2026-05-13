import type { ExecutionBranchPolicy } from "@opentop/shared";
import type { OpenTopConfig } from "./config.js";
import type { ExecutionBranchResolution, ExecutionPlan, RepositoryState } from "./types.js";

const NON_IMPLEMENTING_MODES = new Set(["plan_only", "review_only"]);

export function resolveExecutionBranch(
  executionPlan: ExecutionPlan,
  config: OpenTopConfig,
  repositoryState: RepositoryState,
  policyOverride?: ExecutionBranchPolicy
): ExecutionBranchResolution {
  const policy = policyOverride ?? config.execution.defaultBranchPolicy;

  if (NON_IMPLEMENTING_MODES.has(executionPlan.profile.mode)) {
    return {
      policy,
      decision: "none",
      branchName: undefined,
      reason: `Execution mode "${executionPlan.profile.mode}" does not require a working branch.`,
      repositoryState
    };
  }

  if (!repositoryState.isClean) {
    return {
      policy,
      decision: "blocked",
      branchName: undefined,
      reason: "Working tree is dirty. Commit, stash, or discard local changes before starting an execution.",
      repositoryState
    };
  }

  if (policy === "manual") {
    return {
      policy,
      decision: "blocked",
      branchName: undefined,
      reason: "Branch policy is set to manual. Choose a branch policy explicitly or update your OpenTop config.",
      repositoryState
    };
  }

  if (policy === "none") {
    return {
      policy,
      decision: "blocked",
      branchName: undefined,
      reason: `Branch policy "none" is not valid for execution mode "${executionPlan.profile.mode}".`,
      repositoryState
    };
  }

  if (policy === "new") {
    return {
      policy,
      decision: "new",
      branchName: executionPlan.branchName,
      reason: `Using a fresh execution branch "${executionPlan.branchName}".`,
      repositoryState
    };
  }

  if (repositoryState.currentBranch === "unknown") {
    return {
      policy,
      decision: "blocked",
      branchName: undefined,
      reason: "Could not determine the current Git branch, so OpenTop cannot safely reuse it.",
      repositoryState
    };
  }

  if (repositoryState.currentBranch === config.project.defaultBranch) {
    return {
      policy,
      decision: "new",
      branchName: executionPlan.branchName,
      reason: `Current branch is the default branch "${config.project.defaultBranch}", so OpenTop will use an isolated execution branch.`,
      repositoryState
    };
  }

  return {
    policy,
    decision: "reuse-current",
    branchName: repositoryState.currentBranch,
    reason: `Reusing the current branch "${repositoryState.currentBranch}" based on the configured branch policy.`,
    repositoryState
  };
}
