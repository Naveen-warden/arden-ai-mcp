import { qdrantRestCollectionExists, qdrantRestRequest } from "../database";
import { QDRANT_COLLECTION } from "../environment";
import { embedText } from "./embedding";
import type { CodeSearchOptions, CodeSearchResult } from "./types";

const SEARCH_EXPANSION_FACTOR = 4;
const MIN_EXPANDED_LIMIT = 20;
const QUERY_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "how",
  "what",
  "why",
  "does",
  "do",
  "explain",
  "flow",
  "module",
  "arden",
]);

function makeFilter({ profile, repos }: Omit<CodeSearchOptions, "topK">) {
  const must: Array<Record<string, unknown>> = [];

  if (profile) {
    must.push({ key: "profiles", match: { value: profile } });
  }

  if (repos?.length) {
    must.push({ key: "repo", match: { any: repos } });
  }

  return must.length ? { must } : undefined;
}

type QdrantSearchResponse = {
  result?: Array<{
    id: string | number;
    score: number;
    payload?: Record<string, unknown> | null;
  }>;
};

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeToken(value: string) {
  const token = value.toLowerCase();
  return token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token;
}

function queryTokens(query: string) {
  return query
    .split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !QUERY_STOP_WORDS.has(token));
}

function searchableText(result: CodeSearchResult) {
  return [
    result.repo,
    result.kind,
    result.module,
    result.filePath,
    result.name,
    result.profiles.join(" "),
    result.content.slice(0, 4_000),
  ]
    .join(" ")
    .toLowerCase();
}

function lexicalBoost(query: string, result: CodeSearchResult) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;

  const text = searchableText(result);
  const module = result.module.toLowerCase();
  const name = result.name.toLowerCase();
  const filePath = result.filePath.toLowerCase();
  let boost = 0;

  for (const token of tokens) {
    if (module.includes(token)) boost += 0.12;
    if (name.includes(token)) boost += 0.1;
    if (filePath.includes(token)) boost += 0.08;
    if (text.includes(token)) boost += 0.025;
  }

  if (result.kind.includes("function") || result.kind.includes("method")) boost += 0.03;
  if (result.kind.includes("class") || result.kind.includes("interface")) boost += 0.02;

  return Math.min(boost, 0.5);
}

export async function searchCode(
  query: string,
  options: CodeSearchOptions,
): Promise<CodeSearchResult[]> {
  if (!(await qdrantRestCollectionExists(QDRANT_COLLECTION))) return [];

  const vector = await embedText(query);
  const filter = makeFilter(options);
  const response = await withRetry(() =>
    qdrantRestRequest<QdrantSearchResponse>(
      "POST",
      `/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points/search`,
      {
        vector,
        limit: Math.max(options.topK * SEARCH_EXPANSION_FACTOR, MIN_EXPANDED_LIMIT),
        ...(filter ? { filter } : {}),
        with_payload: true,
        with_vector: false,
      },
    ),
  );
  const points = response.result ?? [];

  return points.map((point) => {
    const payload = point.payload ?? {};
    const profiles = Array.isArray(payload.profiles)
      ? payload.profiles.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    return {
      id: String(point.id),
      score: point.score,
      repo: stringValue(payload.repo),
      kind: stringValue(payload.kind),
      module: stringValue(payload.module),
      filePath: stringValue(payload.filePath),
      name: stringValue(payload.name),
      content: stringValue(payload.content),
      profiles,
    };
  })
    .map((result) => ({
      ...result,
      score: result.score + lexicalBoost(query, result),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topK);
}
