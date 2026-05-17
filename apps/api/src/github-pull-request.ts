import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionPullRequest, PullRequestDraftInput, PullRequestService } from "@opentop/core";

const execFileAsync = promisify(execFile);

export function createGitHubPullRequestService(): PullRequestService {
  return {
    async createDraft(input: PullRequestDraftInput): Promise<ExecutionPullRequest> {
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

      if (!token) {
        throw new Error("Set GITHUB_TOKEN or GH_TOKEN before creating draft pull requests.");
      }

      const remoteInfo = await getGitHubRemoteInfo(input.repositoryPath);
      await execGit(input.repositoryPath, ["push", "origin", `${input.headBranch}:${input.headBranch}`, "--set-upstream"]);
      const response = await fetch(`https://api.github.com/repos/${remoteInfo.repositoryFullName}/pulls`, {
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
        repositoryFullName: remoteInfo.repositoryFullName,
        isDraft: payload.draft,
        createdAt: payload.created_at
      };
    }
  };
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
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });

  return result.stdout.trim();
}
