import { simpleGit } from "simple-git";

interface BranchResolutionLike {
  decision: "new" | "reuse-current" | "none" | "blocked";
  branchName?: string;
  reason: string;
}

interface WorkspacePreparationLike {
  branchName: string;
  logs: string[];
}

export interface RepositoryStatus {
  currentBranch: string;
  isClean: boolean;
  changedFiles: string[];
}

export async function getRepositoryStatus(repositoryPath = process.cwd()): Promise<RepositoryStatus> {
  const git = simpleGit(repositoryPath);
  const status = await git.status();
  const changedFiles = status.files
    .map((file) => file.path)
    .filter((filePath) => !isIgnoredOpenTopStatePath(filePath));

  return {
    currentBranch: status.current ?? "unknown",
    isClean: changedFiles.length === 0,
    changedFiles
  };
}

export async function createIsolatedBranch(branchName: string, repositoryPath = process.cwd()): Promise<void> {
  const git = simpleGit(repositoryPath);
  await git.checkoutLocalBranch(branchName);
}

export class GitExecutionWorkspace {
  constructor(private readonly repositoryPath = process.cwd()) {}

  async getRepositoryState(): Promise<RepositoryStatus> {
    return getRepositoryStatus(this.repositoryPath);
  }

  async prepareBranch(resolution: BranchResolutionLike): Promise<WorkspacePreparationLike> {
    if (resolution.decision === "blocked") {
      throw new Error(`Cannot prepare a blocked execution workspace: ${resolution.reason}`);
    }

    if (resolution.decision === "none") {
      return {
        branchName: "none",
        logs: ['Execution mode does not require a working branch.']
      };
    }

    if (!resolution.branchName) {
      throw new Error("OpenTop could not determine a target branch for this execution.");
    }

    const git = simpleGit(this.repositoryPath);
    const currentStatus = await git.status();
    const currentBranch = currentStatus.current ?? "unknown";

    if (resolution.decision === "reuse-current") {
      if (currentBranch !== resolution.branchName) {
        await git.checkout(resolution.branchName);
        return {
          branchName: resolution.branchName,
          logs: [`Checked out branch "${resolution.branchName}" for reuse.`]
        };
      }

      return {
        branchName: resolution.branchName,
        logs: [`Workspace already points at "${resolution.branchName}", so no checkout was needed.`]
      };
    }

    const localBranches = await git.branchLocal();

    if (localBranches.all.includes(resolution.branchName)) {
      if (currentBranch !== resolution.branchName) {
        await git.checkout(resolution.branchName);
        return {
          branchName: resolution.branchName,
          logs: [`Checked out the existing execution branch "${resolution.branchName}".`]
        };
      }

      return {
        branchName: resolution.branchName,
        logs: [`Execution branch "${resolution.branchName}" already existed and is already checked out.`]
      };
    }

    await git.checkoutLocalBranch(resolution.branchName);
    return {
      branchName: resolution.branchName,
      logs: [`Created and checked out execution branch "${resolution.branchName}".`]
    };
  }
}

function isIgnoredOpenTopStatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === ".opentop/state" || normalized.startsWith(".opentop/state/");
}
