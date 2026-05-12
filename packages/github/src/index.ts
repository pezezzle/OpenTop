import { Octokit } from "@octokit/rest";
import type { Ticket } from "@opentop/core";

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
