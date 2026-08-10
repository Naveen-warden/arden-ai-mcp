import {
  ARDEN_ADMIN_URL,
  AUTH_BRIDGE_PUBLIC_URL,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_RESOURCE_URL,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_PENDING_AUTH_TTL_SECONDS,
  OAUTH_REQUIRED_SCOPE,
} from "../environment";

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export const authBridgeConfig = {
  issuer: trimTrailingSlash(AUTH_BRIDGE_PUBLIC_URL),
  authBridgePublicUrl: trimTrailingSlash(AUTH_BRIDGE_PUBLIC_URL),
  mcpResourceUrl: MCP_RESOURCE_URL,
  ardenAdminUrl: trimTrailingSlash(ARDEN_ADMIN_URL),
  requiredScope: OAUTH_REQUIRED_SCOPE,
  codeTtlMs: OAUTH_CODE_TTL_SECONDS * 1000,
  pendingAuthTtlMs: OAUTH_PENDING_AUTH_TTL_SECONDS * 1000,
  mcpAccessTokenTtlMs: MCP_ACCESS_TOKEN_TTL_SECONDS * 1000,
};
