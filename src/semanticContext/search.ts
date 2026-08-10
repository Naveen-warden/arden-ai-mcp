import { embedText } from "../codeChunks";
import { qdrantRestCollectionExists, qdrantRestRequest } from "../database";
import { QDRANT_SEMANTIC_COLLECTION } from "../environment";
import type {
  SemanticContextSearchOptions,
  SemanticContextSearchResult,
} from "./types";

const EMBEDDING_SIZE = 384;

type QdrantSearchResponse = {
  result?: Array<{
    id: string | number;
    score: number;
    payload?: Record<string, unknown> | null;
  }>;
};

const SEARCH_EXPANSION_FACTOR = 5;
const MIN_EXPANDED_LIMIT = 25;
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
  "simple",
  "terms",
  "arden",
  "user",
  "business",
]);

function makeFilter({ audience, productArea }: Omit<SemanticContextSearchOptions, "topK">) {
  const must: Array<Record<string, unknown>> = [];

  if (audience) must.push({ key: "audiences", match: { value: audience } });
  if (productArea) must.push({ key: "productArea", match: { value: productArea } });

  return must.length ? { must } : undefined;
}

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

async function ensureSemanticCollection() {
  if (await qdrantRestCollectionExists(QDRANT_SEMANTIC_COLLECTION)) return;

  await withRetry(() =>
    qdrantRestRequest("PUT", `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}`, {
      vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
    }),
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function searchableText(result: SemanticContextSearchResult) {
  return [
    result.productArea,
    result.capability,
    result.plainSummary,
    result.workflowSteps.join(" "),
    result.commonQuestions.join(" "),
    result.relatedConcepts.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function lexicalBoost(query: string, result: SemanticContextSearchResult) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;

  const text = searchableText(result);
  const productArea = result.productArea.toLowerCase();
  const capability = result.capability.toLowerCase();
  let boost = 0;

  for (const token of tokens) {
    if (productArea.includes(token)) boost += 0.12;
    if (capability.includes(token)) boost += 0.08;
    if (text.includes(token)) boost += 0.03;
  }

  return Math.min(boost, 0.4);
}

export async function searchSemanticContext(
  query: string,
  options: SemanticContextSearchOptions,
): Promise<SemanticContextSearchResult[]> {
  await ensureSemanticCollection();
  const vector = await embedText(query);
  const filter = makeFilter(options);
  const response = await withRetry(() =>
    qdrantRestRequest<QdrantSearchResponse>(
      "POST",
      `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}/points/search`,
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

    return {
      id: stringValue(payload.id) || String(point.id),
      score: point.score,
      audiences: stringArray(payload.audiences) as SemanticContextSearchResult["audiences"],
      productArea: stringValue(payload.productArea),
      capability: stringValue(payload.capability),
      plainSummary: stringValue(payload.plainSummary),
      workflowSteps: stringArray(payload.workflowSteps),
      commonQuestions: stringArray(payload.commonQuestions),
      relatedConcepts: stringArray(payload.relatedConcepts),
      dataUse: stringValue(payload.dataUse),
      responseGuidance: stringValue(payload.responseGuidance),
      internalPointerId: stringValue(payload.internalPointerId),
    };
  })
    .map((result) => ({
      ...result,
      score: result.score + lexicalBoost(query, result),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topK);
}
