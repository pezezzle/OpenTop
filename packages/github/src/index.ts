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

export interface GitHubPullRequestServiceOptions {
  token?: string;
  remoteName?: string;
}

export interface GitHubRemoteInfo {
  remoteName: string;
  owner: string;
  repo: string;
  repositoryFullName: string;
  url: string;
}

export interface GitHubConnectionStatus {
  repository: GitHubRemoteInfo | null;
  auth: {
    status: "connected" | "disconnected";
    method: "env_token" | "gh_cli" | "none";
    source: "GITHUB_TOKEN" | "GH_TOKEN" | "gh_cli" | "none";
    login?: string;
    scopes: string[];
    label: string;
  };
  capabilities: {
    canCreateDraftPullRequests: boolean;
    canReadPullRequests: boolean;
    canMarkReadyForReview: boolean;
  };
  issues: string[];
}

export interface GitHubPullRequestStatus {
  repositoryFullName: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseBranch: string;
  headBranch: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  mergedAt?: string;
  readyForReview: boolean;
  canMarkReadyForReview: boolean;
}

export interface GitHubPullRequestStatusOptions {
  repositoryPath: string;
  pullRequest: Pick<ExecutionPullRequest, "repositoryFullName" | "number" | "url">;
}

const AUTHENTICATION_ERROR_MARKERS = ["bad credentials", "requires authentication", "auth", "forbidden", "401", "403"];

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

export function createGitHubPullRequestService(
  options: GitHubPullRequestServiceOptions = {}
): PullRequestService {
  return {
    async createDraft(input: PullRequestDraftInput): Promise<ExecutionPullRequest> {
      const remoteName = options.remoteName ?? "origin";
      const remoteInfo = await getGitHubRemoteInfo(input.repositoryPath, remoteName);
      await pushBranchToOrigin(input.repositoryPath, input.headBranch, remoteName);
      const resolvedToken = resolveGitHubToken(options.token);

      if (resolvedToken) {
        try {
          return await createDraftViaApiToken(input, remoteInfo, resolvedToken.token);
        } catch (error) {
          if (!(await hasGhCliAuth(input.repositoryPath)) || !looksLikeAuthenticationError(error)) {
            throw error;
          }
        }
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

export async function getGitHubConnectionStatus(options: {
  repositoryPath: string;
  remoteName?: string;
  token?: string;
}): Promise<GitHubConnectionStatus> {
  const remoteName = options.remoteName ?? "origin";
  const issues: string[] = [];
  let repository: GitHubRemoteInfo | null = null;

  try {
    repository = await getGitHubRemoteInfo(options.repositoryPath, remoteName);
  } catch (error) {
    issues.push(formatError(error));
  }

  const resolvedToken = resolveGitHubToken(options.token);
  const ghCliAuthenticated = await hasGhCliAuth(options.repositoryPath);

  if (resolvedToken) {
    try {
      const auth = await getTokenAuthStatus(resolvedToken.token, resolvedToken.source);
      return {
        repository,
        auth,
        capabilities: {
          canCreateDraftPullRequests: repository !== null,
          canReadPullRequests: repository !== null,
          canMarkReadyForReview: repository !== null
        },
        issues
      };
    } catch (error) {
      issues.push(`Configured ${resolvedToken.source} could not authenticate with GitHub: ${formatError(error)}`);
    }
  }

  if (ghCliAuthenticated) {
    try {
      const auth = await getGhCliAuthStatus(options.repositoryPath);
      return {
        repository,
        auth,
        capabilities: {
          canCreateDraftPullRequests: repository !== null,
          canReadPullRequests: repository !== null,
          canMarkReadyForReview: repository !== null
        },
        issues
      };
    } catch (error) {
      issues.push(`GitHub CLI authentication could not be inspected: ${formatError(error)}`);
    }
  }

  issues.push("OpenTop could not find GitHub auth. Set GITHUB_TOKEN / GH_TOKEN or log in with `gh auth login`.");

  return {
    repository,
    auth: {
      status: "disconnected",
      method: "none",
      source: "none",
      scopes: [],
      label: "No GitHub authentication available."
    },
    capabilities: {
      canCreateDraftPullRequests: false,
      canReadPullRequests: false,
      canMarkReadyForReview: false
    },
    issues
  };
}

export async function getGitHubPullRequestStatus(
  options: GitHubPullRequestStatusOptions & { token?: string }
): Promise<GitHubPullRequestStatus> {
  const resolvedToken = resolveGitHubToken(options.token);

  if (resolvedToken && options.pullRequest.number) {
    try {
      return await getPullRequestStatusViaApiToken(options.pullRequest, resolvedToken.token);
    } catch (error) {
      if (!(await hasGhCliAuth(options.repositoryPath)) || !looksLikeAuthenticationError(error)) {
        throw error;
      }
    }
  }

  if (await hasGhCliAuth(options.repositoryPath)) {
    return getPullRequestStatusViaGhCli(options.repositoryPath, options.pullRequest);
  }

  throw new Error(
    "GitHub pull-request status requires GITHUB_TOKEN, GH_TOKEN, or an authenticated GitHub CLI session (`gh auth login`)."
  );
}

export async function markPullRequestReadyForReview(
  options: GitHubPullRequestStatusOptions & { token?: string }
): Promise<GitHubPullRequestStatus> {
  const currentStatus = await getGitHubPullRequestStatus(options);

  if (!currentStatus.canMarkReadyForReview) {
    return currentStatus;
  }

  const resolvedToken = resolveGitHubToken(options.token);

  if (resolvedToken) {
    try {
      return await markPullRequestReadyViaApiToken(
        options.pullRequest.repositoryFullName,
        currentStatus.number,
        resolvedToken.token
      );
    } catch (error) {
      if (!(await hasGhCliAuth(options.repositoryPath)) || !looksLikeAuthenticationError(error)) {
        throw error;
      }
    }
  }

  if (await hasGhCliAuth(options.repositoryPath)) {
    return markPullRequestReadyViaGhCli(options.repositoryPath, options.pullRequest);
  }

  throw new Error(
    "Marking a draft PR ready for review requires GITHUB_TOKEN, GH_TOKEN, or an authenticated GitHub CLI session (`gh auth login`)."
  );
}

async function createDraftViaApiToken(
  input: PullRequestDraftInput,
  remoteInfo: GitHubRemoteInfo,
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

  const details = await getPullRequestStatusViaGhCli(input.repositoryPath, {
    repositoryFullName,
    url: pullRequestUrl,
    number: undefined
  });

  return {
    url: details.url,
    number: details.number,
    title: details.title,
    body: input.body,
    baseBranch: details.baseBranch,
    headBranch: details.headBranch,
    repositoryFullName,
    isDraft: details.isDraft,
    createdAt: new Date().toISOString()
  };
}

async function getPullRequestStatusViaApiToken(
  pullRequest: Pick<ExecutionPullRequest, "repositoryFullName" | "number" | "url">,
  token: string
): Promise<GitHubPullRequestStatus> {
  if (!pullRequest.number) {
    throw new Error("A stored pull-request number is required for token-based GitHub status checks.");
  }

  const { owner, repo } = parseRepositoryFullName(pullRequest.repositoryFullName);
  const octokit = new Octokit({ auth: token });
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullRequest.number
  });

  return {
    repositoryFullName: pullRequest.repositoryFullName,
    number: response.data.number,
    title: response.data.title,
    url: response.data.html_url,
    state: response.data.merged_at ? "MERGED" : response.data.state.toUpperCase() as "OPEN" | "CLOSED",
    isDraft: Boolean(response.data.draft),
    baseBranch: response.data.base.ref,
    headBranch: response.data.head.ref,
    mergeStateStatus: response.data.mergeable_state?.toUpperCase(),
    mergedAt: response.data.merged_at ?? undefined,
    readyForReview: response.data.state === "open" && !response.data.draft,
    canMarkReadyForReview: response.data.state === "open" && Boolean(response.data.draft)
  };
}

async function getPullRequestStatusViaGhCli(
  repositoryPath: string,
  pullRequest: Pick<ExecutionPullRequest, "repositoryFullName" | "number" | "url">
): Promise<GitHubPullRequestStatus> {
  const selector = pullRequest.url || String(pullRequest.number ?? "");

  if (!selector) {
    throw new Error("Stored pull-request metadata is missing both URL and number.");
  }

  const detailsRaw = await execCommand(
    "gh",
    [
      "pr",
      "view",
      selector,
      "--repo",
      pullRequest.repositoryFullName,
      "--json",
      "number,title,url,isDraft,state,baseRefName,headRefName,mergeStateStatus,reviewDecision,mergedAt"
    ],
    repositoryPath
  );
  const details = JSON.parse(detailsRaw) as {
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
    state: "OPEN" | "CLOSED" | "MERGED";
    baseRefName: string;
    headRefName: string;
    mergeStateStatus?: string;
    reviewDecision?: string;
    mergedAt?: string | null;
  };

  return {
    repositoryFullName: pullRequest.repositoryFullName,
    number: details.number,
    title: details.title,
    url: details.url,
    state: details.state,
    isDraft: details.isDraft,
    baseBranch: details.baseRefName,
    headBranch: details.headRefName,
    mergeStateStatus: details.mergeStateStatus,
    reviewDecision: details.reviewDecision || undefined,
    mergedAt: details.mergedAt ?? undefined,
    readyForReview: details.state === "OPEN" && !details.isDraft,
    canMarkReadyForReview: details.state === "OPEN" && details.isDraft
  };
}

async function markPullRequestReadyViaApiToken(
  repositoryFullName: string,
  pullRequestNumber: number,
  token: string
): Promise<GitHubPullRequestStatus> {
  const { owner, repo } = parseRepositoryFullName(repositoryFullName);
  const octokit = new Octokit({ auth: token });
  const lookup = await octokit.graphql<{ repository: { pullRequest: { id: string } | null } }>(
    `
      query PullRequestNodeId($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            id
          }
        }
      }
    `,
    {
      owner,
      repo,
      number: pullRequestNumber
    }
  );
  const nodeId = lookup.repository.pullRequest?.id;

  if (!nodeId) {
    throw new Error(`GitHub pull request #${pullRequestNumber} was not found in ${repositoryFullName}.`);
  }

  await octokit.graphql(
    `
      mutation MarkReadyForReview($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            id
          }
        }
      }
    `,
    {
      pullRequestId: nodeId
    }
  );

  return getPullRequestStatusViaApiToken(
    {
      repositoryFullName,
      number: pullRequestNumber,
      url: ""
    },
    token
  );
}

async function markPullRequestReadyViaGhCli(
  repositoryPath: string,
  pullRequest: Pick<ExecutionPullRequest, "repositoryFullName" | "number" | "url">
): Promise<GitHubPullRequestStatus> {
  const selector = pullRequest.url || String(pullRequest.number ?? "");

  if (!selector) {
    throw new Error("Stored pull-request metadata is missing both URL and number.");
  }

  await execCommand("gh", ["pr", "ready", selector, "--repo", pullRequest.repositoryFullName], repositoryPath);
  return getPullRequestStatusViaGhCli(repositoryPath, pullRequest);
}

async function getTokenAuthStatus(
  token: string,
  source: "GITHUB_TOKEN" | "GH_TOKEN"
): Promise<GitHubConnectionStatus["auth"]> {
  const octokit = new Octokit({ auth: token });
  const response = await octokit.request("GET /user");
  const headerValue = response.headers["x-oauth-scopes"];
  const scopes = typeof headerValue === "string" ? parseScopeList(headerValue) : [];

  return {
    status: "connected",
    method: "env_token",
    source,
    login: response.data.login,
    scopes,
    label: `Connected to GitHub as ${response.data.login} via ${source}.`
  };
}

async function getGhCliAuthStatus(repositoryPath: string): Promise<GitHubConnectionStatus["auth"]> {
  const login = firstNonEmptyLine(await execCommand("gh", ["api", "user", "--jq", ".login"], repositoryPath));
  const statusOutput = await execCommand("gh", ["auth", "status", "--hostname", "github.com"], repositoryPath);
  const scopes = parseScopesFromGhAuthStatus(statusOutput);

  return {
    status: "connected",
    method: "gh_cli",
    source: "gh_cli",
    login: login || parseLoginFromGhAuthStatus(statusOutput),
    scopes,
    label: login
      ? `Connected to GitHub as ${login} via the local GitHub CLI session.`
      : "Connected to GitHub through the local GitHub CLI session."
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

async function getGitHubRemoteInfo(repositoryPath: string, remoteName: string): Promise<GitHubRemoteInfo> {
  const remoteUrl = await execGit(repositoryPath, ["remote", "get-url", remoteName]);
  const parsed = parseGitHubRemoteUrl(remoteUrl);

  if (!parsed) {
    throw new Error(`Remote "${remoteName}" is not a recognizable GitHub remote: ${remoteUrl}`);
  }

  return {
    remoteName,
    owner: parsed.owner,
    repo: parsed.repo,
    repositoryFullName: `${parsed.owner}/${parsed.repo}`,
    url: `https://github.com/${parsed.owner}/${parsed.repo}`
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

function parseRepositoryFullName(repositoryFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repositoryFullName.split("/");

  if (!owner || !repo) {
    throw new Error(`GitHub repository name is invalid: ${repositoryFullName}`);
  }

  return { owner, repo };
}

function resolveGitHubToken(
  overrideToken?: string
): { token: string; source: "GITHUB_TOKEN" | "GH_TOKEN" } | undefined {
  if (overrideToken) {
    return {
      token: overrideToken,
      source: "GITHUB_TOKEN"
    };
  }

  if (process.env.GITHUB_TOKEN) {
    return {
      token: process.env.GITHUB_TOKEN,
      source: "GITHUB_TOKEN"
    };
  }

  if (process.env.GH_TOKEN) {
    return {
      token: process.env.GH_TOKEN,
      source: "GH_TOKEN"
    };
  }

  return undefined;
}

function parseScopeList(value: string): string[] {
  return value
    .split(",")
    .map((scope) => scope.trim().replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function parseLoginFromGhAuthStatus(output: string): string | undefined {
  const match = output.match(/Logged in to github\.com account ([A-Za-z0-9-]+)/);
  return match?.[1];
}

function parseScopesFromGhAuthStatus(output: string): string[] {
  const match = output.match(/Token scopes:\s+(.+)$/m);
  return match ? parseScopeList(match[1]) : [];
}

function looksLikeAuthenticationError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return AUTHENTICATION_ERROR_MARKERS.some((marker) => message.includes(marker));
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

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Unexpected GitHub integration error.";
}
