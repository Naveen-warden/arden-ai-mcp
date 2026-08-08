import { serve } from "@hono/node-server";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import {
  runWithArdenSession,
  type ArdenSession,
} from "./auth/arden-session-context";
import { mastra } from "./mastra/index";
import { validateArdenSession } from "./rest";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
const port = 4112;
const BASE_URL = "http://127.0.0.1:4112";
const MCP_SERVER = "http://127.0.0.1:4112/api/mcp/arden-codebase/mcp";
const REQUIRED_SCOPE = "arden:read";
const TOKEN_TTL_SECONDS = 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;

type NodeError = Error & { code?: string };

function isClosedResponseStreamError(error: unknown): error is NodeError {
  return (
    error instanceof Error &&
    (error as NodeError).code === "ERR_INVALID_STATE" &&
    error.message.includes("Controller is already closed")
  );
}

process.on("uncaughtException", (error) => {
  if (isClosedResponseStreamError(error)) {
    console.warn("Ignored closed HTTP response stream from Hono node adapter");
    return;
  }

  console.error(error);
  process.exit(1);
});

type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: string;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  expiresAt: number;
  ardenSession: ArdenSession;
};

type AccessToken = {
  clientId: string;
  scope: string;
  expiresAt: number;
  ardenSession: ArdenSession;
};

const clients = new Map<string, OAuthClient>();
const authorizationCodes = new Map<string, AuthorizationCode>();
const accessTokens = new Map<string, AccessToken>();

function getBodyValue(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }

  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createPkceChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function getJwtExpiresAt(token: string) {
  const [, payload] = token.split(".");

  if (!payload) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      exp?: unknown;
    };

    return typeof decoded.exp === "number" ? decoded.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function createArdenSession(accessToken: string, permissionId: string) {
  return {
    accessToken,
    ...(permissionId ? { permissionId } : {}),
    expiresAt: getJwtExpiresAt(accessToken),
    connectedAt: Date.now(),
  };
}

function getMcpTokenExpiresAt(ardenSession: ArdenSession) {
  const defaultExpiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;

  return ardenSession.expiresAt
    ? Math.min(defaultExpiresAt, ardenSession.expiresAt)
    : defaultExpiresAt;
}

app.get("/", (c) => {
  return c.text("Arden codebase MCP server");
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    mcpEndpoint: "/api/mcp/arden-codebase/mcp",
  });
});
app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json({
    resource: MCP_SERVER,
    authorization_servers: [BASE_URL],
    scopes_supported: [REQUIRED_SCOPE],
    bearer_methods_supported: ["header"],
  });
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({
    issuer: BASE_URL,
    authorization_endpoint: "http://127.0.0.1:4112/oauth/authorize",
    token_endpoint: "http://127.0.0.1:4112/oauth/token",
    registration_endpoint: "http://127.0.0.1:4112/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [REQUIRED_SCOPE],
  });
});

app.post("/oauth/register", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;

  console.log("#############################");
  console.log("registering");
  console.log({ body });
  console.log("#############################");
  const clientId = `client_${randomUUID()}`;

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter(
        (redirectUri: unknown): redirectUri is string =>
          typeof redirectUri === "string",
      )
    : [];

  if (redirectUris.length === 0) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      },
      400,
    );
  }

  const scope = typeof body.scope === "string" ? body.scope : REQUIRED_SCOPE;

  if (!scope.split(/\s+/).includes(REQUIRED_SCOPE)) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: `${REQUIRED_SCOPE} scope is required`,
      },
      400,
    );
  }

  clients.set(clientId, {
    clientId,
    clientName:
      typeof body.client_name === "string" ? body.client_name : "unknown",
    redirectUris,
    scope,
  });

  return c.json(
    {
      client_id: clientId,
      client_name:
        typeof body.client_name === "string" ? body.client_name : "unknown",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope,
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
});

app.get("/oauth/authorize", (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const responseType = c.req.query("response_type");
  const scope = c.req.query("scope") ?? "arden:read";
  const state = c.req.query("state") ?? "";
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method");

  console.log("#############################");
  console.log("authorize");
  console.log({ queries: c.req.query() });
  console.log("#############################");
  if (!clientId || !redirectUri || !codeChallenge) {
    return c.text("Missing required OAuth params", 400);
  }
  // console.log("clientId", clientId, clients);
  const client = clients.get(clientId);

  if (!client) {
    return c.text("Unknown client_id", 400);
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return c.text("Invalid redirect_uri", 400);
  }

  if (responseType !== "code") {
    return c.text("Unsupported response_type", 400);
  }

  if (!scope.split(/\s+/).includes(REQUIRED_SCOPE)) {
    return c.text("Unsupported scope", 400);
  }

  if (codeChallengeMethod !== "S256") {
    return c.text("Unsupported code_challenge_method", 400);
  }

  return c.html(`
    <!doctype html>
    <html>
      <body>
        <h1>Approve Arden MCP Access</h1>
        <p>Client: ${escapeHtml(client.clientName)}</p>
        <p>Scope: ${escapeHtml(scope)}</p>

        <form method="POST" action="/oauth/authorize/approve">
          <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
          <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
          <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
          <input type="hidden" name="state" value="${escapeHtml(state)}" />
          <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
          <label>
            Arden access token
            <textarea name="arden_access_token" rows="8" cols="80" required autocomplete="off" spellcheck="false"></textarea>
          </label>
          <br />
          <label>
            Permission ID (optional)
            <input name="arden_permission_id" type="text" autocomplete="off" />
          </label>
          <br />
          <button type="submit">Approve</button>
        </form>
      </body>
    </html>
  `);
});

app.post("/oauth/authorize/approve", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await c.req.json<Record<string, unknown>>()
    : ((await c.req.parseBody()) as Record<string, unknown>);

  const clientId = getBodyValue(body, "client_id");
  const redirectUri = getBodyValue(body, "redirect_uri");
  const scope = getBodyValue(body, "scope");
  const state = getBodyValue(body, "state");
  const codeChallenge = getBodyValue(body, "code_challenge");
  const ardenAccessToken = getBodyValue(body, "arden_access_token");
  const ardenPermissionId = getBodyValue(body, "arden_permission_id");

  console.log("#############################");
  console.log("approve");
  console.log({
    clientId,
    redirectUri,
    scope,
    hasState: Boolean(state),
    hasArdenAccessToken: Boolean(ardenAccessToken),
    hasArdenPermissionId: Boolean(ardenPermissionId),
  });
  console.log("#############################");

  const client = clients.get(clientId);

  if (!client) {
    return c.text("Unknown client_id", 400);
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return c.text("Invalid redirect_uri", 400);
  }

  if (!scope.split(/\s+/).includes(REQUIRED_SCOPE)) {
    return c.text("Unsupported scope", 400);
  }

  if (!codeChallenge) {
    return c.text("Missing code_challenge", 400);
  }

  if (!ardenAccessToken) {
    return c.text("Missing Arden access token", 400);
  }

  const ardenSession = createArdenSession(ardenAccessToken, ardenPermissionId);

  if (ardenSession.expiresAt && ardenSession.expiresAt <= Date.now()) {
    return c.text("Arden access token is expired", 400);
  }

  try {
    await validateArdenSession(ardenSession);
  } catch (error) {
    console.warn("Arden token validation failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return c.text("Arden access token validation failed", 401);
  }

  const code = `code_${randomUUID()}`;

  authorizationCodes.set(code, {
    clientId,
    redirectUri,
    scope,
    codeChallenge,
    expiresAt: Date.now() + CODE_TTL_MS,
    ardenSession,
  });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);

  if (state) {
    callbackUrl.searchParams.set("state", state);
  }

  console.log("#############################");
  console.log("approve redirect");
  console.log({ callbackUrl: callbackUrl.toString() });
  console.log("#############################");

  return c.redirect(callbackUrl.toString());
});

app.post("/oauth/token", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await c.req.json<Record<string, unknown>>()
    : ((await c.req.parseBody()) as Record<string, unknown>);

  const grantType = getBodyValue(body, "grant_type");
  const code = getBodyValue(body, "code");
  const redirectUri = getBodyValue(body, "redirect_uri");
  const clientId = getBodyValue(body, "client_id");
  const codeVerifier = getBodyValue(body, "code_verifier");

  console.log("#############################");
  console.log("token exchange");
  console.log({
    grantType,
    clientId,
    redirectUri,
    code: code ? `${code.slice(0, 12)}...` : "",
    hasCodeVerifier: Boolean(codeVerifier),
  });
  console.log("#############################");

  if (grantType !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  const authorizationCode = authorizationCodes.get(code);

  if (!authorizationCode) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  if (authorizationCode.expiresAt < Date.now()) {
    authorizationCodes.delete(code);
    return c.json({ error: "invalid_grant" }, 400);
  }

  if (
    authorizationCode.clientId !== clientId ||
    authorizationCode.redirectUri !== redirectUri
  ) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  if (!codeVerifier) {
    return c.json({ error: "invalid_request" }, 400);
  }

  if (createPkceChallenge(codeVerifier) !== authorizationCode.codeChallenge) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  authorizationCodes.delete(code);

  const accessToken = `at_${randomUUID()}`;
  const expiresAt = getMcpTokenExpiresAt(authorizationCode.ardenSession);

  accessTokens.set(accessToken, {
    clientId,
    scope: authorizationCode.scope,
    expiresAt,
    ardenSession: authorizationCode.ardenSession,
  });

  console.log("#############################");
  console.log("token issued");
  console.log({ clientId, scope: authorizationCode.scope });
  console.log("#############################");

  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
    scope: authorizationCode.scope,
  });
});

app.use("/api/mcp/*", async (c, next) => {
  const authorization = c.req.header("authorization") ?? "";
  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme !== "Bearer" || !token) {
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    );
    return c.json({ error: "unauthorized" }, 401);
  }

  const accessToken = accessTokens.get(token);

  if (!accessToken) {
    return c.json({ error: "invalid_token" }, 401);
  }

  if (accessToken.expiresAt < Date.now()) {
    accessTokens.delete(token);
    return c.json({ error: "invalid_token" }, 401);
  }

  if (!accessToken.scope.split(/\s+/).includes(REQUIRED_SCOPE)) {
    return c.json({ error: "insufficient_scope" }, 403);
  }

  await runWithArdenSession(accessToken.ardenSession, next);
});

const server = new MastraServer({ app, mastra, prefix: "/api" });

await server.init();

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(
      `MCP endpoint: http://localhost:${info.port}/api/mcp/arden-codebase/mcp`,
    );
  },
);

export default app;
