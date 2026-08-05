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

export const ARDEN_AI_MODEL =
  process.env.ARDEN_AI_MODEL ?? "openai/gpt-4o-mini";

export const ARDEN_API_URL =
  process.env.ARDEN_API_URL ?? "http://localhost:5000/api/v1";
export const ARDEN_ACCESS_TOKEN = process.env.ARDEN_ACCESS_TOKEN;
export const ARDEN_PERMISSION_ID = process.env.ARDEN_PERMISSION_ID;
