import {
  disconnectProviderOauthAction,
  startProviderOauthAction,
  updateBranchPolicyAction,
  updateContextSettingsAction,
  updateProviderAction
} from "../actions";
import { getConfig, getContext, getGitHubStatus, getProviders, getStatus } from "../../lib/opentop-api";

export const dynamic = "force-dynamic";

const policies = ["new", "reuse-current", "manual", "none"] as const;
const providerTypes = [
  "codex-cli",
  "openai-codex",
  "openai-api",
  "deepseek-api",
  "openrouter-api",
  "anthropic-api",
  "custom-shell",
  "ollama"
] as const;
const connectionMethods = ["local_cli", "api_key", "oauth", "custom_command", "local_model"] as const;
const profileModes = ["project-first", "profile-first", "project-only", "profile-only", "manual"] as const;

interface SettingsPageProps {
  searchParams?: Promise<{
    oauth?: string;
    provider?: string;
    message?: string;
  }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = (await searchParams) ?? {};
  const [config, context, status, providerResponse, githubStatus] = await Promise.all([
    getConfig(),
    getContext(),
    getStatus(),
    getProviders(),
    getGitHubStatus()
  ]);
  const readyProviders = providerResponse.providers.filter((provider) => provider.status === "ready").length;
  const providerAttentionCount = providerResponse.providers.length - readyProviders;
  const githubReady = githubStatus.auth.status === "connected" && githubStatus.repository !== null;
  const oauthNotice =
    params.oauth === "connected"
      ? { tone: "success", text: `Provider "${params.provider ?? ""}" connected successfully.` }
      : params.oauth === "disconnected"
        ? { tone: "info", text: `Provider "${params.provider ?? ""}" was disconnected.` }
        : params.oauth === "error"
          ? { tone: "error", text: params.message ?? "OAuth connection failed." }
          : null;

  return (
    <main className="detail-shell">
        <header className="detail-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Workspace Settings</h1>
            <p className="subline">
              Configure your runtime, branch behavior, and project context for {status.project}.
            </p>
          </div>
        </header>

      {oauthNotice ? <p className={`notice notice-${oauthNotice.tone}`}>{oauthNotice.text}</p> : null}

      <section className="summary-strip summary-strip-compact" aria-label="Settings summary">
        <article className="summary-card">
          <span className="summary-label">Effective Branch Policy</span>
          <strong className="summary-value summary-value-tight">
            {config.execution.defaultBranchPolicy.effective ?? "(not set)"}
          </strong>
          <p className="summary-copy">How OpenTop chooses or reuses a branch when a new execution starts.</p>
        </article>
        <article className="summary-card">
          <span className="summary-label">Context Mode</span>
          <strong className="summary-value summary-value-tight">{context.context.effective.profileMode}</strong>
          <p className="summary-copy">
            {context.context.activeProfiles.length} active profile{context.context.activeProfiles.length === 1 ? "" : "s"} layered into prompts.
          </p>
        </article>
        <article className="summary-card">
          <span className="summary-label">Provider Health</span>
          <strong className="summary-value summary-value-tight">
            {readyProviders}/{providerResponse.providers.length}
          </strong>
          <p className="summary-copy">
            {providerAttentionCount > 0
              ? `${providerAttentionCount} provider${providerAttentionCount === 1 ? "" : "s"} still need attention.`
              : "All configured providers are ready to use."}
          </p>
        </article>
        <article className="summary-card">
          <span className="summary-label">GitHub Handoff</span>
          <strong className="summary-value summary-value-tight">{githubReady ? "connected" : "attention"}</strong>
          <p className="summary-copy">
            {githubStatus.repository
              ? `${githubStatus.repository.repositoryFullName} · ${githubStatus.auth.login ?? githubStatus.auth.method}`
              : "No GitHub repository remote detected yet."}
          </p>
        </article>
      </section>

      <section className="settings-top-grid">
        <div className="settings-main-column">
          <article className="panel panel-full">
            <h2>GitHub Connection</h2>
            <p className="subline">
              OpenTop uses this GitHub connection to create draft pull requests, read live PR state, and move drafts to ready-for-review without leaving the product.
            </p>

            <dl className="stacked-meta">
              <div>
                <dt>Repository</dt>
                <dd>{githubStatus.repository ? githubStatus.repository.repositoryFullName : "(no GitHub origin remote detected)"}</dd>
              </div>
              <div>
                <dt>Remote URL</dt>
                <dd>{githubStatus.repository?.url ?? "(none)"}</dd>
              </div>
              <div>
                <dt>Auth status</dt>
                <dd className={githubStatus.auth.status === "connected" ? "tone-good" : "tone-danger"}>
                  {githubStatus.auth.label}
                </dd>
              </div>
              <div>
                <dt>Auth source</dt>
                <dd>{githubStatus.auth.source}</dd>
              </div>
              <div>
                <dt>Scopes</dt>
                <dd>{githubStatus.auth.scopes.length > 0 ? githubStatus.auth.scopes.join(", ") : "(unknown or not available)"}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>
                  {[
                    githubStatus.capabilities.canCreateDraftPullRequests ? "create draft PRs" : "",
                    githubStatus.capabilities.canReadPullRequests ? "read PR state" : "",
                    githubStatus.capabilities.canMarkReadyForReview ? "mark ready for review" : ""
                  ]
                    .filter(Boolean)
                    .join(", ") || "(none)"}
                </dd>
              </div>
            </dl>

            <div className="provider-issues">
              {githubStatus.issues.length === 0 ? (
                <p className="notice notice-success">GitHub looks ready for OpenTop handoff work.</p>
              ) : (
                githubStatus.issues.map((issue, issueIndex) => (
                  <p className="notice notice-warning" key={`github-issue-${issueIndex}`}>
                    <strong>warning</strong> · {issue}
                  </p>
                ))
              )}
            </div>
          </article>

          <article className="panel panel-full">
            <h2>Provider Setup</h2>
            <p className="subline">
              Add or adjust provider routing without editing YAML by hand.
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
                  <span>Cheap model</span>
                  <input defaultValue="gpt-5.4-mini" name="cheapModel" placeholder="gpt-5.4-mini" type="text" />
                </label>

                <label className="field">
                  <span>Strong model</span>
                  <input defaultValue="gpt-5.5" name="strongModel" placeholder="gpt-5.5" type="text" />
                </label>

              </div>

              <details className="disclosure">
                <summary>Show connection details</summary>
                <div className="disclosure-body">
                  <div className="field-grid">
                    <label className="field">
                      <span>API key env</span>
                      <input name="apiKeyEnv" placeholder="OPENAI_API_KEY" type="text" />
                    </label>

                    <label className="field">
                      <span>OAuth provider</span>
                      <input name="oauthProvider" placeholder="openrouter or openai-codex" type="text" />
                    </label>

                    <label className="field">
                      <span>Base URL</span>
                      <input name="baseUrl" placeholder="http://127.0.0.1:11434" type="text" />
                    </label>

                    <label className="field">
                      <span>Local model</span>
                      <input name="localModel" placeholder="llama3.1:latest" type="text" />
                    </label>
                  </div>
                  <p className="subline">
                    `codex-cli` currently uses `local_cli`. OpenRouter OAuth is implemented for hosted API access.
                    `openai-codex` can connect a ChatGPT/Codex account for inspection and future native integration, but
                    OpenTop does not currently support it as an execution runtime; use `codex-cli` for subscription access
                    or `openai-api` with an API key.
                  </p>
                </div>
              </details>

              <button type="submit">Save provider setup</button>
            </form>
          </article>
        </div>

        <aside className="settings-side-column">
          <article className="panel">
          <h2>Branch Defaults</h2>
          <p className="subline">These values decide whether executions create a branch, reuse the current one, or wait for a manual choice.</p>
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
          <p className="subline">Project policy lives with the repository and is usually the best place to define the team default.</p>
          <div className="policy-grid">
            {policies.map((policy) => (
              <form action={updateBranchPolicyAction} key={`project-${policy}`}>
                <input name="scope" type="hidden" value="project" />
                <input name="value" type="hidden" value={policy} />
              <button className="policy-button" type="submit">{policy}</button>
            </form>
          ))}
          </div>
        </article>

        <article className="panel">
          <h2>Set User Policy</h2>
          <p className="subline">User policy is your personal fallback when the project does not define one.</p>
          <div className="policy-grid">
            {policies.map((policy) => (
              <form action={updateBranchPolicyAction} key={`user-${policy}`}>
                <input name="scope" type="hidden" value="user" />
                <input name="value" type="hidden" value={policy} />
              <button className="policy-button" type="submit">{policy}</button>
            </form>
          ))}
          </div>
        </article>

          <article className="panel">
            <h2>Context Summary</h2>
            <dl className="stacked-meta">
              <div>
                <dt>Profile mode</dt>
                <dd>{context.context.effective.profileMode}</dd>
              </div>
              <div>
                <dt>Loaded profiles</dt>
                <dd>{context.context.activeProfiles.length === 0 ? "(none)" : context.context.activeProfiles.length}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>
                  {context.context.effective.maxProfileSections} sections / {context.context.effective.maxPromptProfileWords} words
                </dd>
              </div>
            </dl>
          </article>
        </aside>
      </section>

      <section className="detail-grid">

        <article className="panel panel-span-2">
          <h2>Runtime Health</h2>
          <p className="subline">
            Check provider commands, routed model tiers, connection state, and common compatibility risks before you start work.
          </p>

          <div className="provider-list">
            {providerResponse.providers.map((provider) => (
              <details className="provider-row" key={provider.providerId}>
                <summary className="provider-row-summary">
                  <div>
                    <strong>{provider.providerId}</strong>
                    <p className="provider-type">
                      {provider.type}
                      {provider.version ? ` · ${provider.version}` : ""}
                    </p>
                  </div>
                  <div className="provider-row-meta">
                    <span>
                      {provider.modelTiers.length === 0
                        ? "No routed model tiers"
                        : provider.modelTiers.map((modelTier) => `${modelTier.tier} → ${modelTier.model}`).join(" · ")}
                    </span>
                    <span className={`provider-badge provider-${provider.status}`}>{provider.status}</span>
                  </div>
                </summary>

                <div className="provider-row-body">
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
                      <dt>Connection state</dt>
                      <dd>{provider.connectionState.label}</dd>
                    </div>
                    <div>
                      <dt>Capabilities</dt>
                      <dd>
                        {[
                          ...provider.capabilities.authMethods,
                          provider.capabilities.supportsStructuredOutput ? "structured" : "",
                          provider.capabilities.supportsLocalWorkspace ? "workspace" : "",
                          provider.capabilities.supportsMultiRunOrchestration ? "multi-run" : ""
                        ]
                          .filter(Boolean)
                          .join(", ") || "(none)"}
                      </dd>
                    </div>
                  </dl>

                  <div className="provider-issues">
                    {provider.issues.length === 0 ? (
                      <p className="notice notice-success">No provider issues detected.</p>
                    ) : (
                      provider.issues.map((issue, issueIndex) => (
                        <p
                          className={`notice notice-${issue.severity}`}
                          key={`${provider.providerId}-${issue.code}-${issueIndex}`}
                        >
                          <strong>{issue.severity}</strong> · {issue.message}
                        </p>
                      ))
                    )}
                  </div>

                  {provider.connectionMethod === "oauth" ? (
                    <div className="button-stack">
                      <p className="subline">
                        {provider.connectionState.connectedAt
                          ? `Connected at ${provider.connectionState.connectedAt}`
                          : provider.connectionState.lastError ?? "Connect this provider from OpenTop without writing secrets into project config."}
                      </p>
                      {provider.connectionState.status !== "connected" ? (
                        <form action={startProviderOauthAction}>
                          <input name="providerId" type="hidden" value={provider.providerId} />
                          <button disabled={!provider.connectionState.supported} type="submit">
                            Connect provider
                          </button>
                        </form>
                      ) : null}
                      {provider.connectionState.status === "connected" ? (
                        <form action={disconnectProviderOauthAction}>
                          <input name="providerId" type="hidden" value={provider.providerId} />
                          <button type="submit">Disconnect provider</button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </article>

        <article className="panel panel-span-2">
          <h2>Context Profiles</h2>
          <p className="subline">
            Active prompt context is layered on top of the project and memory. Project rules still win when they
            conflict with profile preferences.
          </p>

          <dl className="stacked-meta">
            <div>
              <dt>Profile mode</dt>
              <dd>{context.context.effective.profileMode}</dd>
            </div>
            <div>
              <dt>Learned profiles</dt>
              <dd>{context.context.effective.learnedProfiles.join(", ") || "(none)"}</dd>
            </div>
            <div>
              <dt>User profiles</dt>
              <dd>{context.context.effective.userProfiles.join(", ") || "(none)"}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>
                {context.context.effective.maxProfileSections} sections / {context.context.effective.maxPromptProfileWords} words
              </dd>
            </div>
            <div>
              <dt>Loaded profiles</dt>
              <dd>
                {context.context.activeProfiles.length === 0
                  ? "(none)"
                  : context.context.activeProfiles
                      .map((profile) => `${profile.displayName} (${profile.type})`)
                      .join(", ")}
              </dd>
            </div>
            <div>
              <dt>Available profiles</dt>
              <dd>
                {context.context.availableProfiles.length === 0
                  ? "(none found under ~/.opentop)"
                  : context.context.availableProfiles
                      .map((profile) => `${profile.displayName} (${profile.id})`)
                      .join(", ")}
              </dd>
            </div>
          </dl>

          <details className="disclosure">
            <summary>Edit context rules</summary>
            <div className="disclosure-body">
          <form action={updateContextSettingsAction} className="stack-form provider-form">
            <div className="field-grid">
              <label className="field">
                <span>Scope</span>
                <select defaultValue="project" name="scope">
                  <option value="project">project</option>
                  <option value="user">user</option>
                </select>
              </label>

              <label className="field">
                <span>Profile mode</span>
                <select defaultValue={context.context.effective.profileMode} name="profileMode">
                  {profileModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Learned profiles</span>
                <input
                  defaultValue={context.context.effective.learnedProfiles.join(", ")}
                  name="learnedProfiles"
                  placeholder="fmwerkstatt"
                  type="text"
                />
              </label>

              <label className="field">
                <span>User profiles</span>
                <input
                  defaultValue={context.context.effective.userProfiles.join(", ")}
                  name="userProfiles"
                  placeholder="ronny"
                  type="text"
                />
              </label>

              <label className="field">
                <span>Max profile words</span>
                <input
                  defaultValue={String(context.context.effective.maxPromptProfileWords)}
                  min="100"
                  name="maxPromptProfileWords"
                  step="50"
                  type="number"
                />
              </label>

              <label className="field">
                <span>Max profile sections</span>
                <input
                  defaultValue={String(context.context.effective.maxProfileSections)}
                  min="1"
                  name="maxProfileSections"
                  step="1"
                  type="number"
                />
              </label>
            </div>

            <button type="submit">Save context settings</button>
          </form>
            </div>
          </details>
        </article>
      </section>
    </main>
  );
}
