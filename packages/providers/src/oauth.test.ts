import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  completeOauthFlow,
  disconnectOauthConnection,
  inspectOauthConnection,
  startOauthFlow
} from "./oauth.js";
import { inspectProviderRuntime } from "./inspect.js";
import { createProviderAdapter } from "./factory.js";

const openRouterDefinition = {
  type: "openrouter-api",
  connection: {
    method: "oauth",
    oauthProvider: "openrouter"
  }
} as const;

const openAiCodexDefinition = {
  type: "openai-codex",
  connection: {
    method: "oauth",
    oauthProvider: "openai-codex"
  }
} as const;

test("startOauthFlow creates a connectable OpenRouter authorization URL", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const repositoryPath = join(home, "repo");
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    const result = await startOauthFlow({
      providerId: "openrouter",
      definition: openRouterDefinition,
      repositoryPath
    });

    assert.equal(result.provider, "openrouter");
    assert.match(result.authorizationUrl, /^https:\/\/openrouter\.ai\/auth\?/u);
    assert.match(result.callbackUrl, /^http:\/\/127\.0\.0\.1:3000\/settings\/oauth\/callback/u);
    assert.ok(result.sessionId.length > 10);

    const connectionState = await inspectOauthConnection("openrouter", openRouterDefinition, repositoryPath);
    assert.equal(connectionState.status, "disconnected");
    assert.equal(connectionState.supported, true);
  } finally {
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("completeOauthFlow stores a repository-scoped OpenRouter credential", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const repositoryPath = join(home, "repo");
  const previousHome = process.env.HOME;
  const previousFetch = globalThis.fetch;

  process.env.HOME = home;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        key: "or-user-key"
      })
    })) as unknown as typeof fetch;

  try {
    const started = await startOauthFlow({
      providerId: "openrouter",
      definition: openRouterDefinition,
      repositoryPath
    });

    const connection = await completeOauthFlow({
      providerId: "openrouter",
      sessionId: started.sessionId,
      code: "auth-code-123"
    });

    assert.equal(connection.accessToken, "or-user-key");
    assert.equal(connection.oauthProvider, "openrouter");

    const inspection = await inspectProviderRuntime("openrouter", openRouterDefinition, [], {
      repositoryPath
    });
    assert.equal(inspection.available, true);
    assert.equal(inspection.connectionState?.status, "connected");

    await disconnectOauthConnection("openrouter", repositoryPath);

    const disconnected = await inspectOauthConnection("openrouter", openRouterDefinition, repositoryPath);
    assert.equal(disconnected.status, "disconnected");
  } finally {
    globalThis.fetch = previousFetch;
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("startOauthFlow creates an OpenAI Codex authorization URL", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const repositoryPath = join(home, "repo");
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    const result = await startOauthFlow({
      providerId: "openaiCodex",
      definition: openAiCodexDefinition,
      repositoryPath
    });

    const authorizationUrl = new URL(result.authorizationUrl);

    assert.equal(result.provider, "openai-codex");
    assert.equal(authorizationUrl.origin, "https://auth.openai.com");
    assert.equal(authorizationUrl.pathname, "/oauth/authorize");
    assert.equal(authorizationUrl.searchParams.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
    assert.equal(authorizationUrl.searchParams.get("scope"), "openid profile email offline_access");
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "http://localhost:1455/auth/callback");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("codex_cli_simplified_flow"), "true");
    assert.equal(authorizationUrl.searchParams.get("originator"), "codex_vscode");

    const connectionState = await inspectOauthConnection("openaiCodex", openAiCodexDefinition, repositoryPath);
    assert.equal(connectionState.status, "disconnected");
    assert.equal(connectionState.supported, true);
  } finally {
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("completeOauthFlow stores a repository-scoped OpenAI Codex credential and reports connect-only runtime status", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const repositoryPath = join(home, "repo");
  const previousHome = process.env.HOME;
  const previousFetch = globalThis.fetch;

  process.env.HOME = home;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: createJwt({ sub: "acct_123" }),
        refresh_token: "refresh-token-456",
        token_type: "bearer",
        expires_in: 3600,
        id_token: createJwt({ sub: "acct_123", email: "ronny@example.com" })
      })
    })) as unknown as typeof fetch;

  try {
    const started = await startOauthFlow({
      providerId: "openaiCodex",
      definition: openAiCodexDefinition,
      repositoryPath
    });

    const connection = await completeOauthFlow({
      providerId: "openaiCodex",
      sessionId: started.sessionId,
      code: "auth-code-456"
    });

    assert.equal(connection.oauthProvider, "openai-codex");
    assert.equal(connection.tokenType, "bearer");
    assert.equal(connection.refreshToken, "refresh-token-456");
    assert.equal(connection.accountId, "acct_123");
    assert.ok(connection.expiresAt);

    const inspection = await inspectProviderRuntime("openaiCodex", openAiCodexDefinition, [], {
      repositoryPath
    });
    assert.equal(inspection.available, false);
    assert.equal(inspection.connectionState?.status, "connected");
    assert.equal(inspection.issues.some((issue) => issue.code === "runtime_disabled"), true);

    await disconnectOauthConnection("openaiCodex", repositoryPath);

    const disconnected = await inspectOauthConnection("openaiCodex", openAiCodexDefinition, repositoryPath);
    assert.equal(disconnected.status, "disconnected");
  } finally {
    globalThis.fetch = previousFetch;
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("createProviderAdapter rejects openai-codex runtime use after OAuth connect", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const repositoryPath = join(home, "repo");
  const previousHome = process.env.HOME;
  const previousFetch = globalThis.fetch;
  let callIndex = 0;

  process.env.HOME = home;
  globalThis.fetch = (async () => {
    callIndex += 1;

    if (callIndex === 1) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          access_token: createJwt({ sub: "acct_123" }),
          refresh_token: "refresh-token-456",
          token_type: "bearer",
          expires_in: 3600,
          id_token: createJwt({ sub: "acct_123" })
        })
      } as unknown as Response;
    }

    return {
      ok: false,
      status: 500,
      statusText: "Unexpected call",
      json: async () => ({})
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const started = await startOauthFlow({
      providerId: "openaiCodex",
      definition: openAiCodexDefinition,
      repositoryPath
    });

    await completeOauthFlow({
      providerId: "openaiCodex",
      sessionId: started.sessionId,
      code: "auth-code-789"
    });

    await assert.rejects(
      () =>
        createProviderAdapter("openaiCodex", openAiCodexDefinition, {
          repositoryPath
        }),
      /does not support it as an execution runtime yet/u
    );
    assert.equal(callIndex, 1);
  } finally {
    globalThis.fetch = previousFetch;
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("inspectProviderRuntime reports unsupported OAuth providers honestly", async () => {
  const home = await mkdtemp(join(tmpdir(), "opentop-oauth-home-"));
  const previousHome = process.env.HOME;

  process.env.HOME = home;

  try {
    const inspection = await inspectProviderRuntime(
      "anthropic",
      {
        type: "anthropic-api",
        connection: {
          method: "oauth",
          oauthProvider: "anthropic"
        }
      },
      [],
      {
        repositoryPath: join(home, "repo")
      }
    );

    assert.equal(inspection.available, false);
    assert.equal(inspection.connectionState?.status, "unsupported");
    assert.equal(inspection.issues.some((issue) => issue.code === "oauth_unsupported"), true);
  } finally {
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}
