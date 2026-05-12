import { OPENTOP_CLAIM, OPENTOP_FULL_NAME } from "@opentop/shared";

const columns = [
  {
    title: "Inbox",
    count: 3,
    items: ["GitHub import", "Manual ticket", "Needs triage"]
  },
  {
    title: "Classified",
    count: 2,
    items: ["Bugfix route", "Architecture route"]
  },
  {
    title: "Ready",
    count: 1,
    items: ["Approval pending"]
  },
  {
    title: "Running",
    count: 1,
    items: ["opentop/issue-123"]
  },
  {
    title: "Review",
    count: 1,
    items: ["Draft PR open"]
  },
  {
    title: "Done",
    count: 0,
    items: []
  }
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">OpenTop</p>
          <h1>{OPENTOP_FULL_NAME}</h1>
          <p className="claim">{OPENTOP_CLAIM}</p>
        </div>
        <nav aria-label="Primary">
          <a className="active" href="/">
            Board
          </a>
          <a href="/">Tickets</a>
          <a href="/">Executions</a>
          <a href="/">Config</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local control plane</p>
            <h2>Execution Board</h2>
          </div>
          <button type="button">Run selected</button>
        </header>

        <section className="board" aria-label="Ticket execution board">
          {columns.map((column) => (
            <article className="lane" key={column.title}>
              <header>
                <h3>{column.title}</h3>
                <span>{column.count}</span>
              </header>
              <div className="cards">
                {column.items.map((item) => (
                  <div className="ticket" key={item}>
                    <strong>{item}</strong>
                    <small>Profile, model, risk, and mode visible here.</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
