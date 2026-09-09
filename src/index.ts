import { serve } from "@hono/node-server";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { runWithArdenSession } from "./auth/arden-session-context";
import { authBridgeConfig } from "./auth/config";
import {
  exchangeArdenPhoneLogin,
  type ArdenLoginMethod,
} from "./auth/arden-login-exchange";
import { getMcpJwtService } from "./auth/mcp-jwt";
import { oauthStore } from "./auth/oauth-store";
import { mastra } from "./mastra/index";
import { validateArdenSession } from "./rest";
import { port as PORT } from "./environment";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

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

function getBodyValue(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return typeof value === "string" ? value.trim() : "";
}

function createPkceChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function makeAdminAuthorizeUrl(requestId: string) {
  const url = new URL(`${authBridgeConfig.ardenAdminUrl}/auth/mcp-authorize`);
  url.searchParams.set("request_id", requestId);
  return url;
}

function getMcpTokenExpiresAt(
  hasArdenRefreshToken: boolean,
  ardenExpiresAt?: number,
) {
  const defaultExpiresAt = Date.now() + authBridgeConfig.mcpAccessTokenTtlMs;
  return hasArdenRefreshToken || !ardenExpiresAt
    ? defaultExpiresAt
    : Math.min(defaultExpiresAt, ardenExpiresAt);
}

function getPermissionIds(permissions: unknown[]) {
  return permissions
    .map((permission) => {
      if (!permission || typeof permission !== "object") return undefined;
      const id = (permission as Record<string, unknown>).id;
      return typeof id === "number" || typeof id === "string"
        ? String(id)
        : undefined;
    })
    .filter((id): id is string => Boolean(id));
}

function getDefaultPermissionId(permissions: unknown[]) {
  return getPermissionIds(permissions)[0] ?? "";
}

function getSessionUserId(user: unknown) {
  if (!user || typeof user !== "object") return undefined;

  const id = (user as Record<string, unknown>).id;
  return typeof id === "number" || typeof id === "string"
    ? String(id)
    : undefined;
}

function makeOAuthCallbackUrl(
  redirectUri: string,
  code: string,
  state: string,
) {
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);
  return callbackUrl;
}

async function readRequestBody(c: Context) {
  const contentType = c.req.header("content-type") ?? "";
  return contentType.includes("application/json")
    ? await c.req.json<Record<string, unknown>>()
    : ((await c.req.parseBody()) as Record<string, unknown>);
}

app.use(
  "/oauth/arden-*",
  cors({
    origin: authBridgeConfig.ardenAdminUrl,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  }),
);

app.get("/", (c) => c.text("Arden MCP OAuth provider"));

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    issuer: authBridgeConfig.issuer,
    ardenAdminUrl: authBridgeConfig.ardenAdminUrl,
    mcpEndpoint: "/api/mcp/arden-codebase/mcp",
  });
});

app.get("/.well-known/oauth-protected-resource", (c) => {
  return c.json({
    resource: authBridgeConfig.mcpResourceUrl,
    authorization_servers: [authBridgeConfig.issuer],
    scopes_supported: [authBridgeConfig.requiredScope],
    bearer_methods_supported: ["header"],
  });
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json({
    issuer: authBridgeConfig.issuer,
    authorization_endpoint: `${authBridgeConfig.issuer}/oauth/authorize`,
    token_endpoint: `${authBridgeConfig.issuer}/oauth/token`,
    registration_endpoint: `${authBridgeConfig.issuer}/oauth/register`,
    jwks_uri: `${authBridgeConfig.issuer}/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [authBridgeConfig.requiredScope],
  });
});

app.get("/oauth/jwks", async (c) => {
  return c.json(await getMcpJwtService().getPublicJwks());
});

app.post("/oauth/register", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
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

  const scope =
    typeof body.scope === "string"
      ? body.scope
      : authBridgeConfig.requiredScope;

  if (!scope.split(/\s+/).includes(authBridgeConfig.requiredScope)) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description: `${authBridgeConfig.requiredScope} scope is required`,
      },
      400,
    );
  }

  const clientName =
    typeof body.client_name === "string" ? body.client_name : "unknown";

  oauthStore.clients.set(clientId, {
    clientId,
    clientName,
    redirectUris,
    scope,
  });

  return c.json(
    {
      client_id: clientId,
      client_name: clientName,
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
  const scope = c.req.query("scope") ?? authBridgeConfig.requiredScope;
  const state = c.req.query("state") ?? "";
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method");

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.text("Missing required OAuth params", 400);
  }

  const client = oauthStore.clients.get(clientId);
  if (!client) return c.text("Unknown client_id", 400);
  if (!client.redirectUris.includes(redirectUri))
    return c.text("Invalid redirect_uri", 400);
  if (responseType !== "code") return c.text("Unsupported response_type", 400);
  if (!scope.split(/\s+/).includes(authBridgeConfig.requiredScope)) {
    return c.text("Unsupported scope", 400);
  }
  if (codeChallengeMethod !== "S256") {
    return c.text("Unsupported code_challenge_method", 400);
  }

  const requestId = `req_${randomUUID()}`;
  oauthStore.pendingAuthorizationRequests.set(requestId, {
    requestId,
    clientId,
    clientName: client.clientName,
    redirectUri,
    scope,
    state,
    codeChallenge,
    expiresAt: Date.now() + authBridgeConfig.pendingAuthTtlMs,
  });

  return c.redirect(makeAdminAuthorizeUrl(requestId).toString());
});

app.get("/oauth/arden-authorization/:requestId", (c) => {
  const requestId = c.req.param("requestId");
  const pending = oauthStore.pendingAuthorizationRequests.get(requestId);

  if (!pending || pending.expiresAt <= Date.now()) {
    oauthStore.pendingAuthorizationRequests.delete(requestId);
    return c.json({ error: "invalid_request" }, 404);
  }

  return c.json({
    requestId,
    clientName: pending.clientName,
    scope: pending.scope,
    expiresAt: pending.expiresAt,
    hasArdenSession: Boolean(pending.ardenSession),
  });
});

app.post("/oauth/arden-login", async (c) => {
  const body = await readRequestBody(c);
  const requestId = getBodyValue(body, "request_id");
  const token = getBodyValue(body, "token");
  const method = getBodyValue(body, "method") as ArdenLoginMethod | "";
  const pending = oauthStore.pendingAuthorizationRequests.get(requestId);

  if (!pending || pending.expiresAt <= Date.now()) {
    oauthStore.pendingAuthorizationRequests.delete(requestId);
    return c.json({ error: "invalid_request" }, 404);
  }

  if (!token) return c.json({ error: "missing_token" }, 400);
  if (method && !["GOOGLE", "MSG91"].includes(method)) {
    return c.json({ error: "unsupported_method" }, 400);
  }

  try {
    const { session, loginData } = await exchangeArdenPhoneLogin({
      token,
      ...(method ? { method } : {}),
    });
    pending.ardenSession = session;

    return c.json({
      user: session.user,
      permissions: session.permissions ?? [],
      defaultPermissionId: getDefaultPermissionId(session.permissions ?? []),
      loginData,
    });
  } catch (error) {
    console.warn("Arden login exchange failed", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "arden_login_failed" }, 401);
  }
});

app.post("/oauth/arden-authorize/complete", async (c) => {
  const body = await readRequestBody(c);
  const requestId = getBodyValue(body, "request_id");
  const requestedPermissionId = getBodyValue(body, "permission_id");
  const pending = oauthStore.pendingAuthorizationRequests.get(requestId);

  if (!pending || pending.expiresAt <= Date.now()) {
    oauthStore.pendingAuthorizationRequests.delete(requestId);
    return c.json({ error: "invalid_request" }, 404);
  }

  if (!pending.ardenSession) {
    return c.json({ error: "arden_login_required" }, 400);
  }

  const permissionIds = getPermissionIds(
    pending.ardenSession.permissions ?? [],
  );
  const permissionId = requestedPermissionId || permissionIds[0] || "";

  if (permissionIds.length > 0 && !permissionIds.includes(permissionId)) {
    return c.json({ error: "invalid_permission" }, 400);
  }

  pending.ardenSession.permissionId = permissionId || undefined;

  try {
    await validateArdenSession(pending.ardenSession);
  } catch (error) {
    console.warn("Arden session validation failed", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "arden_session_invalid" }, 401);
  }

  const code = `code_${randomUUID()}`;
  oauthStore.authorizationCodes.set(code, {
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    codeChallenge: pending.codeChallenge,
    expiresAt: Date.now() + authBridgeConfig.codeTtlMs,
    ardenSession: pending.ardenSession,
  });
  oauthStore.pendingAuthorizationRequests.delete(requestId);

  return c.json({
    redirectUrl: makeOAuthCallbackUrl(
      pending.redirectUri,
      code,
      pending.state,
    ).toString(),
  });
});

app.post("/oauth/token", async (c) => {
  const body = await readRequestBody(c);
  const grantType = getBodyValue(body, "grant_type");
  const code = getBodyValue(body, "code");
  const redirectUri = getBodyValue(body, "redirect_uri");
  const clientId = getBodyValue(body, "client_id");
  const codeVerifier = getBodyValue(body, "code_verifier");

  if (grantType !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  const authorizationCode = oauthStore.authorizationCodes.get(code);
  if (!authorizationCode) return c.json({ error: "invalid_grant" }, 400);
  if (authorizationCode.expiresAt < Date.now()) {
    oauthStore.authorizationCodes.delete(code);
    return c.json({ error: "invalid_grant" }, 400);
  }
  if (
    authorizationCode.clientId !== clientId ||
    authorizationCode.redirectUri !== redirectUri
  ) {
    return c.json({ error: "invalid_grant" }, 400);
  }
  if (!codeVerifier) return c.json({ error: "invalid_request" }, 400);
  if (createPkceChallenge(codeVerifier) !== authorizationCode.codeChallenge) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  const userId = getSessionUserId(authorizationCode.ardenSession.user);
  const permissionId = authorizationCode.ardenSession.permissionId;

  if (!userId || !permissionId) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  const accessToken = await getMcpJwtService().signAccessToken({
    userId,
    permissionId,
    clientId,
    scope: authorizationCode.scope,
  });

  oauthStore.authorizationCodes.delete(code);
  const expiresAt = getMcpTokenExpiresAt(
    Boolean(authorizationCode.ardenSession.refreshToken),
    authorizationCode.ardenSession.expiresAt,
  );

  oauthStore.accessTokens.set(accessToken, {
    clientId,
    scope: authorizationCode.scope,
    expiresAt,
    ardenSession: authorizationCode.ardenSession,
  });

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
      `Bearer resource_metadata="${authBridgeConfig.issuer}/.well-known/oauth-protected-resource"`,
    );
    return c.json({ error: "unauthorized" }, 401);
  }

  const accessToken = oauthStore.accessTokens.get(token);
  if (!accessToken) return c.json({ error: "invalid_token" }, 401);
  if (accessToken.expiresAt < Date.now()) {
    oauthStore.accessTokens.delete(token);
    return c.json({ error: "invalid_token" }, 401);
  }
  if (
    !accessToken.scope.split(/\s+/).includes(authBridgeConfig.requiredScope)
  ) {
    return c.json({ error: "insufficient_scope" }, 403);
  }

  await runWithArdenSession(accessToken.ardenSession, next);
});

const server = new MastraServer({ app, mastra, prefix: "/api" });

await server.init();

serve(
  {
    fetch: app.fetch,
    port: Number(PORT),
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(
      `MCP endpoint: http://localhost:${info.port}/api/mcp/arden-codebase/mcp`,
    );
  },
);

export default app;
