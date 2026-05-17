import Link from "next/link";
import { createTicketAction } from "./actions";
import { getConfig, getExecutions, getProviders, getStatus, getTickets, type TicketSummary } from "../lib/opentop-api";

export const dynamic = "force-dynamic";

const lanes: Array<TicketSummary["workflowStage"]> = ["Inbox", "Classified", "Ready", "Running", "Review", "Done"];

function formatExecutionStatus(status: string): string {
  return status === "output_ready" ? "output ready for review" : status;
}

function describeLaneFocus(lane: TicketSummary["workflowStage"]): string {
  switch (lane) {
    case "Inbox":
      return "New tickets waiting for classification.";
    case "Classified":
      return "Routed and ready for prompt or plan review.";
    case "Ready":
      return "Cleared to start the next execution.";
    case "Running":
      return "Currently being worked by a provider.";
    case "Review":
      return "Waiting for human approval or follow-up.";
    case "Done":
      return "Finished or shipped work.";
    default:
      return "";
  }
}

export default async function Home() {
  const [status, ticketResponse, executionResponse, config, providerResponse] = await Promise.all([
    getStatus(),
    getTickets(),
    getExecutions(),
    getConfig(),
    getProviders()
  ]);
  const providerWarnings = providerResponse.providers.filter((provider) => provider.status !== "ready");
  const executionsAwaitingReview = executionResponse.executions.filter((execution) => execution.reviewStatus === "pending").length;
  const reviewOutputCount = executionResponse.executions.filter((execution) => execution.status === "output_ready").length;

  const ticketsByLane = Object.fromEntries(
    lanes.map((lane) => [lane, ticketResponse.tickets.filter((ticket) => ticket.workflowStage === lane)])
  ) as Record<(typeof lanes)[number], TicketSummary[]>;

  return (
    <main className="page-stack">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Board</p>
            <h2>Work Queue</h2>
            <p className="subline">
              {ticketResponse.tickets.length} tickets across the workflow, {executionResponse.executions.length} stored
              executions, branch policy <strong>{config.execution.defaultBranchPolicy.effective ?? "unknown"}</strong>
            </p>
          </div>
          <div className="topbar-meta">
            <span>Default branch: {status.defaultBranch}</span>
            <span>Stored executions: {status.storedExecutions}</span>
          </div>
        </header>

        {providerWarnings.length > 0 ? (
          <p className="notice notice-warning">
            Provider setup needs attention. Review the warnings on the{" "}
            <Link href="/settings">Settings</Link> page before starting new executions.
          </p>
        ) : null}

        <section className="summary-strip" aria-label="Board summary">
          <article className="summary-card">
            <span className="summary-label">Ready To Run</span>
            <strong className="summary-value">{ticketsByLane.Ready.length}</strong>
            <p className="summary-copy">Tickets that can start immediately without further review gates.</p>
          </article>
          <article className="summary-card">
            <span className="summary-label">Needs Review</span>
            <strong className="summary-value">{executionsAwaitingReview + ticketsByLane.Review.length}</strong>
            <p className="summary-copy">Human approvals, review output, and execution follow-ups waiting on the team.</p>
          </article>
          <article className="summary-card">
            <span className="summary-label">Review Output</span>
            <strong className="summary-value">{reviewOutputCount}</strong>
            <p className="summary-copy">Runs that produced plans, notes, or patch proposals instead of local file edits.</p>
          </article>
        </section>

        <section className="overview-grid">
          <article className="panel">
            <h2>Create Ticket</h2>
            <p className="subline">Start with a short title and one or two concrete sentences about the expected outcome.</p>
            <form action={createTicketAction} className="stack-form">
              <label className="field">
                <span>Title</span>
                <input name="title" placeholder="Provider smoke test" required type="text" />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea name="description" placeholder="Describe the ticket in one or two concrete sentences." rows={4} />
              </label>
              <label className="field">
                <span>Labels</span>
                <input name="labels" placeholder="bug, ui, auth" type="text" />
              </label>
              <button type="submit">Create ticket</button>
            </form>
          </article>

          <article className="panel">
            <h2>Recent Executions</h2>
            <p className="subline">Use this as the quickest way back into review, failures, or follow-up work.</p>
            <p className="inline-actions">
              <Link href="/executions">Open all executions</Link>
            </p>
            {executionResponse.executions.length === 0 ? (
              <p className="empty-state">No executions stored yet.</p>
            ) : (
              <div className="list-grid">
                {executionResponse.executions.slice(0, 4).map((execution) => (
                  <Link className="execution-card" href={`/executions/${execution.id}`} key={execution.id}>
                    <strong>Execution #{execution.id}</strong>
                    <span>{formatExecutionStatus(execution.status)}</span>
                    <small>
                      Ticket #{execution.ticketId} ·{" "}
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

        <section className="board" aria-label="Ticket execution board">
          {lanes.map((lane) => (
            <article className="lane" key={lane}>
              <header>
                <div>
                  <h3>{lane}</h3>
                  <p className="lane-copy">{describeLaneFocus(lane)}</p>
                </div>
                <span>{ticketsByLane[lane].length}</span>
              </header>

              <div className="cards">
                {ticketsByLane[lane].length === 0 ? (
                  <p className="empty-state">No tickets in this stage.</p>
                ) : (
                  ticketsByLane[lane].map((ticket) => (
                    <Link className="ticket" href={`/tickets/${ticket.id}`} key={ticket.id}>
                      <div className="ticket-header">
                        <strong>{ticket.title}</strong>
                        <small>#{ticket.id}</small>
                      </div>
                      <p>{ticket.description || "No description provided."}</p>
                      <dl className="ticket-meta">
                        <div>
                          <dt>Task</dt>
                          <dd>{ticket.classification.taskType}</dd>
                        </div>
                        <div>
                          <dt>Next Mode</dt>
                          <dd>{ticket.executionPlan.profile.mode.replaceAll("_", " ")}</dd>
                        </div>
                        <div>
                          <dt>Routing</dt>
                          <dd>
                            {ticket.executionPlan.providerId}/{ticket.executionPlan.modelId}
                          </dd>
                        </div>
                      </dl>
                    </Link>
                  ))
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="summary-strip" aria-label="Workspace health">
          <article className="summary-card">
            <span className="summary-label">Repository</span>
            <strong className="summary-value summary-value-tight">{status.project}</strong>
            <p className="summary-copy">{status.repository}</p>
          </article>
          <article className="summary-card">
            <span className="summary-label">Current Branch</span>
            <strong className="summary-value summary-value-tight">{status.currentBranch}</strong>
            <p className="summary-copy">Default branch: {status.defaultBranch}</p>
          </article>
          <article className="summary-card">
            <span className="summary-label">Workspace State</span>
            <strong className="summary-value summary-value-tight">{status.isClean ? "Clean" : "Dirty"}</strong>
            <p className="summary-copy">
              {providerWarnings.length > 0
                ? `${providerWarnings.length} provider issue${providerWarnings.length === 1 ? "" : "s"} still need attention.`
                : "Providers look ready for work."}
            </p>
          </article>
        </section>
      </section>
    </main>
  );
}
