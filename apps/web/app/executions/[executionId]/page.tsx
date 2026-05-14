import Link from "next/link";
import { notFound } from "next/navigation";
import { getExecution } from "../../../lib/opentop-api";

export const dynamic = "force-dynamic";

export default async function ExecutionDetailPage({ params }: { params: Promise<{ executionId: string }> }) {
  const { executionId } = await params;

  try {
    const { execution } = await getExecution(executionId);

    return (
      <main className="detail-shell">
        <header className="detail-header">
          <div>
            <p className="eyebrow">Execution Detail</p>
            <h1>Execution #{execution.id}</h1>
            <p className="subline">
              Ticket #{execution.ticketId} · {execution.providerId}/{execution.modelId} · {execution.status}
            </p>
          </div>
          <div className="detail-actions">
            <Link className="ghost-button" href={`/tickets/${execution.ticketId}`}>
              Back to ticket
            </Link>
          </div>
        </header>

        <section className="detail-grid">
          <article className="panel">
            <h2>Execution</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Status</dt>
                <dd>{execution.status}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{execution.branchName}</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>{execution.profileId}</dd>
              </div>
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
            </dl>
          </article>

          <article className="panel panel-wide">
            <h2>Prompt Snapshot</h2>
            <pre className="prompt-preview">{execution.promptSnapshot}</pre>
          </article>

          <article className="panel panel-wide">
            <h2>Execution Logs</h2>
            {execution.logs.length === 0 ? (
              <p className="empty-state">No execution logs have been recorded yet.</p>
            ) : (
              <pre className="prompt-preview">{execution.logs.join("\n")}</pre>
            )}
          </article>

          <article className="panel">
            <h2>Changed Files</h2>
            {execution.changedFiles.length === 0 ? (
              <p className="empty-state">No changed files have been detected yet.</p>
            ) : (
              <ul className="stack-list">
                {execution.changedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </main>
    );
  } catch {
    notFound();
  }
}
