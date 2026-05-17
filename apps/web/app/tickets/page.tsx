import Link from "next/link";
import { getTickets } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const { tickets } = await getTickets();

  return (
    <main className="detail-shell">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Tickets</p>
          <h1>All Tickets</h1>
          <p className="subline">Compact list of stored tickets, their current workflow stage, and their suggested routing.</p>
        </div>
      </header>

      <section className="panel panel-full">
        <div className="panel-heading">
          <div>
            <h2>Stored Tickets</h2>
            <p className="subline">{tickets.length} ticket{tickets.length === 1 ? "" : "s"} in the local OpenTop store.</p>
          </div>
        </div>

        {tickets.length === 0 ? (
          <p className="empty-state">No tickets stored yet.</p>
        ) : (
          <div className="resource-list">
            {tickets.map((ticket) => (
              <Link className="resource-row" href={`/tickets/${ticket.id}`} key={ticket.id}>
                <div className="resource-main">
                  <strong>
                    #{ticket.id} {ticket.title}
                  </strong>
                  <p>{ticket.description || "No description provided."}</p>
                </div>
                <dl className="resource-meta">
                  <div>
                    <dt>Stage</dt>
                    <dd>{ticket.workflowStage}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{ticket.classification.taskType}</dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>
                      {ticket.executionPlan.providerId}/{ticket.executionPlan.modelId}
                    </dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{ticket.executionPlan.profile.mode.replaceAll("_", " ")}</dd>
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
