import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import type { ExecutionPullRequest, PullRequestDraftInput, PullRequestService, Ticket } from "@opentop/core";

const execFileAsync = promisify(execFile);

export interface GitHubIssueImportOptions {
  token: string;
  owner: string;
  repo: string;
  state?: "open" | "closed" | "all";
}

export async function importGitHubIssues(options: GitHubIssueImportOptions): Promise<Ticket[]> {
  const octokit = new Octokit({ auth: options.token });
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: options.owner,
    repo: options.repo,
    state: options.state ?? "open"
  });

  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      id: `github-${issue.id}`,
      source: "github",
      externalId: String(issue.number),
      title: issue.title,
      description: issue.body ?? "",
      labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name ?? "")).filter(Boolean),
      status: "inbox"
    }));
}

export interface GitHubPullRequestServiceOptions {
  token?: string;
  remoteName?: string;
}

export function createGitHubPullRequestService(
  options: GitHubPullRequestServiceOptions = {}
): PullRequestService {
  return {
    async createDraft(input: PullRequestDraftInput): Promise<ExecutionPullRequest> {
      const remoteName = options.remoteName ?? "origin";
      const remoteInfo = await getGitHubRemoteInfo(input.repositoryPath, remoteName);
      await pushBranchToOrigin(input.repositoryPath, input.headBranch, remoteName);
      const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

      if (token) {
        return createDraftViaApiToken(input, remoteInfo, token);
      }

      if (await hasGhCliAuth(input.repositoryPath)) {
        return createDraftViaGhCli(input, remoteInfo.repositoryFullName);
      }

      throw new Error(
        "Draft PR creation requires GITHUB_TOKEN, GH_TOKEN, or an authenticated GitHub CLI session (`gh auth login`)."
      );
    }
  };
}

async function createDraftViaApiToken(
  input: PullRequestDraftInput,
  remoteInfo: { owner: string; repo: string; repositoryFullName: string },
  token: string
): Promise<ExecutionPullRequest> {
  const octokit = new Octokit({ auth: token });
  const response = await octokit.rest.pulls.create({
    owner: remoteInfo.owner,
    repo: remoteInfo.repo,
    base: input.baseBranch,
    head: input.headBranch,
    title: input.title,
    body: input.body,
    draft: true
  });

  return {
    url: response.data.html_url,
    number: response.data.number,
    title: response.data.title,
    body: response.data.body ?? input.body,
    baseBranch: response.data.base.ref,
    headBranch: response.data.head.ref,
    repositoryFullName: remoteInfo.repositoryFullName,
    isDraft: Boolean(response.data.draft),
    createdAt: response.data.created_at
  };
}

async function createDraftViaGhCli(
  input: PullRequestDraftInput,
  repositoryFullName: string
): Promise<ExecutionPullRequest> {
  const createOutput = await execCommand(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--repo",
      repositoryFullName,
      "--base",
      input.baseBranch,
      "--head",
      input.headBranch,
      "--title",
      input.title,
      "--body",
      input.body
    ],
    input.repositoryPath
  );
  const pullRequestUrl = firstNonEmptyLine(createOutput);

  if (!pullRequestUrl) {
    throw new Error("GitHub CLI created no pull-request URL output.");
  }

  const detailsRaw = await execCommand(
    "gh",
    [
      "pr",
      "view",
      pullRequestUrl,
      "--repo",
      repositoryFullName,
      "--json",
      "number,title,body,url,baseRefName,headRefName,isDraft,createdAt"
    ],
    input.repositoryPath
  );
  const details = JSON.parse(detailsRaw) as {
    number: number;
    title: string;
    body: string | null;
    url: string;
    baseRefName: string;
    headRefName: string;
    isDraft: boolean;
    createdAt: string;
  };

  return {
    url: details.url,
    number: details.number,
    title: details.title,
    body: details.body ?? input.body,
    baseBranch: details.baseRefName,
    headBranch: details.headRefName,
    repositoryFullName,
    isDraft: details.isDraft,
    createdAt: details.createdAt
  };
}

async function hasGhCliAuth(repositoryPath: string): Promise<boolean> {
  try {
    await execCommand("gh", ["auth", "status", "--hostname", "github.com"], repositoryPath);
    return true;
  } catch (error) {
    if (isMissingCommandError(error)) {
      return false;
    }

    return false;
  }
}

async function pushBranchToOrigin(repositoryPath: string, branchName: string, remoteName: string): Promise<void> {
  await execGit(repositoryPath, ["push", remoteName, `${branchName}:${branchName}`, "--set-upstream"]);
}

async function getGitHubRemoteInfo(
  repositoryPath: string,
  remoteName: string
): Promise<{ owner: string; repo: string; repositoryFullName: string }> {
  const remoteUrl = await execGit(repositoryPath, ["remote", "get-url", remoteName]);
  const parsed = parseGitHubRemoteUrl(remoteUrl);

  if (!parsed) {
    throw new Error(`Remote "${remoteName}" is not a recognizable GitHub remote: ${remoteUrl}`);
  }

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    repositoryFullName: `${parsed.owner}/${parsed.repo}`
  };
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

async function execGit(cwd: string, args: string[]): Promise<string> {
  return execCommand("git", args, cwd);
}

async function execCommand(command: string, args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8"
  });
  return result.stdout.trim();
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
}

function isMissingCommandError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
