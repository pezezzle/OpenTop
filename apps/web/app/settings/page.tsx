import { updateBranchPolicyAction, updateProviderAction } from "../actions";
import { getConfig, getProviders, getStatus } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

const policies = ["new", "reuse-current", "manual", "none"] as const;
const providerTypes = ["codex-cli", "openai-api", "openrouter-api", "custom-shell", "ollama"] as const;
const connectionMethods = ["local_cli", "api_key", "oauth", "custom_command", "local_model"] as const;

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
                    <dt>Connection</dt>
                    <dd>{provider.connectionMethod}</dd>
                  </div>
                  <div>
                    <dt>Command</dt>
                    <dd>{provider.command ?? "(none)"}</dd>
                  </div>
                  <div>
                    <dt>API key env</dt>
                    <dd>{provider.apiKeyEnv ?? "(none)"}</dd>
                  </div>
                  <div>
                    <dt>OAuth provider</dt>
                    <dd>{provider.oauthProvider ?? "(none)"}</dd>
                  </div>
                  <div>
                    <dt>Base URL</dt>
                    <dd>{provider.baseUrl ?? "(none)"}</dd>
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

        <article className="panel panel-span-2">
          <h2>Provider Setup</h2>
          <p className="subline">
            Configure provider type, connection method, and default model tiers without editing YAML by hand.
          </p>

          <form action={updateProviderAction} className="stack-form provider-form">
            <div className="field-grid">
              <label className="field">
                <span>Provider ID</span>
                <input defaultValue="codex" name="providerId" required type="text" />
              </label>

              <label className="field">
                <span>Provider type</span>
                <select defaultValue="codex-cli" name="type">
                  {providerTypes.map((providerType) => (
                    <option key={providerType} value={providerType}>
                      {providerType}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Connection method</span>
                <select defaultValue="local_cli" name="connectionMethod">
                  {connectionMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Command</span>
                <input defaultValue="codex" name="command" placeholder="codex" type="text" />
              </label>

              <label className="field">
                <span>API key env</span>
                <input name="apiKeyEnv" placeholder="OPENAI_API_KEY" type="text" />
              </label>

              <label className="field">
                <span>OAuth provider</span>
                <input name="oauthProvider" placeholder="openai" type="text" />
              </label>

              <label className="field">
                <span>Base URL</span>
                <input name="baseUrl" placeholder="http://127.0.0.1:11434" type="text" />
              </label>

              <label className="field">
                <span>Cheap model</span>
                <input defaultValue="gpt-5-codex" name="cheapModel" placeholder="gpt-5-codex" type="text" />
              </label>

              <label className="field">
                <span>Strong model</span>
                <input defaultValue="gpt-5-codex" name="strongModel" placeholder="gpt-5-codex" type="text" />
              </label>

              <label className="field">
                <span>Local model</span>
                <input name="localModel" placeholder="llama3.1:latest" type="text" />
              </label>
            </div>

            <button type="submit">Save provider setup</button>
          </form>
        </article>
      </section>
    </main>
  );
}
