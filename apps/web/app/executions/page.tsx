import Link from "next/link";
import { getExecutions } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

function formatExecutionStatus(status: string): string {
  return status === "output_ready" ? "output ready for review" : status;
}

export default async function ExecutionsPage() {
  const { executions } = await getExecutions();

  return (
    <main className="detail-shell">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Executions</p>
          <h1>All Executions</h1>
          <p className="subline">Review the latest runs, their status, and the current handoff stage without digging through the board.</p>
        </div>
      </header>

      <section className="panel panel-full">
        <div className="panel-heading">
          <div>
            <h2>Stored Executions</h2>
            <p className="subline">
              {executions.length} execution{executions.length === 1 ? "" : "s"} stored for this repository.
            </p>
          </div>
        </div>

        {executions.length === 0 ? (
          <p className="empty-state">No executions stored yet.</p>
        ) : (
          <div className="resource-list">
            {executions.map((execution) => (
              <Link className="resource-row" href={`/executions/${execution.id}`} key={execution.id}>
                <div className="resource-main">
                  <strong>Execution #{execution.id}</strong>
                  <p>
                    Ticket #{execution.ticketId} · {formatExecutionStatus(execution.status)}
                  </p>
                </div>
                <dl className="resource-meta">
                  <div>
                    <dt>Review</dt>
                    <dd>{execution.reviewStatus.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{execution.providerId}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{execution.modelId}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{execution.branchName}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
