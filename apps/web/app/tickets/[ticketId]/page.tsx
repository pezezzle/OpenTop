import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approvePlanArtifactAction,
  approvePromptReviewAction,
  generateWorkerPlanAction,
  regeneratePlanArtifactAction,
  regeneratePromptReviewAction,
  rejectPlanArtifactAction,
  rejectPromptReviewAction,
  runWorkItemAction,
  runWorkerPlanAction,
  runTicketAction
} from "../../actions";
import type { PlanArtifact, PromptReview, WorkItem, WorkerPlan } from "../../../lib/opentop-api";
import { getTicket } from "../../../lib/opentop-api";

export const dynamic = "force-dynamic";

type DiffLine =
  | { key: string; kind: "context"; content: string }
  | { key: string; kind: "added"; content: string }
  | { key: string; kind: "removed"; content: string };

function formatExecutionStatus(status: string): string {
  return status === "output_ready" ? "output ready for review" : status;
}

function formatReviewStatus(status: PromptReview["status"] | PlanArtifact["status"]): string {
  return status.replace("_", " ");
}

function reviewTone(status: PromptReview["status"] | PlanArtifact["status"]): "good" | "warn" | "neutral" {
  if (status === "approved") {
    return "good";
  }

  if (status === "rejected" || status === "draft") {
    return "warn";
  }

  return "neutral";
}

function workerPlanTone(status: WorkerPlan["status"]): "good" | "warn" | "neutral" {
  if (status === "ready" || status === "integration_ready") {
    return "good";
  }

  if (status === "draft" || status === "failed") {
    return "warn";
  }

  return "neutral";
}

function workItemTone(status: WorkItem["status"]): "good" | "warn" | "neutral" {
  if (status === "done" || status === "ready") {
    return "good";
  }

  if (status === "blocked" || status === "cancelled" || status === "failed") {
    return "warn";
  }

  return "neutral";
}

function buildDiff(currentValue: string, previousValue: string | undefined): DiffLine[] {
  if (!previousValue) {
    return currentValue.split("\n").map((line, index) => ({
      key: `added-${index}`,
      kind: "added",
      content: line
    }));
  }

  const currentLines = currentValue.split("\n");
  const previousLines = previousValue.split("\n");
  const diff: DiffLine[] = [];
  const maxLines = Math.max(currentLines.length, previousLines.length);

  for (let index = 0; index < maxLines; index += 1) {
    const currentLine = currentLines[index];
    const previousLine = previousLines[index];

    if (currentLine === previousLine && currentLine !== undefined) {
      diff.push({ key: `context-${index}`, kind: "context", content: currentLine });
      continue;
    }

    if (previousLine !== undefined) {
      diff.push({ key: `removed-${index}`, kind: "removed", content: previousLine });
    }

    if (currentLine !== undefined) {
      diff.push({ key: `added-${index}`, kind: "added", content: currentLine });
    }
  }

  return diff;
}

function buildBlockedNotice(query: { run?: string; blocker?: string; reason?: string; plan?: string }) {
  if (query.run === "blocked" || query.plan === "blocked") {
    return query.reason ?? "Execution is waiting for review before it can continue.";
  }

  return null;
}

function planWorkflowEnabled(detail: Awaited<ReturnType<typeof getTicket>>): boolean {
  return (
    detail.executionPlan.profile.mode === "plan_only" ||
    detail.executionPlan.profile.mode === "plan_then_implement" ||
    detail.planArtifacts.length > 0
  );
}

function latestApprovedPlanArtifact(detail: Awaited<ReturnType<typeof getTicket>>): PlanArtifact | undefined {
  return detail.planArtifacts.find((planArtifact) => planArtifact.status === "approved");
}

function latestExecutionForWorkItem(detail: Awaited<ReturnType<typeof getTicket>>, workItemId: string) {
  return detail.executions.find((execution) => execution.workItemId === workItemId);
}

export default async function TicketDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{
    created?: string;
    run?: string;
    blocker?: string;
    reason?: string;
    prompt?: string;
    promptReviewId?: string;
    promptReviewStatus?: string;
    plan?: string;
    planArtifactId?: string;
    planArtifactStatus?: string;
    workerPlan?: string;
    workerRun?: string;
  }>;
}) {
  const { ticketId } = await params;
  const query = await searchParams;

  try {
    const detail = await getTicket(ticketId);
    const latestExecution = detail.executions[0];
    const currentPromptReview = detail.promptReview;
    const previousPromptReview = detail.promptReviews.find((promptReview) => promptReview.id !== currentPromptReview.id);
    const promptDiff = buildDiff(currentPromptReview.promptSnapshot, previousPromptReview?.promptSnapshot);
    const currentPlanArtifact = detail.planArtifact;
    const previousPlanArtifact = currentPlanArtifact
      ? detail.planArtifacts.find((planArtifact) => planArtifact.id !== currentPlanArtifact.id)
      : undefined;
    const planDiff = currentPlanArtifact ? buildDiff(currentPlanArtifact.rawOutput, previousPlanArtifact?.rawOutput) : [];
    const blockedNotice = buildBlockedNotice(query);
    const usesPlanWorkflow = planWorkflowEnabled(detail);
    const approvedPlanArtifact = latestApprovedPlanArtifact(detail);
    const currentWorkerPlan = detail.workerPlan;
    const workerPlanNeedsRefresh = approvedPlanArtifact
      ? !currentWorkerPlan || currentWorkerPlan.sourcePlanArtifactId !== approvedPlanArtifact.id
      : false;
    const currentWorkItems = currentWorkerPlan
      ? detail.workItems.filter((workItem) => workItem.workerPlanId === currentWorkerPlan.id)
      : [];

    return (
      <main className="detail-shell">
        <header className="detail-header">
          <div>
            <p className="eyebrow">Ticket Detail</p>
            <h1>{detail.ticket.title}</h1>
            <p className="subline">
              Ticket #{detail.ticket.id} · {detail.ticket.source} · profile {detail.executionPlan.profile.id} · mode{" "}
              {detail.executionPlan.profile.mode}
            </p>
          </div>
          <div className="detail-actions">
            <Link className="ghost-button" href="/">
              Back to board
            </Link>
            <form action={runTicketAction}>
              <input name="ticketId" type="hidden" value={detail.ticket.id} />
              <button type="submit">Start execution</button>
            </form>
          </div>
        </header>

        {query.created === "1" ? (
          <section className="notice notice-success">
            Ticket created. You can inspect the prompt and, when needed, review the generated plan before execution continues.
          </section>
        ) : null}

        {blockedNotice ? <section className="notice notice-warning">{blockedNotice}</section> : null}

        {query.prompt === "approved" ? (
          <section className="notice notice-success">Prompt approved. This ticket can now run whenever you are ready.</section>
        ) : null}

        {query.prompt === "rejected" ? (
          <section className="notice notice-warning">
            Prompt rejected. Regenerate or revise the latest prompt version before starting an execution.
          </section>
        ) : null}

        {query.prompt === "regenerated" ? (
          <section className="notice notice-info">
            Prompt regenerated. Review the new version, then approve or reject it explicitly.
          </section>
        ) : null}

        {query.plan === "approved" ? (
          <section className="notice notice-success">Plan approved. The next execution can move from planning into implementation.</section>
        ) : null}

        {query.plan === "rejected" ? (
          <section className="notice notice-warning">
            Plan rejected. Regenerate a new plan version or revise the planning context before moving forward.
          </section>
        ) : null}

        {query.workerPlan === "generated" ? (
          <section className="notice notice-success">
            Worker plan generated. You can now inspect the planned work items and their dependencies.
          </section>
        ) : null}

        {query.workerRun === "integration_ready" ? (
          <section className="notice notice-success">
            Worker-plan execution completed for now. The feature is ready for integration review.
          </section>
        ) : null}

        {query.workerRun === "running" ? (
          <section className="notice notice-info">Worker-plan execution is in progress.</section>
        ) : null}

        {query.workerRun === "failed" ? (
          <section className="notice notice-warning">
            Worker-plan execution hit a failing work item. Review the latest work-item execution before continuing.
          </section>
        ) : null}

        {query.workerRun === "blocked" ? (
          <section className="notice notice-warning">
            Worker-plan execution is blocked by stale planning state or unresolved dependencies.
          </section>
        ) : null}

        {detail.classification.approvalRequired && currentPromptReview.status !== "approved" ? (
          <section className="notice notice-info">
            This ticket requires prompt approval before execution. Current prompt review status:{" "}
            <strong>{formatReviewStatus(currentPromptReview.status)}</strong>.
          </section>
        ) : null}

        {usesPlanWorkflow && currentPlanArtifact?.status === "draft" ? (
          <section className="notice notice-info">
            A plan draft is waiting for review. Approve it to continue into implementation, or reject/regenerate it first.
          </section>
        ) : null}

        {latestExecution?.artifactKind === "review_output" && latestExecution.status === "output_ready" ? (
          <section className="notice notice-info">
            The latest execution produced review output without local file changes. Review it first, then start a
            follow-up execution when you want to continue.{" "}
            <Link href={`/executions/${latestExecution.id}`}>Open latest review output</Link>
          </section>
        ) : null}

        {latestExecution?.status === "succeeded" && latestExecution.reviewStatus === "pending" ? (
          <section className="notice notice-warning">
            The latest execution changed the workspace and is still waiting for human review.{" "}
            <Link href={`/executions/${latestExecution.id}`}>Open execution review</Link>
          </section>
        ) : null}

        {latestExecution?.status === "succeeded" && latestExecution.reviewStatus === "approved" ? (
          <section className="notice notice-success">
            The latest execution has been reviewed and approved. It is ready for the later PR flow.
          </section>
        ) : null}

        {latestExecution?.pullRequest ? (
          <section className="notice notice-success">
            Draft PR created for the latest execution.{" "}
            <a href={latestExecution.pullRequest.url} rel="noreferrer" target="_blank">
              Open draft PR
            </a>
          </section>
        ) : null}

        <section className="detail-grid">
          <article className="panel">
            <h2>Ticket</h2>
            <p>{detail.ticket.description || "No description provided."}</p>
            <dl className="stacked-meta">
              <div>
                <dt>Labels</dt>
                <dd>{detail.ticket.labels.length > 0 ? detail.ticket.labels.join(", ") : "none"}</dd>
              </div>
              <div>
                <dt>Workflow Stage</dt>
                <dd>{detail.ticket.workflowStage}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{detail.executionPlan.branchName}</dd>
              </div>
              <div>
                <dt>Prompt Approval</dt>
                <dd>{detail.classification.approvalRequired ? "required" : "optional"}</dd>
              </div>
              <div>
                <dt>Plan Workflow</dt>
                <dd>{usesPlanWorkflow ? "enabled" : "not required"}</dd>
              </div>
              <div>
                <dt>Worker Plan</dt>
                <dd>
                  {currentWorkerPlan
                    ? `v${currentWorkerPlan.version} · ${currentWorkerPlan.status.replace("_", " ")}`
                    : "not generated"}
                </dd>
              </div>
              {latestExecution ? (
                <div>
                  <dt>Execution Review</dt>
                  <dd>{latestExecution.reviewStatus.replace("_", " ")}</dd>
                </div>
              ) : null}
              {latestExecution?.pullRequest ? (
                <div>
                  <dt>Draft PR</dt>
                  <dd>
                    <a href={latestExecution.pullRequest.url} rel="noreferrer" target="_blank">
                      #{latestExecution.pullRequest.number ?? "draft"}
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>

          <article className="panel">
            <h2>Classification</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Task Type</dt>
                <dd>{detail.classification.taskType}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{detail.classification.risk}</dd>
              </div>
              <div>
                <dt>Complexity</dt>
                <dd>{detail.classification.complexity}</dd>
              </div>
              <div>
                <dt>Affected Areas</dt>
                <dd>{detail.classification.affectedAreas.join(", ")}</dd>
              </div>
              <div>
                <dt>Signals</dt>
                <dd>{detail.classification.detectedSignals.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{detail.classification.suggestedProviderId}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{detail.classification.suggestedModel}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{detail.classification.reason}</dd>
              </div>
            </dl>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>Prompt Review</h2>
                <p className="subline">
                  Version v{currentPromptReview.version} · review status {formatReviewStatus(currentPromptReview.status)}
                </p>
              </div>
              <span className={`status-pill status-pill-${reviewTone(currentPromptReview.status)}`}>
                {formatReviewStatus(currentPromptReview.status)}
              </span>
            </div>

            <dl className="stacked-meta">
              <div>
                <dt>Prompt Sources</dt>
                <dd>{currentPromptReview.sources.join(", ")}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(currentPromptReview.updatedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Reviewer Comment</dt>
                <dd>{currentPromptReview.reviewerComment || "none"}</dd>
              </div>
            </dl>

            <div className="review-action-grid">
              {currentPromptReview.status !== "approved" ? (
                <form action={approvePromptReviewAction} className="review-action-card">
                  <input name="ticketId" type="hidden" value={detail.ticket.id} />
                  <input name="promptReviewId" type="hidden" value={currentPromptReview.id} />
                  <h3>Approve Prompt</h3>
                  <p className="subline">Confirm that this prompt is ready to use for the next execution.</p>
                  <textarea name="reviewerComment" rows={3} placeholder="Optional note about why this version is approved." />
                  <button type="submit">Approve prompt</button>
                </form>
              ) : (
                <div className="review-action-card review-action-card-static">
                  <h3>Approved</h3>
                  <p className="subline">This prompt is already approved and can be used for execution.</p>
                </div>
              )}

              <form action={rejectPromptReviewAction} className="review-action-card">
                <input name="ticketId" type="hidden" value={detail.ticket.id} />
                <input name="promptReviewId" type="hidden" value={currentPromptReview.id} />
                <h3>Reject Prompt</h3>
                <p className="subline">Block this version and explain what needs to change in the next prompt.</p>
                <textarea name="reviewerComment" rows={3} placeholder="Optional note about what should change before the next run." />
                <button type="submit">Reject prompt</button>
              </form>

              <form action={regeneratePromptReviewAction} className="review-action-card">
                <input name="ticketId" type="hidden" value={detail.ticket.id} />
                <h3>Regenerate Prompt</h3>
                <p className="subline">Create a new prompt version and keep the review history intact.</p>
                <textarea name="reviewerComment" rows={3} placeholder="Optional note to remember why a new version was generated." />
                <button type="submit">Regenerate prompt</button>
              </form>
            </div>
          </article>

          <article className="panel panel-wide">
            <h2>Prompt Preview</h2>
            <pre className="prompt-preview">{detail.prompt.prompt}</pre>
          </article>

          <article className="panel panel-wide">
            <div className="panel-heading">
              <div>
                <h2>Prompt Diff</h2>
                <p className="subline">
                  Comparing current version v{currentPromptReview.version}
                  {previousPromptReview
                    ? ` with previous version v${previousPromptReview.version}.`
                    : " with the first generated version."}
                </p>
              </div>
            </div>

            <div className="prompt-diff">
              {promptDiff.map((line) => (
                <div className={`prompt-diff-line prompt-diff-line-${line.kind}`} key={line.key}>
                  <span className="prompt-diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</span>
                  <code>{line.content || " "}</code>
                </div>
              ))}
            </div>
          </article>

          <article className="panel panel-wide">
            <h2>Prompt History</h2>
            <div className="list-grid prompt-history-grid">
              {detail.promptReviews.map((promptReview) => (
                <article className="prompt-history-card" key={promptReview.id}>
                  <div className="panel-heading">
                    <strong>Version v{promptReview.version}</strong>
                    <span className={`status-pill status-pill-${reviewTone(promptReview.status)}`}>
                      {formatReviewStatus(promptReview.status)}
                    </span>
                  </div>
                  <p className="subline">Updated {new Date(promptReview.updatedAt).toLocaleString()}</p>
                  <p className="prompt-history-comment">{promptReview.reviewerComment || "No reviewer comment stored."}</p>
                </article>
              ))}
            </div>
          </article>

          {usesPlanWorkflow ? (
            <>
              <article className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <h2>Plan Review</h2>
                    <p className="subline">
                      {currentPlanArtifact
                        ? `Version v${currentPlanArtifact.version} · status ${formatReviewStatus(currentPlanArtifact.status)}`
                        : "No plan has been generated yet."}
                    </p>
                  </div>
                  {currentPlanArtifact ? (
                    <span className={`status-pill status-pill-${reviewTone(currentPlanArtifact.status)}`}>
                      {formatReviewStatus(currentPlanArtifact.status)}
                    </span>
                  ) : null}
                </div>

                {currentPlanArtifact ? (
                  <>
                    <dl className="stacked-meta">
                      <div>
                        <dt>Updated</dt>
                        <dd>{new Date(currentPlanArtifact.updatedAt).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Reviewer Comment</dt>
                        <dd>{currentPlanArtifact.reviewerComment || "none"}</dd>
                      </div>
                      <div>
                        <dt>Summary</dt>
                        <dd>{currentPlanArtifact.structuredPlan.summary || "No summary parsed."}</dd>
                      </div>
                    </dl>

                    <div className="review-grid">
                      <section className="review-section">
                        <h3>Implementation Steps</h3>
                        <ul className="stack-list">
                          {currentPlanArtifact.structuredPlan.implementationSteps.length === 0 ? (
                            <li>No structured steps captured.</li>
                          ) : (
                            currentPlanArtifact.structuredPlan.implementationSteps.map((step) => (
                              <li key={step.id}>{step.summary ? `${step.title}: ${step.summary}` : step.title}</li>
                            ))
                          )}
                        </ul>
                      </section>

                      <section className="review-section">
                        <h3>Work Items</h3>
                        <ul className="stack-list">
                          {currentPlanArtifact.structuredPlan.workItems.length === 0 ? (
                            <li>No work items captured.</li>
                          ) : (
                            currentPlanArtifact.structuredPlan.workItems.map((workItem) => (
                              <li key={workItem.id}>{`${workItem.title}: ${workItem.summary}`}</li>
                            ))
                          )}
                        </ul>
                      </section>
                    </div>

                    <div className="review-grid">
                      <section className="review-section">
                        <h3>Risks</h3>
                        <ul className="stack-list">
                          {currentPlanArtifact.structuredPlan.risks.length === 0 ? (
                            <li>none</li>
                          ) : (
                            currentPlanArtifact.structuredPlan.risks.map((risk) => <li key={risk}>{risk}</li>)
                          )}
                        </ul>
                      </section>

                      <section className="review-section">
                        <h3>Open Questions</h3>
                        <ul className="stack-list">
                          {currentPlanArtifact.structuredPlan.openQuestions.length === 0 ? (
                            <li>none</li>
                          ) : (
                            currentPlanArtifact.structuredPlan.openQuestions.map((question) => <li key={question}>{question}</li>)
                          )}
                        </ul>
                      </section>
                    </div>

                    <div className="review-action-grid">
                      {currentPlanArtifact.status !== "approved" ? (
                        <form action={approvePlanArtifactAction} className="review-action-card">
                          <input name="ticketId" type="hidden" value={detail.ticket.id} />
                          <input name="planArtifactId" type="hidden" value={currentPlanArtifact.id} />
                          <h3>Approve Plan</h3>
                          <p className="subline">Confirm this plan as the implementation contract for the next execution.</p>
                          <textarea name="reviewerComment" rows={3} placeholder="Optional note about why this plan is approved." />
                          <button type="submit">Approve plan</button>
                        </form>
                      ) : (
                        <div className="review-action-card review-action-card-static">
                          <h3>Approved</h3>
                          <p className="subline">This plan is approved and can now drive implementation work.</p>
                        </div>
                      )}

                      <form action={rejectPlanArtifactAction} className="review-action-card">
                        <input name="ticketId" type="hidden" value={detail.ticket.id} />
                        <input name="planArtifactId" type="hidden" value={currentPlanArtifact.id} />
                        <h3>Reject Plan</h3>
                        <p className="subline">Stop this plan from advancing and record what needs to change.</p>
                        <textarea name="reviewerComment" rows={3} placeholder="Optional note about what should change in the next plan." />
                        <button type="submit">Reject plan</button>
                      </form>

                      <form action={regeneratePlanArtifactAction} className="review-action-card">
                        <input name="ticketId" type="hidden" value={detail.ticket.id} />
                        <h3>Regenerate Plan</h3>
                        <p className="subline">Run the planner again and keep the full plan history intact.</p>
                        <textarea name="reviewerComment" rows={3} placeholder="Optional note to remember why a new plan was generated." />
                        <button type="submit">Regenerate plan</button>
                      </form>
                    </div>
                  </>
                ) : (
                  <div className="review-action-card review-action-card-static">
                    <h3>No Plan Yet</h3>
                    <p className="subline">
                      This workflow expects a reviewed plan before implementation. Start execution to generate the first planning run.
                    </p>
                  </div>
                )}
              </article>

              {currentPlanArtifact ? (
                <article className="panel panel-wide">
                  <div className="panel-heading">
                    <div>
                      <h2>Plan Diff</h2>
                      <p className="subline">
                        Comparing current version v{currentPlanArtifact.version}
                        {previousPlanArtifact
                          ? ` with previous version v${previousPlanArtifact.version}.`
                          : " with the first generated version."}
                      </p>
                    </div>
                  </div>

                  <div className="prompt-diff">
                    {planDiff.map((line) => (
                      <div className={`prompt-diff-line prompt-diff-line-${line.kind}`} key={line.key}>
                        <span className="prompt-diff-marker">
                          {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                        </span>
                        <code>{line.content || " "}</code>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}

              <article className="panel panel-wide">
                <h2>Plan History</h2>
                {detail.planArtifacts.length === 0 ? (
                  <p className="empty-state">No plan versions stored yet.</p>
                ) : (
                  <div className="list-grid prompt-history-grid">
                    {detail.planArtifacts.map((planArtifact) => (
                      <article className="prompt-history-card" key={planArtifact.id}>
                        <div className="panel-heading">
                          <strong>Version v{planArtifact.version}</strong>
                          <span className={`status-pill status-pill-${reviewTone(planArtifact.status)}`}>
                            {formatReviewStatus(planArtifact.status)}
                          </span>
                        </div>
                        <p className="subline">Updated {new Date(planArtifact.updatedAt).toLocaleString()}</p>
                        <p className="prompt-history-comment">{planArtifact.reviewerComment || "No reviewer comment stored."}</p>
                      </article>
                    ))}
                  </div>
                )}
              </article>

              <article className="panel panel-wide">
                <div className="panel-heading">
                  <div>
                    <h2>Worker Plan</h2>
                    <p className="subline">
                      {currentWorkerPlan
                        ? `Version v${currentWorkerPlan.version} · status ${currentWorkerPlan.status.replace("_", " ")}`
                        : approvedPlanArtifact
                          ? "No worker plan has been generated from the approved plan yet."
                          : "Approve a plan first to generate worker items."}
                    </p>
                  </div>
                  {currentWorkerPlan ? (
                    <span className={`status-pill status-pill-${workerPlanTone(currentWorkerPlan.status)}`}>
                      {currentWorkerPlan.status.replace("_", " ")}
                    </span>
                  ) : null}
                </div>

                {approvedPlanArtifact ? (
                  <div className="review-action-grid">
                    <form action={generateWorkerPlanAction} className="review-action-card">
                      <input name="ticketId" type="hidden" value={detail.ticket.id} />
                      <h3>{workerPlanNeedsRefresh ? "Regenerate Worker Plan" : "Generate Worker Plan"}</h3>
                      <p className="subline">
                        {workerPlanNeedsRefresh
                          ? "Create a fresh worker-plan version from the latest approved plan and supersede older work items."
                          : "Split the approved plan into structured work items with routing, dependency, and branch guidance."}
                      </p>
                      <textarea
                        name="reviewerComment"
                        rows={3}
                        placeholder="Optional note about why this worker plan version is being generated."
                      />
                      <button type="submit">{workerPlanNeedsRefresh ? "Regenerate worker plan" : "Generate worker plan"}</button>
                    </form>

                    {currentWorkerPlan ? (
                      <div className="review-action-card review-action-card-static">
                        <h3>Current Plan Metadata</h3>
                        <p className="subline">
                          Source plan v
                          {
                            detail.planArtifacts.find(
                              (planArtifact) => planArtifact.id === currentWorkerPlan.sourcePlanArtifactId
                            )?.version
                          }{" "}
                          · {currentWorkItems.length} work items
                        </p>
                        <p className="prompt-history-comment">
                          {currentWorkerPlan.reviewerComment || "No reviewer comment stored for this worker plan."}
                        </p>
                      </div>
                    ) : null}

                    {currentWorkerPlan && !workerPlanNeedsRefresh ? (
                      <form action={runWorkerPlanAction} className="review-action-card">
                        <input name="ticketId" type="hidden" value={detail.ticket.id} />
                        <h3>Run Worker Plan</h3>
                        <p className="subline">
                          Execute ready work items sequentially and keep dependency and integration state up to date.
                        </p>
                        <button type="submit">Run worker plan</button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <div className="review-action-card review-action-card-static">
                    <h3>Waiting For Approved Plan</h3>
                    <p className="subline">
                      Worker planning starts only after the latest feature plan has been explicitly approved.
                    </p>
                  </div>
                )}

                {currentWorkerPlan ? (
                  <>
                    <dl className="stacked-meta">
                      <div>
                        <dt>Summary</dt>
                        <dd>{currentWorkerPlan.summary || "No worker-plan summary stored."}</dd>
                      </div>
                      <div>
                        <dt>Integration</dt>
                        <dd>{currentWorkerPlan.integrationSummary || "No integration summary stored yet."}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{new Date(currentWorkerPlan.updatedAt).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Source Plan Version</dt>
                        <dd>
                          v
                          {detail.planArtifacts.find((planArtifact) => planArtifact.id === currentWorkerPlan.sourcePlanArtifactId)
                            ?.version ?? "?"}
                        </dd>
                      </div>
                    </dl>

                    {workerPlanNeedsRefresh ? (
                      <section className="notice notice-warning">
                        The latest approved plan is newer than this worker plan. Regenerate to keep work-item routing in sync.
                      </section>
                    ) : null}

                    <div className="list-grid prompt-history-grid">
                      {currentWorkItems.length === 0 ? (
                        <p className="empty-state">No work items stored for the current worker plan.</p>
                      ) : (
                        currentWorkItems.map((workItem) => (
                          <article className="prompt-history-card" key={workItem.id}>
                            <div className="panel-heading">
                              <strong>{workItem.title}</strong>
                              <span className={`status-pill status-pill-${workItemTone(workItem.status)}`}>
                                {workItem.status.replace("_", " ")}
                              </span>
                            </div>
                            <p className="subline">
                              {workItem.role} · {workItem.suggestedProviderId}/{workItem.suggestedModelId}
                            </p>
                            <p className="prompt-history-comment">{workItem.summary}</p>
                            {latestExecutionForWorkItem(detail, workItem.id) ? (
                              <p className="subline">
                                Latest execution:{" "}
                                <Link href={`/executions/${latestExecutionForWorkItem(detail, workItem.id)!.id}`}>
                                  #{latestExecutionForWorkItem(detail, workItem.id)!.id}
                                </Link>{" "}
                                · {formatExecutionStatus(latestExecutionForWorkItem(detail, workItem.id)!.status)}
                              </p>
                            ) : null}
                            <dl className="stacked-meta">
                              <div>
                                <dt>Mode</dt>
                                <dd>{workItem.suggestedMode}</dd>
                              </div>
                              <div>
                                <dt>Branch Strategy</dt>
                                <dd>{workItem.branchStrategy.replaceAll("_", " ")}</dd>
                              </div>
                              <div>
                                <dt>Affected Areas</dt>
                                <dd>{workItem.affectedAreas.join(", ") || "none"}</dd>
                              </div>
                              <div>
                                <dt>Dependencies</dt>
                                <dd>{workItem.dependsOn.join(", ") || "none"}</dd>
                              </div>
                              <div>
                                <dt>Review Notes</dt>
                                <dd>{workItem.reviewNotes.join(" ") || "none"}</dd>
                              </div>
                            </dl>
                            {workItem.status === "ready" ? (
                              <form action={runWorkItemAction}>
                                <input name="ticketId" type="hidden" value={detail.ticket.id} />
                                <input name="workItemId" type="hidden" value={workItem.id} />
                                <button type="submit">Run work item</button>
                              </form>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
              </article>

              <article className="panel panel-wide">
                <h2>Worker Plan History</h2>
                {detail.workerPlans.length === 0 ? (
                  <p className="empty-state">No worker-plan versions stored yet.</p>
                ) : (
                  <div className="list-grid prompt-history-grid">
                    {detail.workerPlans.map((workerPlan) => (
                      <article className="prompt-history-card" key={workerPlan.id}>
                        <div className="panel-heading">
                          <strong>Version v{workerPlan.version}</strong>
                          <span className={`status-pill status-pill-${workerPlanTone(workerPlan.status)}`}>
                            {workerPlan.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="subline">Updated {new Date(workerPlan.updatedAt).toLocaleString()}</p>
                        <p className="prompt-history-comment">{workerPlan.reviewerComment || "No reviewer comment stored."}</p>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </>
          ) : null}

          <article className="panel panel-wide">
            <h2>Prompt Context</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Profile Mode</dt>
                <dd>{detail.prompt.contextSummary.profileMode}</dd>
              </div>
              <div>
                <dt>Active Profiles</dt>
                <dd>
                  {detail.prompt.contextSummary.activeProfiles.length === 0
                    ? "none"
                    : detail.prompt.contextSummary.activeProfiles
                        .map((profile) => `${profile.displayName} (${profile.type})`)
                        .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>
                  {detail.prompt.contextSummary.budget.usedProfileSections}/
                  {detail.prompt.contextSummary.budget.maxProfileSections} sections,{" "}
                  {detail.prompt.contextSummary.budget.usedProfileWords}/
                  {detail.prompt.contextSummary.budget.maxPromptProfileWords} words
                </dd>
              </div>
            </dl>

            <div className="review-grid">
              <section className="review-section">
                <h3>Influences</h3>
                <ul className="stack-list">
                  {detail.prompt.contextSummary.influences.map((influence) => (
                    <li key={influence}>{influence}</li>
                  ))}
                </ul>
              </section>

              <section className="review-section">
                <h3>Included Sections</h3>
                <ul className="stack-list">
                  {detail.prompt.contextSummary.includedSections.length === 0 ? (
                    <li>none</li>
                  ) : (
                    detail.prompt.contextSummary.includedSections.map((section) => <li key={section}>{section}</li>)
                  )}
                </ul>
              </section>
            </div>

            <p className="subline">Sources: {detail.prompt.sources.join(", ")}</p>
          </article>

          <article className="panel panel-wide">
            <h2>Executions</h2>
            {detail.executions.length === 0 ? (
              <p className="empty-state">No executions stored for this ticket.</p>
            ) : (
              <div className="list-grid">
                {detail.executions.map((execution) => (
                  <Link className="execution-card" href={`/executions/${execution.id}`} key={execution.id}>
                    <strong>Execution #{execution.id}</strong>
                    <span>{formatExecutionStatus(execution.status)}</span>
                    <small>
                      {execution.artifactKind === "review_output"
                        ? execution.outputKind
                          ? `review output · ${execution.outputKind}`
                          : "review output"
                        : execution.branchName}
                    </small>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </section>
      </main>
    );
  } catch {
    notFound();
  }
}
