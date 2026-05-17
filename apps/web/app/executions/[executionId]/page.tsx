import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveExecutionReviewAction,
  createPullRequestAction,
  rejectExecutionReviewAction,
  runTicketAction
} from "../../actions";
import { getExecution } from "../../../lib/opentop-api";

export const dynamic = "force-dynamic";

function formatOutputKind(value: "plan" | "patch_proposal" | "review_note" | "general" | undefined): string {
  switch (value) {
    case "plan":
      return "plan";
    case "patch_proposal":
      return "patch proposal";
    case "review_note":
      return "review note";
    case "general":
      return "general";
    default:
      return "(not set)";
  }
}

function formatExecutionStatus(status: string): string {
  return status === "output_ready" ? "output ready for review" : status;
}

function formatReviewStatus(status: "not_required" | "pending" | "approved" | "rejected"): string {
  return status.replace("_", " ");
}

function formatCheckStatus(status: "passed" | "failed" | "skipped"): string {
  return status;
}

function getReviewGuidance(outputKind: "plan" | "patch_proposal" | "review_note" | "general" | undefined): {
  title: string;
  body: string;
} {
  switch (outputKind) {
    case "plan":
      return {
        title: "Review the proposed implementation path",
        body: "Check whether the scope, order of work, and assumptions match the ticket before anyone starts changing code."
      };
    case "patch_proposal":
      return {
        title: "Review the proposed code changes",
        body: "Look for risky edits, missing tests, and places where the proposal should be turned into a real workspace change only after human confirmation."
      };
    case "review_note":
      return {
        title: "Review the analysis and feedback",
        body: "Use this output as guidance for a follow-up implementation or a human decision, not as proof that the repository was updated."
      };
    default:
      return {
        title: "Review the provider output",
        body: "This run produced text for review. Treat it as a draft artifact until someone validates the content and decides the next step."
      };
  }
}

function stripMarkdownMarker(value: string): string {
  return value.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function extractSummary(text: string): string | undefined {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (paragraph.startsWith("```")) {
      continue;
    }

    const lines = paragraph.split("\n").map((line) => line.trim());

    if (lines.every((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))) {
      continue;
    }

    const cleaned = lines
      .filter((line) => !/^#{1,6}\s+/.test(line) && !/^[A-Za-z][A-Za-z0-9 /()-]{1,80}:$/.test(line))
      .join(" ")
      .trim();

    if (cleaned) {
      return cleaned;
    }
  }

  return undefined;
}

function extractBulletItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map(stripMarkdownMarker)
    .filter(Boolean)
    .slice(0, 12);
}

function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const matches = [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];

  return matches
    .map((match) => ({
      language: match[1].trim() || "text",
      code: match[2].trim()
    }))
    .filter((block) => block.code.length > 0);
}

function extractReferencedFiles(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:diff --git a\/|--- a\/|\+\+\+ b\/)([A-Za-z0-9._/-]+)/g),
    ...text.matchAll(/`([A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)`/g)
  ];

  return [...new Set(matches.map((match) => match[1]).filter(Boolean))].slice(0, 12);
}

function extractSections(text: string): Array<{ title: string; lines: string[] }> {
  const lines = text.split("\n");
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock || !trimmed) {
      continue;
    }

    const markdownHeading = trimmed.match(/^#{1,6}\s+(.+)$/);
    const labelHeading = /^[A-Za-z][A-Za-z0-9 /()-]{1,80}:$/.test(trimmed)
      ? trimmed.slice(0, -1).trim()
      : undefined;
    const heading = markdownHeading?.[1].trim() ?? labelHeading;

    if (heading) {
      current = { title: heading, lines: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(trimmed);
  }

  return sections
    .map((section) => ({
      title: section.title,
      lines: section.lines.filter(Boolean)
    }))
    .filter((section) => section.lines.length > 0);
}

function buildNextActions(outputKind: "plan" | "patch_proposal" | "review_note" | "general" | undefined): string[] {
  switch (outputKind) {
    case "plan":
      return [
        "Validate the proposed scope against the original ticket.",
        "Confirm the order of implementation before starting code changes.",
        "Turn the approved plan into concrete work items or a follow-up execution."
      ];
    case "patch_proposal":
      return [
        "Inspect the referenced files and compare the proposal with local project rules.",
        "Decide whether to convert the proposal into an explicit workspace-changing run.",
        "Check whether tests or follow-up review notes are still missing."
      ];
    case "review_note":
      return [
        "Use the note to decide whether to revise the ticket, prompt, or routing choice.",
        "Capture any missing implementation tasks before starting a code-changing run.",
        "Keep this analysis as context for the next execution."
      ];
    default:
      return [
        "Review the output for accuracy and project fit.",
        "Decide whether the next run should plan, implement, or stay in review mode.",
        "Keep local changes gated until a human explicitly approves the next step."
      ];
  }
}

function extractFailureReason(execution: Awaited<ReturnType<typeof getExecution>>["execution"]): string | undefined {
  if (execution.logs.length === 0) {
    return undefined;
  }

  for (let index = execution.logs.length - 1; index >= 0; index -= 1) {
    const line = execution.logs[index]?.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("Provider summary:")) {
      return line.replace(/^Provider summary:\s*/u, "").trim();
    }

    if (/failed\./i.test(line) || /quota/i.test(line) || /billing/i.test(line) || /error/i.test(line)) {
      return line;
    }
  }

  return undefined;
}

export default async function ExecutionDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ executionId: string }>;
  searchParams: Promise<{ run?: string; review?: string; pullRequest?: string }>;
}) {
  const { executionId } = await params;
  const query = await searchParams;

  try {
    const { execution, checkRuns } = await getExecution(executionId);
    const reviewGuidance = getReviewGuidance(execution.outputKind);
    const reviewSummary = execution.outputText ? extractSummary(execution.outputText) : undefined;
    const reviewBulletItems = execution.outputText ? extractBulletItems(execution.outputText) : [];
    const reviewSections = execution.outputText ? extractSections(execution.outputText) : [];
    const reviewCodeBlocks = execution.outputText ? extractCodeBlocks(execution.outputText) : [];
    const reviewFiles = execution.outputText ? extractReferencedFiles(execution.outputText) : [];
    const nextActions = buildNextActions(execution.outputKind);
    const failureReason = execution.status === "failed" ? extractFailureReason(execution) : undefined;

    return (
      <main className="detail-shell">
        <header className="detail-header">
          <div>
            <p className="eyebrow">Execution Detail</p>
            <h1>Execution #{execution.id}</h1>
            <p className="subline">
              Ticket #{execution.ticketId} · {execution.providerId}/{execution.modelId} ·{" "}
              {formatExecutionStatus(execution.status)}
            </p>
          </div>
          <div className="detail-actions">
            <Link className="ghost-button" href={`/tickets/${execution.ticketId}`}>
              Back to ticket
            </Link>
            {execution.artifactKind === "review_output" ? (
              <form action={runTicketAction}>
                <input name="ticketId" type="hidden" value={execution.ticketId} />
                <button type="submit">Start follow-up execution</button>
              </form>
            ) : null}
          </div>
        </header>

        {query.run === "succeeded" ? (
          <section className="notice notice-success">
            Execution completed successfully. Review the output, logs, and changed files below.
          </section>
        ) : null}

        {query.run === "output_ready" ? (
          <section className="notice notice-success">
            Execution produced review output. Inspect the plan, patch proposal, or review note below before applying
            any local changes.
          </section>
        ) : null}

        {query.run === "failed" ? (
          <section className="notice notice-warning">
            Execution failed. Review the logs below to understand what the provider returned.
          </section>
        ) : null}

        {execution.status === "failed" && failureReason ? (
          <section className="failure-callout">
            <p className="failure-callout-label">Execution Failure</p>
            <p className="failure-callout-body">{failureReason}</p>
          </section>
        ) : null}

        {query.review === "approved" ? (
          <section className="notice notice-success">
            Review approved. This execution is now treated as ready for downstream review and PR steps.
          </section>
        ) : null}

        {query.review === "rejected" ? (
          <section className="notice notice-warning">
            Review rejected. Keep the execution in review until the changes are revised or replaced.
          </section>
        ) : null}

        {query.pullRequest === "created" ? (
          <section className="notice notice-success">
            Draft pull request created successfully.
          </section>
        ) : null}

        <section className="detail-grid">
          <article className="panel">
            <h2>Execution</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Status</dt>
                <dd>{formatExecutionStatus(execution.status)}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{execution.branchName}</dd>
              </div>
              <div>
                <dt>Run Kind</dt>
                <dd>{execution.runKind.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{execution.workspacePath}</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>{execution.profileId}</dd>
              </div>
              {execution.workerPlanId ? (
                <div>
                  <dt>Worker Plan</dt>
                  <dd>{execution.workerPlanId}</dd>
                </div>
              ) : null}
              {execution.workItemId ? (
                <div>
                  <dt>Work Item</dt>
                  <dd>{execution.workItemId}</dd>
                </div>
              ) : null}
              <div>
                <dt>Artifact</dt>
                <dd>{execution.artifactKind}</dd>
              </div>
              <div>
                <dt>Output Kind</dt>
                <dd>{formatOutputKind(execution.outputKind)}</dd>
              </div>
              <div>
                <dt>Review Status</dt>
                <dd>{formatReviewStatus(execution.reviewStatus)}</dd>
              </div>
              {execution.reviewedAt ? (
                <div>
                  <dt>Reviewed</dt>
                  <dd>{execution.reviewedAt}</dd>
                </div>
              ) : null}
              <div>
                <dt>Created</dt>
                <dd>{execution.createdAt}</dd>
              </div>
            </dl>
          </article>

          <article className="panel">
            <h2>Classification Snapshot</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Task Type</dt>
                <dd>{execution.classificationSnapshot.taskType}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{execution.classificationSnapshot.risk}</dd>
              </div>
              <div>
                <dt>Complexity</dt>
                <dd>{execution.classificationSnapshot.complexity}</dd>
              </div>
              <div>
                <dt>Suggested Profile</dt>
                <dd>{execution.classificationSnapshot.suggestedProfile}</dd>
              </div>
              <div>
                <dt>Suggested Provider</dt>
                <dd>{execution.classificationSnapshot.suggestedProviderId}</dd>
              </div>
              <div>
                <dt>Suggested Model</dt>
                <dd>{execution.classificationSnapshot.suggestedModel}</dd>
              </div>
              <div>
                <dt>Signals</dt>
                <dd>{execution.classificationSnapshot.detectedSignals.join(", ") || "none"}</dd>
              </div>
            </dl>
          </article>

          <article className="panel">
            <h2>Review Guidance</h2>
            <p className="review-guidance-title">{reviewGuidance.title}</p>
            <p className="subline">{reviewGuidance.body}</p>
          </article>

          <article className="panel">
            <h2>Next Steps</h2>
            <ul className="stack-list">
              {nextActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </article>

          <article className="panel">
            <h2>Review Decision</h2>
            {execution.reviewStatus === "pending" || execution.reviewStatus === "rejected" ? (
              <div className="stack-actions">
                <form action={approveExecutionReviewAction}>
                  <input name="executionId" type="hidden" value={execution.id} />
                  <input name="ticketId" type="hidden" value={execution.ticketId} />
                  <button type="submit">Approve changes</button>
                </form>
                {checkRuns.some((checkRun) => checkRun.status === "failed") ? (
                  <form action={approveExecutionReviewAction}>
                    <input name="executionId" type="hidden" value={execution.id} />
                    <input name="ticketId" type="hidden" value={execution.ticketId} />
                    <input name="overrideFailedChecks" type="hidden" value="1" />
                    <button className="ghost-button" type="submit">
                      Approve with failed-check override
                    </button>
                  </form>
                ) : null}
                <form action={rejectExecutionReviewAction}>
                  <input name="executionId" type="hidden" value={execution.id} />
                  <input name="ticketId" type="hidden" value={execution.ticketId} />
                  <button className="ghost-button" type="submit">
                    Reject changes
                  </button>
                </form>
              </div>
            ) : (
              <p className="subline">
                {execution.reviewStatus === "approved"
                  ? "This execution has already been approved."
                  : "This execution does not currently require a manual review decision."}
              </p>
            )}
          </article>

          <article className="panel">
            <h2>Pull Request</h2>
            {execution.pullRequest ? (
              <div className="stack-actions">
                <p className="subline">
                  Draft PR #{execution.pullRequest.number ?? "?"} on {execution.pullRequest.repositoryFullName}
                </p>
                <a className="ghost-button" href={execution.pullRequest.url} rel="noreferrer" target="_blank">
                  Open draft PR
                </a>
                <p className="subline">
                  {execution.pullRequest.headBranch} {"->"} {execution.pullRequest.baseBranch}
                </p>
              </div>
            ) : execution.reviewStatus === "approved" ? (
              <div className="stack-actions">
                <form action={createPullRequestAction}>
                  <input name="executionId" type="hidden" value={execution.id} />
                  <input name="ticketId" type="hidden" value={execution.ticketId} />
                  <button type="submit">Create draft PR</button>
                </form>
                {checkRuns.some((checkRun) => checkRun.status === "failed") ? (
                  <form action={createPullRequestAction}>
                    <input name="executionId" type="hidden" value={execution.id} />
                    <input name="ticketId" type="hidden" value={execution.ticketId} />
                    <input name="overrideFailedChecks" type="hidden" value="1" />
                    <button className="ghost-button" type="submit">
                      Create draft PR with failed-check override
                    </button>
                  </form>
                ) : null}
              </div>
            ) : (
              <p className="subline">Approve the execution review before creating a draft pull request.</p>
            )}
          </article>

          <article className="panel panel-wide">
            <h2>Prompt Snapshot</h2>
            <pre className="prompt-preview">{execution.promptSnapshot}</pre>
          </article>

          <article className="panel panel-wide">
            <h2>Review Output</h2>
            {execution.outputText ? (
              <>
                <p className="subline">Output kind {formatOutputKind(execution.outputKind)}</p>
                {reviewSummary ? (
                  <div className="review-summary">
                    <strong>Summary</strong>
                    <p>{reviewSummary}</p>
                  </div>
                ) : null}

                {reviewBulletItems.length > 0 ? (
                  <div className="review-section">
                    <h3>Key Points</h3>
                    <ul className="stack-list">
                      {reviewBulletItems.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {reviewFiles.length > 0 ? (
                  <div className="review-section">
                    <h3>Referenced Files</h3>
                    <ul className="stack-list">
                      {reviewFiles.map((file) => (
                        <li key={file}>{file}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {reviewSections.length > 0 ? (
                  <div className="review-grid">
                    {reviewSections.map((section) => (
                      <section className="review-section" key={`${section.title}-${section.lines.join("|")}`}>
                        <h3>{section.title}</h3>
                        {section.lines.every((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) ? (
                          <ul className="stack-list">
                            {section.lines.map((line) => (
                              <li key={`${section.title}-${line}`}>{stripMarkdownMarker(line)}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="review-copy">
                            {section.lines.map((line) => (
                              <p key={`${section.title}-${line}`}>{line}</p>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                ) : null}

                {reviewCodeBlocks.length > 0 ? (
                  <div className="review-grid">
                    {reviewCodeBlocks.map((block, index) => (
                      <section className="review-section" key={`${block.language}-${index}`}>
                        <h3>Code Block {index + 1}</h3>
                        <p className="subline">Language {block.language}</p>
                        <pre className="prompt-preview">{block.code}</pre>
                      </section>
                    ))}
                  </div>
                ) : null}

                <div className="review-section">
                  <h3>Raw Output</h3>
                  <pre className="prompt-preview">{execution.outputText}</pre>
                </div>
              </>
            ) : (
              <p className="empty-state">
                {execution.artifactKind === "review_output"
                  ? "This execution is marked as review output, but no output text was stored."
                  : "No separate review output was recorded for this execution."}
              </p>
            )}
          </article>

          <article className="panel panel-wide">
            <h2>Execution Logs</h2>
            {execution.logs.length === 0 ? (
              <p className="empty-state">No execution logs have been recorded yet.</p>
            ) : (
              <pre className="prompt-preview">{execution.logs.join("\n")}</pre>
            )}
          </article>

          <article className="panel panel-wide">
            <h2>Checks</h2>
            {checkRuns.length === 0 ? (
              <p className="empty-state">No post-run checks were recorded for this execution.</p>
            ) : (
              <div className="review-grid">
                {checkRuns.map((checkRun) => (
                  <section className="review-section" key={checkRun.id}>
                    <h3>
                      {checkRun.name} · {formatCheckStatus(checkRun.status)}
                    </h3>
                    <p className="subline">
                      {checkRun.command ?? "No command configured"}
                      {typeof checkRun.exitCode === "number" ? ` · exit ${checkRun.exitCode}` : ""}
                    </p>
                    <pre className="prompt-preview">{checkRun.output || "No command output was captured."}</pre>
                  </section>
                ))}
              </div>
            )}
          </article>

          <article className="panel">
            <h2>Risk Summary</h2>
            {execution.riskSummary ? (
              <>
                <p className="subline">Level {execution.riskSummary.level}</p>
                <ul className="stack-list">
                  {execution.riskSummary.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <h3>Suggested Actions</h3>
                <ul className="stack-list">
                  {execution.riskSummary.suggestedActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty-state">No additional risk summary was stored for this execution.</p>
            )}
          </article>

          <article className="panel">
            <h2>Changed Files</h2>
            {execution.changedFiles.length === 0 ? (
              <p className="empty-state">
                {execution.artifactKind === "review_output"
                  ? "No local changed files were detected. This run produced review output only."
                  : "No changed files have been detected yet."}
              </p>
            ) : (
              <ul className="stack-list">
                {execution.changedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            )}
          </article>

          <article className="panel panel-wide">
            <h2>Diff Review</h2>
            {execution.diffSummary ? (
              <>
                <p className="subline">
                  {execution.diffSummary.totalFiles} file(s) · +{execution.diffSummary.totalAdditions} / -
                  {execution.diffSummary.totalDeletions}
                </p>
                <div className="review-grid">
                  {execution.diffSummary.files.map((file) => (
                    <section className="review-section" key={file.path}>
                      <h3>{file.path}</h3>
                      <p className="subline">
                        {file.changeType} · +{file.additions} / -{file.deletions}
                      </p>
                      <pre className="prompt-preview">
                        {file.patch ?? "No patch preview was captured for this file."}
                      </pre>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <p className="empty-state">No diff summary was stored for this execution.</p>
            )}
          </article>

          {execution.pullRequest ? (
            <article className="panel panel-wide">
              <h2>Pull Request Draft</h2>
              <p className="subline">{execution.pullRequest.title}</p>
              <pre className="prompt-preview">{execution.pullRequest.body}</pre>
            </article>
          ) : null}
        </section>
      </main>
    );
  } catch {
    notFound();
  }
}
