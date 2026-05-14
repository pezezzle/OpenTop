import { updateBranchPolicyAction } from "../actions";
import { getConfig, getProviders, getStatus } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

const policies = ["new", "reuse-current", "manual", "none"] as const;

export default async function SettingsPage() {
  const [config, status, providerResponse] = await Promise.all([getConfig(), getStatus(), getProviders()]);

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

        <article className="panel panel-span-2">
          <h2>Providers</h2>
          <p className="subline">
            Runtime checks for configured provider commands, routed model tiers, and common compatibility risks.
          </p>

          <div className="provider-grid">
            {providerResponse.providers.map((provider) => (
              <section className="provider-card" key={provider.providerId}>
                <div className="provider-card-header">
                  <div>
                    <strong>{provider.providerId}</strong>
                    <p className="provider-type">
                      {provider.type}
                      {provider.version ? ` · ${provider.version}` : ""}
                    </p>
                  </div>
                  <span className={`provider-badge provider-${provider.status}`}>{provider.status}</span>
                </div>

                <dl className="stacked-meta">
                  <div>
                    <dt>Command</dt>
                    <dd>{provider.command ?? "(none)"}</dd>
                  </div>
                  <div>
                    <dt>Available</dt>
                    <dd className={provider.available ? "tone-good" : "tone-danger"}>
                      {provider.available ? "yes" : "no"}
                    </dd>
                  </div>
                  <div>
                    <dt>Model tiers</dt>
                    <dd>
                      {provider.modelTiers.length === 0
                        ? "(none)"
                        : provider.modelTiers.map((modelTier) => `${modelTier.tier} -> ${modelTier.model}`).join(", ")}
                    </dd>
                  </div>
                </dl>

                <div className="provider-issues">
                  {provider.issues.length === 0 ? (
                    <p className="notice notice-success">No provider issues detected.</p>
                  ) : (
                    provider.issues.map((issue) => (
                      <p className={`notice notice-${issue.severity}`} key={`${provider.providerId}-${issue.code}`}>
                        <strong>{issue.severity}</strong> · {issue.message}
                      </p>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
