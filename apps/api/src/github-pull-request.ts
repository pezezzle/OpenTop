import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionPullRequest, PullRequestDraftInput, PullRequestService } from "@opentop/core";

const execFileAsync = promisify(execFile);

export function createGitHubPullRequestService(): PullRequestService {
  return {
    async createDraft(input: PullRequestDraftInput): Promise<ExecutionPullRequest> {
      const remoteInfo = await getGitHubRemoteInfo(input.repositoryPath);
      await execGit(input.repositoryPath, ["push", "origin", `${input.headBranch}:${input.headBranch}`, "--set-upstream"]);
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

      if (token) {
        return createDraftViaApiToken(input, remoteInfo.repositoryFullName, token);
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
  repositoryFullName: string,
  token: string
): Promise<ExecutionPullRequest> {
  const response = await fetch(`https://api.github.com/repos/${repositoryFullName}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "OpenTop"
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.headBranch,
      base: input.baseBranch,
      draft: true
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub pull-request creation failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as {
    html_url: string;
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    created_at: string;
    base: { ref: string };
    head: { ref: string };
  };

  return {
    url: payload.html_url,
    number: payload.number,
    title: payload.title,
    body: payload.body ?? input.body,
    baseBranch: payload.base.ref,
    headBranch: payload.head.ref,
    repositoryFullName,
    isDraft: payload.draft,
    createdAt: payload.created_at
  };
}

async function createDraftViaGhCli(
  input: PullRequestDraftInput,
  repositoryFullName: string
): Promise<ExecutionPullRequest> {
  const createOutput = await execCommand("gh", [
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
  ], input.repositoryPath);
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

async function getGitHubRemoteInfo(
  repositoryPath: string
): Promise<{ owner: string; repo: string; repositoryFullName: string }> {
  const remoteUrl = await execGit(repositoryPath, ["remote", "get-url", "origin"]);
  const parsed = parseGitHubRemoteUrl(remoteUrl);

  if (!parsed) {
    throw new Error(`Remote "origin" is not a recognizable GitHub remote: ${remoteUrl}`);
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
