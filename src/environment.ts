import dotenv from "dotenv";

dotenv.config({ quiet: true });
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const MASTRA_API_KEY = process.env.MASTRA_API_KEY;
export const MASTRA_PLATFORM_ACCESS_TOKEN =
  process.env.MASTRA_PLATFORM_ACCESS_TOKEN;

export const QDRANT_URL = process.env.QDRANT_URL;
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
export const QDRANT_COLLECTION =
  process.env.QDRANT_COLLECTION ?? "arden_code_chunks";
export const QDRANT_SEMANTIC_COLLECTION =
  process.env.QDRANT_SEMANTIC_COLLECTION ?? "arden_semantic_context";

export const ARDEN_AI_MODEL =
  process.env.ARDEN_AI_MODEL ?? "openai/gpt-4o-mini";
export const OPENAI_EXPLAINER_MODEL =
  process.env.OPENAI_EXPLAINER_MODEL ?? ARDEN_AI_MODEL.replace(/^openai\//, "");

export const ARDEN_API_URL =
  process.env.ARDEN_API_URL ?? "http://localhost:5000/api/v1";
export const AUTH_BRIDGE_PUBLIC_URL =
  process.env.AUTH_BRIDGE_PUBLIC_URL ?? "http://127.0.0.1:4112";
export const MCP_RESOURCE_URL =
  process.env.MCP_RESOURCE_URL ??
  `${AUTH_BRIDGE_PUBLIC_URL}/api/mcp/arden-codebase/mcp`;
export const ARDEN_ADMIN_URL =
  process.env.ARDEN_ADMIN_URL ?? "http://localhost:3000";
export const OAUTH_REQUIRED_SCOPE =
  process.env.OAUTH_REQUIRED_SCOPE ?? "arden:read";
export const OAUTH_CODE_TTL_SECONDS = Number(
  process.env.OAUTH_CODE_TTL_SECONDS ?? 300,
);
export const OAUTH_PENDING_AUTH_TTL_SECONDS = Number(
  process.env.OAUTH_PENDING_AUTH_TTL_SECONDS ?? 600,
);
export const MCP_ACCESS_TOKEN_TTL_SECONDS = Number(
  process.env.MCP_ACCESS_TOKEN_TTL_SECONDS ?? 3600,
);
export const ARDEN_ACCESS_TOKEN = process.env.ARDEN_ACCESS_TOKEN;
export const ARDEN_PERMISSION_ID = process.env.ARDEN_PERMISSION_ID;

export const MSG91_WIDGET_ID = process.env.MSG91_WIDGET_ID;
export const MSG91_TOKEN_AUTH = process.env.MSG91_TOKEN_AUTH;
