import Link from "next/link";
import { notFound } from "next/navigation";
import { runTicketAction } from "../../actions";
import { getTicket } from "../../../lib/opentop-api";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ created?: string; run?: string }>;
}) {
  const { ticketId } = await params;
  const query = await searchParams;

  try {
    const detail = await getTicket(ticketId);

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
          <section className="notice notice-success">Ticket created. You can inspect the prompt or start the execution now.</section>
        ) : null}

        {query.run === "blocked" ? (
          <section className="notice notice-warning">
            Execution was blocked. Check the working tree and branch policy before trying again.
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
            </dl>
          </article>

          <article className="panel">
            <h2>Classification</h2>
            <dl className="stacked-meta">
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
                <dt>Reason</dt>
                <dd>{detail.classification.reason}</dd>
              </div>
            </dl>
          </article>

          <article className="panel panel-wide">
            <h2>Prompt Preview</h2>
            <pre className="prompt-preview">{detail.prompt.prompt}</pre>
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
                    <span>{execution.status}</span>
                    <small>{execution.branchName}</small>
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
