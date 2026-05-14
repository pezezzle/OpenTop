import Link from "next/link";
import { getConfig, getExecutions, getStatus, getTickets, type TicketSummary } from "../lib/opentop-api";

export const dynamic = "force-dynamic";

const lanes: Array<TicketSummary["workflowStage"]> = ["Inbox", "Classified", "Ready", "Running", "Review", "Done"];

export default async function Home() {
  const [status, ticketResponse, executionResponse, config] = await Promise.all([
    getStatus(),
    getTickets(),
    getExecutions(),
    getConfig()
  ]);

  const ticketsByLane = Object.fromEntries(
    lanes.map((lane) => [lane, ticketResponse.tickets.filter((ticket) => ticket.workflowStage === lane)])
  ) as Record<(typeof lanes)[number], TicketSummary[]>;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">OpenTop</p>
          <h1>Open Ticket Orchestrator Platform</h1>
          <p className="claim">The control plane for agentic software development.</p>
        </div>

        <nav aria-label="Primary">
          <Link className="active" href="/">
            Board
          </Link>
          <Link href="/settings">Settings</Link>
        </nav>

        <section className="status-card">
          <p className="eyebrow">Repository</p>
          <strong>{status.project}</strong>
          <span>{status.repository}</span>
          <dl>
            <div>
              <dt>Branch</dt>
              <dd>{status.currentBranch}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{status.branchPolicy}</dd>
            </div>
            <div>
              <dt>Tree</dt>
              <dd className={status.isClean ? "tone-good" : "tone-warn"}>{status.isClean ? "clean" : "dirty"}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Primary Interface</p>
            <h2>Execution Board</h2>
            <p className="subline">
              {ticketResponse.tickets.length} tickets, {executionResponse.executions.length} executions, effective policy{" "}
              <strong>{config.execution.defaultBranchPolicy.effective ?? "unknown"}</strong>
            </p>
          </div>
          <div className="topbar-meta">
            <span>Default branch: {status.defaultBranch}</span>
            <span>Stored executions: {status.storedExecutions}</span>
          </div>
        </header>

        <section className="board" aria-label="Ticket execution board">
          {lanes.map((lane) => (
            <article className="lane" key={lane}>
              <header>
                <h3>{lane}</h3>
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
                          <dt>Risk</dt>
                          <dd>{ticket.classification.risk}</dd>
                        </div>
                        <div>
                          <dt>Profile</dt>
                          <dd>{ticket.executionPlan.profile.id}</dd>
                        </div>
                        <div>
                          <dt>Mode</dt>
                          <dd>{ticket.classification.suggestedMode}</dd>
                        </div>
                      </dl>
                    </Link>
                  ))
                )}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
