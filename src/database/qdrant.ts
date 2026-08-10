import { QdrantClient } from "@qdrant/js-client-rest";

import {
  QDRANT_API_KEY,
  QDRANT_COLLECTION,
  QDRANT_SEMANTIC_COLLECTION,
  QDRANT_URL,
} from "../environment";

const EMBEDDING_SIZE = 384;

export const qdrant = new QdrantClient({
  url: QDRANT_URL ?? "http://localhost:6333",
  ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
  checkCompatibility: false,
});

export async function withQdrantRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }

  throw lastError;
}

export async function ensureCodeCollection() {
  const { exists } = await withQdrantRetry(() =>
    qdrant.collectionExists(QDRANT_COLLECTION),
  );
  if (exists) return;

  await withQdrantRetry(() =>
    qdrant.createCollection(QDRANT_COLLECTION, {
      vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
    }),
  );

  await Promise.all([
    qdrant.createPayloadIndex(QDRANT_COLLECTION, {
      field_name: "repo",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_COLLECTION, {
      field_name: "profiles",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_COLLECTION, {
      field_name: "kind",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_COLLECTION, {
      field_name: "module",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_COLLECTION, {
      field_name: "filePath",
      field_schema: "keyword",
      wait: true,
    }),
  ]);
}

export async function ensureSemanticContextCollection() {
  const { exists } = await withQdrantRetry(() =>
    qdrant.collectionExists(QDRANT_SEMANTIC_COLLECTION),
  );
  if (exists) return;

  await withQdrantRetry(() =>
    qdrant.createCollection(QDRANT_SEMANTIC_COLLECTION, {
      vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
    }),
  );

  await Promise.all([
    qdrant.createPayloadIndex(QDRANT_SEMANTIC_COLLECTION, {
      field_name: "audiences",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_SEMANTIC_COLLECTION, {
      field_name: "productArea",
      field_schema: "keyword",
      wait: true,
    }),
    qdrant.createPayloadIndex(QDRANT_SEMANTIC_COLLECTION, {
      field_name: "capability",
      field_schema: "keyword",
      wait: true,
    }),
  ]);
}
