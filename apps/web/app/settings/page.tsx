import { updateBranchPolicyAction } from "../actions";
import { getConfig, getStatus } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

const policies = ["new", "reuse-current", "manual", "none"] as const;

export default async function SettingsPage() {
  const [config, status] = await Promise.all([getConfig(), getStatus()]);

  return (
    <main className="detail-shell">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Execution Policy</h1>
          <p className="subline">
            Repository {status.project} · current branch {status.currentBranch} · effective policy{" "}
            {config.execution.defaultBranchPolicy.effective ?? "unknown"}
          </p>
        </div>
      </header>

      <section className="detail-grid">
        <article className="panel">
          <h2>Current Values</h2>
          <dl className="stacked-meta">
            <div>
              <dt>Effective</dt>
              <dd>{config.execution.defaultBranchPolicy.effective ?? "(not set)"}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{config.execution.defaultBranchPolicy.project ?? "(not set)"}</dd>
            </div>
            <div>
              <dt>User</dt>
              <dd>{config.execution.defaultBranchPolicy.user ?? "(not set)"}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Set Project Policy</h2>
          <div className="button-stack">
            {policies.map((policy) => (
              <form action={updateBranchPolicyAction} key={`project-${policy}`}>
                <input name="scope" type="hidden" value="project" />
                <input name="value" type="hidden" value={policy} />
                <button type="submit">{policy}</button>
              </form>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Set User Policy</h2>
          <div className="button-stack">
            {policies.map((policy) => (
              <form action={updateBranchPolicyAction} key={`user-${policy}`}>
                <input name="scope" type="hidden" value="user" />
                <input name="value" type="hidden" value={policy} />
                <button type="submit">{policy}</button>
              </form>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
