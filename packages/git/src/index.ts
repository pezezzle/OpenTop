import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

export interface PreparedWorktree {
  repositoryPath: string;
  branchName: string;
  logs: string[];
}

export interface GitHubRemoteInfo {
  remoteName: string;
  remoteUrl: string;
  owner: string;
  repo: string;
  repositoryFullName: string;
}

interface GitStatusFileLike {
  path: string;
  index: string;
  working_dir: string;
}

interface ExecutionDiffFileSummaryLike {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unknown";
  additions: number;
  deletions: number;
  patch?: string;
}

interface ExecutionDiffSummaryLike {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: ExecutionDiffFileSummaryLike[];
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

  async getDiffSummary(changedFiles: string[]): Promise<ExecutionDiffSummaryLike | undefined> {
    return getRepositoryDiffSummary(this.repositoryPath, changedFiles);
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

export async function ensureBranchWorktree(
  rootRepositoryPath: string,
  branchName: string,
  worktreePath?: string
): Promise<PreparedWorktree> {
  const rootRepository = resolve(rootRepositoryPath);
  const targetPath = resolve(worktreePath ?? defaultWorktreePath(rootRepository, branchName));
  const git = simpleGit(rootRepository);
  const existingWorktrees = await listGitWorktrees(rootRepository);
  const existingByBranch = existingWorktrees.find((entry) => entry.branchName === branchName);

  if (existingByBranch) {
    return {
      repositoryPath: existingByBranch.path,
      branchName,
      logs: [`Reusing existing worktree for branch "${branchName}" at "${existingByBranch.path}".`]
    };
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const localBranches = await git.branchLocal();

  if (localBranches.all.includes(branchName)) {
    await git.raw(["worktree", "add", targetPath, branchName]);
    return {
      repositoryPath: targetPath,
      branchName,
      logs: [`Attached branch "${branchName}" to worktree "${targetPath}".`]
    };
  }

  await git.raw(["worktree", "add", "-b", branchName, targetPath]);
  return {
    repositoryPath: targetPath,
    branchName,
    logs: [`Created branch "${branchName}" in isolated worktree "${targetPath}".`]
  };
}

export async function pushBranchToOrigin(
  repositoryPath: string,
  branchName: string,
  remoteName = "origin"
): Promise<string[]> {
  const git = simpleGit(repositoryPath);
  await git.push(remoteName, `${branchName}:${branchName}`, ["--set-upstream"]);
  return [`Pushed branch "${branchName}" to remote "${remoteName}".`];
}

export async function getGitHubRemoteInfo(
  repositoryPath: string,
  remoteName = "origin"
): Promise<GitHubRemoteInfo> {
  const git = simpleGit(repositoryPath);
  const remoteUrl = (await git.raw(["remote", "get-url", remoteName])).trim();
  const parsed = parseGitHubRemoteUrl(remoteUrl);

  if (!parsed) {
    throw new Error(`Remote "${remoteName}" is not a recognizable GitHub remote: ${remoteUrl}`);
  }

  return {
    remoteName,
    remoteUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    repositoryFullName: `${parsed.owner}/${parsed.repo}`
  };
}

export async function getRepositoryDiffSummary(
  repositoryPath: string,
  changedFiles: string[]
): Promise<ExecutionDiffSummaryLike | undefined> {
  if (changedFiles.length === 0) {
    return undefined;
  }

  const git = simpleGit(repositoryPath);
  const [status, diffSummary] = await Promise.all([
    git.status(),
    git.diffSummary(["--", ...changedFiles])
  ]);
  const fileStatuses = new Map(status.files.map((file) => [file.path, file as unknown as GitStatusFileLike]));
  const diffFiles = await Promise.all(
    changedFiles.map(async (filePath) => {
      const summaryEntry = diffSummary.files.find((entry) => entry.file === filePath) as
        | { insertions?: number; deletions?: number }
        | undefined;
      const statusEntry = fileStatuses.get(filePath);
      const patch = await readPatchPreview(repositoryPath, git, filePath, detectChangeType(statusEntry));

      return {
        path: filePath,
        changeType: detectChangeType(statusEntry),
        additions: summaryEntry?.insertions ?? 0,
        deletions: summaryEntry?.deletions ?? 0,
        patch
      };
    })
  );

  return {
    totalFiles: diffFiles.length,
    totalAdditions: diffFiles.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: diffFiles.reduce((sum, file) => sum + file.deletions, 0),
    files: diffFiles
  };
}

function defaultWorktreePath(rootRepositoryPath: string, branchName: string): string {
  const repositoryName = basename(rootRepositoryPath);
  const parentDirectory = dirname(rootRepositoryPath);
  return join(parentDirectory, ".opentop-worktrees", repositoryName, sanitizePathComponent(branchName));
}

async function readPatchPreview(
  repositoryPath: string,
  git: ReturnType<typeof simpleGit>,
  filePath: string,
  changeType: ExecutionDiffFileSummaryLike["changeType"]
): Promise<string | undefined> {
  if (changeType === "untracked") {
    try {
      const file = await readFile(join(repositoryPath, filePath), "utf8");
      return file
        .split("\n")
        .slice(0, 40)
        .map((line) => `+${line}`)
        .join("\n");
    } catch {
      return undefined;
    }
  }

  try {
    const patch = await git.diff(["--", filePath]);
    const trimmed = patch.trim();

    if (!trimmed) {
      return undefined;
    }

    return trimmed.split("\n").slice(0, 120).join("\n");
  } catch {
    return undefined;
  }
}

async function listGitWorktrees(rootRepositoryPath: string): Promise<Array<{ path: string; branchName?: string }>> {
  const git = simpleGit(rootRepositoryPath);
  const output = await git.raw(["worktree", "list", "--porcelain"]);
  const blocks = output
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.map((block) => {
    const lines = block.split("\n");
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"));

    return {
      path: worktreeLine ? worktreeLine.slice("worktree ".length).trim() : rootRepositoryPath,
      branchName: branchLine ? branchLine.slice("branch refs/heads/".length).trim() : undefined
    };
  });
}

function sanitizePathComponent(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function detectChangeType(statusFile?: GitStatusFileLike): ExecutionDiffFileSummaryLike["changeType"] {
  if (!statusFile) {
    return "unknown";
  }

  const combined = `${statusFile.index}${statusFile.working_dir}`;

  if (combined.includes("?")) {
    return "untracked";
  }

  if (combined.includes("A")) {
    return "added";
  }

  if (combined.includes("D")) {
    return "deleted";
  }

  if (combined.includes("R")) {
    return "renamed";
  }

  if (combined.includes("C")) {
    return "copied";
  }

  if (combined.includes("M")) {
    return "modified";
  }

  return "unknown";
}

function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | undefined {
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);

  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2]
    };
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);

  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2]
    };
  }

  return undefined;
}

function isIgnoredOpenTopStatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === ".opentop/state" || normalized.startsWith(".opentop/state/");
}
