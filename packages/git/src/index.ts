import { simpleGit } from "simple-git";

export interface RepositoryStatus {
  currentBranch: string;
  isClean: boolean;
  changedFiles: string[];
}

export async function getRepositoryStatus(repositoryPath = process.cwd()): Promise<RepositoryStatus> {
  const git = simpleGit(repositoryPath);
  const status = await git.status();

  return {
    currentBranch: status.current ?? "unknown",
    isClean: status.files.length === 0,
    changedFiles: status.files.map((file) => file.path)
  };
}

export async function createIsolatedBranch(branchName: string, repositoryPath = process.cwd()): Promise<void> {
  const git = simpleGit(repositoryPath);
  await git.checkoutLocalBranch(branchName);
}
