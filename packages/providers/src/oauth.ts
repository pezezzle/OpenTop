import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProviderConnectionState } from "./types.js";
import type { ProviderDefinition } from "./factory.js";

export type SupportedOauthProvider = "openrouter" | "openai-codex";

const OPENAI_CODEX_DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_OAUTH_SCOPE = "openid profile email offline_access";
const OPENAI_CODEX_DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_CODEX_ORIGINATOR = "codex_vscode";

interface StoredOauthConnection {
  version: 1;
  repositoryPath: string;
  repositoryKey: string;
  providerId: string;
  providerType: string;
  oauthProvider: SupportedOauthProvider;
  tokenType: "api_key" | "bearer";
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

interface PendingOauthSession {
  version: 1;
  id: string;
  repositoryPath: string;
  providerId: string;
  providerType: string;
  oauthProvider: SupportedOauthProvider;
  callbackUrl: string;
  completionUrl: string;
  codeVerifier: string;
  codeChallengeMethod: "S256";
  createdAt: string;
}

export interface OauthSupportResult {
  supported: boolean;
  provider?: SupportedOauthProvider;
  configuredProvider: string;
  reason?: string;
}

export interface StartOauthFlowOptions {
  providerId: string;
  definition: ProviderDefinition;
  repositoryPath: string;
  webBaseUrl?: string;
}

export interface StartOauthFlowResult {
  authorizationUrl: string;
  callbackUrl: string;
  sessionId: string;
  provider: SupportedOauthProvider;
}

export interface CompleteOauthFlowOptions {
  providerId: string;
  sessionId: string;
  code: string;
}

let openAiCodexCallbackServer: Promise<Server> | null = null;

export async function startOauthFlow(options: StartOauthFlowOptions): Promise<StartOauthFlowResult> {
  const support = getOauthSupport(options.definition);

  if (!support.supported || !support.provider) {
    throw new Error(support.reason ?? `Provider "${options.providerId}" does not support OAuth.`);
  }

  const sessionId = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = createCodeChallenge(codeVerifier);
  const completionUrl = buildCompletionUrl(options.webBaseUrl, sessionId, options.providerId);
  const callbackUrl = support.provider === "openai-codex" ? openAiCodexRedirectUri() : completionUrl;
  const createdAt = new Date().toISOString();
  const session: PendingOauthSession = {
    version: 1,
    id: sessionId,
    repositoryPath: normalizeRepositoryPath(options.repositoryPath),
    providerId: options.providerId,
    providerType: options.definition.type,
    oauthProvider: support.provider,
    callbackUrl,
    completionUrl,
    codeVerifier,
    codeChallengeMethod: "S256",
    createdAt
  };

  await savePendingOauthSession(session);

  if (support.provider === "openrouter") {
    const authorizationUrl = new URL("https://openrouter.ai/auth");
    authorizationUrl.searchParams.set("callback_url", callbackUrl);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return {
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl,
      sessionId,
      provider: support.provider
    };
  }

  if (support.provider === "openai-codex") {
    await ensureOpenAiCodexCallbackServer();
    const authorizationUrl = new URL("https://auth.openai.com/oauth/authorize");
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", openAiCodexClientId());
    authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizationUrl.searchParams.set("scope", OPENAI_CODEX_OAUTH_SCOPE);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", sessionId);
    authorizationUrl.searchParams.set("id_token_add_organizations", "true");
    authorizationUrl.searchParams.set("codex_cli_simplified_flow", "true");
    authorizationUrl.searchParams.set("originator", OPENAI_CODEX_ORIGINATOR);

    return {
      authorizationUrl: authorizationUrl.toString(),
      callbackUrl,
      sessionId,
      provider: support.provider
    };
  }

  throw new Error(`OAuth provider "${support.provider}" is not supported yet.`);
}

export async function completeOauthFlow(options: CompleteOauthFlowOptions): Promise<StoredOauthConnection> {
  const session = await loadPendingOauthSession(options.sessionId);

  if (!session) {
    throw new Error("OAuth session was not found or has already been completed.");
  }

  if (session.providerId !== options.providerId) {
    throw new Error("OAuth session does not match the requested provider.");
  }

  try {
    if (session.oauthProvider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: options.code,
          code_verifier: session.codeVerifier,
          code_challenge_method: session.codeChallengeMethod
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { key?: string; error?: { message?: string } };

      if (!response.ok || !payload.key) {
        throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
      }

      const now = new Date().toISOString();
      const connection: StoredOauthConnection = {
        version: 1,
        repositoryPath: session.repositoryPath,
        repositoryKey: repositoryKeyForPath(session.repositoryPath),
        providerId: session.providerId,
        providerType: session.providerType,
        oauthProvider: session.oauthProvider,
        tokenType: "api_key",
        accessToken: payload.key,
        createdAt: now,
        updatedAt: now
      };

      await saveOauthConnection(connection);
      await deletePendingOauthSession(session.id);
      return connection;
    }

    if (session.oauthProvider === "openai-codex") {
      const response = await fetch("https://auth.openai.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: openAiCodexClientId(),
          code: options.code,
          redirect_uri: session.callbackUrl,
          code_verifier: session.codeVerifier
        }).toString()
      });
      const payload = (await response.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
        expires_in?: number;
        id_token?: string;
        error?: string | { message?: string; code?: string };
        error_description?: string;
      };

      if (!response.ok || !payload.access_token) {
        throw new Error(extractOauthErrorMessage(payload, response.status, response.statusText));
      }

      const now = new Date();
      const expiresAt =
        typeof payload.expires_in === "number" && payload.expires_in > 0
          ? new Date(now.getTime() + payload.expires_in * 1000).toISOString()
          : undefined;
      const accountId =
        readJwtStringClaim(payload.id_token, "sub") ??
        readJwtStringClaim(payload.access_token, "sub");

      const connection: StoredOauthConnection = {
        version: 1,
        repositoryPath: session.repositoryPath,
        repositoryKey: repositoryKeyForPath(session.repositoryPath),
        providerId: session.providerId,
        providerType: session.providerType,
        oauthProvider: session.oauthProvider,
        tokenType: "bearer",
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        accountId: accountId ?? undefined,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt
      };

      await saveOauthConnection(connection);
      await deletePendingOauthSession(session.id);
      return connection;
    }

    throw new Error(`OAuth provider "${session.oauthProvider}" is not supported yet.`);
  } catch (error) {
    await deletePendingOauthSession(session.id);
    throw error;
  }
}

export async function disconnectOauthConnection(providerId: string, repositoryPath: string): Promise<void> {
  await rm(connectionPathFor(providerId, repositoryPath), { force: true });
}

export async function cancelOauthFlow(sessionId: string): Promise<void> {
  await deletePendingOauthSession(sessionId);
}

export async function loadOauthAccessToken(providerId: string, repositoryPath: string): Promise<string | undefined> {
  const connection = await loadOauthConnection(providerId, repositoryPath);

  if (!connection) {
    return undefined;
  }

  if (connection.expiresAt && new Date(connection.expiresAt).getTime() <= Date.now()) {
    return undefined;
  }

  return connection.accessToken;
}

export async function inspectOauthConnection(
  providerId: string,
  definition: ProviderDefinition,
  repositoryPath: string
): Promise<ProviderConnectionState> {
  const support = getOauthSupport(definition);

  if (!support.supported || !support.provider) {
    return {
      status: "unsupported",
      supported: false,
      label: support.reason ?? "OAuth is not supported for this provider.",
      repositoryScoped: true,
      supportsRefresh: false,
      supportsDisconnect: false,
      lastError: support.reason
    };
  }

  const connection = await loadOauthConnection(providerId, repositoryPath);

  if (!connection) {
    return {
      status: "disconnected",
      supported: true,
      label: `${support.provider} is ready to connect.`,
      repositoryScoped: true,
      supportsRefresh: false,
      supportsDisconnect: true
    };
  }

  if (connection.expiresAt && new Date(connection.expiresAt).getTime() <= Date.now()) {
    return {
      status: "expired",
      supported: true,
      label: `${support.provider} connection expired.`,
      repositoryScoped: true,
      supportsRefresh: false,
      supportsDisconnect: true,
      connectedAt: connection.createdAt,
      expiresAt: connection.expiresAt,
      lastError: "Stored OAuth credentials are expired and need to be reconnected."
    };
  }

  return {
    status: "connected",
    supported: true,
    label: `${support.provider} connected.`,
    repositoryScoped: true,
    supportsRefresh: false,
    supportsDisconnect: true,
    connectedAt: connection.createdAt,
    expiresAt: connection.expiresAt
  };
}

export function getOauthSupport(definition: ProviderDefinition): OauthSupportResult {
  const configuredProvider = resolveOauthProviderName(definition);

  if (!configuredProvider) {
    return {
      supported: false,
      configuredProvider: "(not set)",
      reason: `Provider type "${definition.type}" is configured for OAuth, but no oauthProvider is set.`
    };
  }

  if (definition.type === "openrouter-api" && configuredProvider === "openrouter") {
    return {
      supported: true,
      provider: "openrouter",
      configuredProvider
    };
  }

  if (definition.type === "openai-codex" && configuredProvider === "openai-codex") {
    return {
      supported: true,
      provider: "openai-codex",
      configuredProvider
    };
  }

  if (configuredProvider === "openrouter" && definition.type !== "openrouter-api") {
    return {
      supported: false,
      configuredProvider,
      reason: `oauthProvider "${configuredProvider}" currently requires provider type "openrouter-api".`
    };
  }

  if (configuredProvider === "openai-codex" && definition.type !== "openai-codex") {
    return {
      supported: false,
      configuredProvider,
      reason: `oauthProvider "${configuredProvider}" currently requires provider type "openai-codex".`
    };
  }

  return {
    supported: false,
    configuredProvider,
    reason: `oauthProvider "${configuredProvider}" is not implemented for provider type "${definition.type}" yet.`
  };
}

export function resolveOauthProviderName(definition: ProviderDefinition): string {
  const configured = definition.oauthProvider ?? definition.connection.oauthProvider;

  if (configured && configured.trim().length > 0) {
    return configured.trim().toLowerCase();
  }

  if (definition.type === "openrouter-api") {
    return "openrouter";
  }

  if (definition.type === "openai-codex") {
    return "openai-codex";
  }

  return "";
}

function buildCompletionUrl(webBaseUrl: string | undefined, sessionId: string, providerId: string): string {
  const callback = new URL("/settings/oauth/callback", trimTrailingSlash(webBaseUrl ?? "http://127.0.0.1:3000"));
  callback.searchParams.set("session", sessionId);
  callback.searchParams.set("providerId", providerId);
  return callback.toString();
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function repositoryKeyForPath(repositoryPath: string): string {
  return createHash("sha256").update(normalizeRepositoryPath(repositoryPath)).digest("hex").slice(0, 16);
}

function normalizeRepositoryPath(repositoryPath: string): string {
  return resolve(repositoryPath);
}

async function loadOauthConnection(providerId: string, repositoryPath: string): Promise<StoredOauthConnection | null> {
  return readJsonFile<StoredOauthConnection>(connectionPathFor(providerId, repositoryPath));
}

async function saveOauthConnection(connection: StoredOauthConnection): Promise<void> {
  const path = connectionPathFor(connection.providerId, connection.repositoryPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(connection, null, 2)}\n`, "utf8");
}

async function savePendingOauthSession(session: PendingOauthSession): Promise<void> {
  const path = sessionPathFor(session.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

async function loadPendingOauthSession(sessionId: string): Promise<PendingOauthSession | null> {
  return readJsonFile<PendingOauthSession>(sessionPathFor(sessionId));
}

async function deletePendingOauthSession(sessionId: string): Promise<void> {
  await rm(sessionPathFor(sessionId), { force: true });
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function connectionPathFor(providerId: string, repositoryPath: string): string {
  return join(userAuthDirectory(), "connections", repositoryKeyForPath(repositoryPath), `${providerId}.json`);
}

function sessionPathFor(sessionId: string): string {
  return join(userAuthDirectory(), "sessions", `${sessionId}.json`);
}

function userAuthDirectory(): string {
  return join(homedir(), ".opentop", "auth");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function openAiCodexClientId(): string {
  return process.env.OPENAI_CODEX_OAUTH_CLIENT_ID?.trim() || OPENAI_CODEX_DEFAULT_CLIENT_ID;
}

function openAiCodexRedirectUri(): string {
  return process.env.OPENAI_CODEX_OAUTH_REDIRECT_URI?.trim() || OPENAI_CODEX_DEFAULT_REDIRECT_URI;
}

function extractOauthErrorMessage(
  payload: { error?: string | { message?: string; code?: string }; error_description?: string },
  status: number,
  statusText: string
): string {
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error_description
      ? `${payload.error}: ${payload.error_description}`
      : payload.error;
  }

  if (payload.error && typeof payload.error === "object") {
    return payload.error.message ?? payload.error.code ?? `${status} ${statusText}`;
  }

  if (payload.error_description && payload.error_description.trim().length > 0) {
    return payload.error_description;
  }

  return `${status} ${statusText}`;
}

function readJwtStringClaim(token: string | undefined, claim: string): string | undefined {
  if (!token) {
    return undefined;
  }

  const parts = token.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const value = payload[claim];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function ensureOpenAiCodexCallbackServer(): Promise<Server> {
  if (openAiCodexRedirectUri() !== OPENAI_CODEX_DEFAULT_REDIRECT_URI) {
    throw new Error(
      `OpenAI Codex OAuth currently expects redirect URI "${OPENAI_CODEX_DEFAULT_REDIRECT_URI}". Remove OPENAI_CODEX_OAUTH_REDIRECT_URI or point it back to that value.`
    );
  }

  if (openAiCodexCallbackServer) {
    return openAiCodexCallbackServer;
  }

  openAiCodexCallbackServer = new Promise<Server>((resolvePromise, rejectPromise) => {
    const server = createServer(async (request, response) => {
      try {
        if (!request.url) {
          response.statusCode = 400;
          response.end("Missing callback URL.");
          return;
        }

        const url = new URL(request.url, OPENAI_CODEX_DEFAULT_REDIRECT_URI);

        if (url.pathname !== "/auth/callback") {
          response.statusCode = 404;
          response.end("Not found.");
          return;
        }

        const sessionId = url.searchParams.get("state")?.trim() ?? "";

        if (!sessionId) {
          response.statusCode = 400;
          response.end("Missing OAuth state.");
          return;
        }

        const session = await loadPendingOauthSession(sessionId);

        if (!session) {
          response.statusCode = 410;
          response.end("OAuth session not found.");
          return;
        }

        const redirectUrl = new URL(session.completionUrl);
        const code = url.searchParams.get("code")?.trim();
        const error = url.searchParams.get("error")?.trim();
        const errorDescription = url.searchParams.get("error_description")?.trim();

        if (code) {
          redirectUrl.searchParams.set("code", code);
        }

        if (error) {
          redirectUrl.searchParams.set("error", error);
        }

        if (errorDescription) {
          redirectUrl.searchParams.set("error_description", errorDescription);
        }

        response.statusCode = 302;
        response.setHeader("Location", redirectUrl.toString());
        response.end();
      } catch (error) {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "OAuth callback failed.");
      }
    });

    server.once("error", (error) => {
      openAiCodexCallbackServer = null;
      rejectPromise(
        new Error(
          `Could not start the local OpenAI Codex callback server on ${OPENAI_CODEX_DEFAULT_REDIRECT_URI}. ${
            error instanceof Error ? error.message : "Unknown error."
          }`
        )
      );
    });

    server.listen(1455, "127.0.0.1", () => {
      server.unref();
      resolvePromise(server);
    });
  });

  return openAiCodexCallbackServer;
}
