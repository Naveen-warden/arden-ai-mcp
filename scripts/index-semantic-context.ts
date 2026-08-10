import { createHash } from "node:crypto";
import dns from "node:dns";
import { Resolver } from "node:dns/promises";

import { embedTexts } from "../src/codeChunks";
import {
  QDRANT_API_KEY,
  QDRANT_COLLECTION,
  QDRANT_SEMANTIC_COLLECTION,
  QDRANT_URL,
} from "../src/environment";
import { getCompiledSemanticContextRecords } from "../src/semanticContext";
import type { SemanticContextRecord } from "../src/semanticContext";

const EMBEDDING_SIZE = 384;
const DEFAULT_BATCH_SIZE = 16;

type QdrantResponse<T> = {
  result?: T;
  status?: unknown;
  time?: number;
};

function parseArgs() {
  const args = new Set(process.argv.slice(2));

  return {
    dryRun: args.has("--dry-run"),
    deleteLegacy: args.has("--delete-legacy"),
    reset: !args.has("--no-reset"),
  };
}

function makePointId(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function createDispatcher() {
  const { Agent } = await import("undici");
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);

  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        resolver
          .resolve4(hostname)
          .then((addresses) => {
            const [address] = addresses;
            if (!address) throw new Error(`No IPv4 records for ${hostname}`);

            if (options?.all) {
              callback(null, [{ address, family: 4 }]);
            } else {
              callback(null, address, 4);
            }
          })
          .catch(() => dns.lookup(hostname, options, callback));
      },
    },
  });
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

function makeVectorText(record: SemanticContextRecord) {
  return [
    record.productArea,
    record.capability,
    record.plainSummary,
    record.workflowSteps.join(" "),
    record.commonQuestions.join(" "),
    record.relatedConcepts.join(" "),
    record.dataUse,
    record.responseGuidance,
    record.audiences.join(" "),
  ].join("\n");
}

function makePayload(record: SemanticContextRecord) {
  return {
    id: record.id,
    audiences: record.audiences,
    productArea: record.productArea,
    capability: record.capability,
    plainSummary: record.plainSummary,
    workflowSteps: record.workflowSteps,
    commonQuestions: record.commonQuestions,
    relatedConcepts: record.relatedConcepts,
    dataUse: record.dataUse,
    responseGuidance: record.responseGuidance,
    internalPointerId: record.internalPointerId,
    indexedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs();
  const baseUrl = (QDRANT_URL ?? "http://localhost:6333").replace(/\/$/, "");
  const dispatcher = await createDispatcher();
  const batchSize = Number(process.env.QDRANT_INDEX_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const records = getCompiledSemanticContextRecords();

  async function request<T>(method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      dispatcher,
    } as RequestInit & { dispatcher: unknown });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as QdrantResponse<T>) : undefined;

    if (!response.ok) {
      throw new Error(
        `Qdrant ${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`,
      );
    }

    return data;
  }

  async function collectionExists(collection: string) {
    const response = await fetch(`${baseUrl}/collections/${encodeURIComponent(collection)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {}),
      },
      dispatcher,
    } as RequestInit & { dispatcher: unknown });

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `Qdrant collection check failed with ${response.status}: ${(await response.text()).slice(0, 1_000)}`,
      );
    }

    return true;
  }

  async function deleteCollection(collection: string) {
    if (!(await collectionExists(collection))) return;
    await withRetry(() => request("DELETE", `/collections/${encodeURIComponent(collection)}`));
  }

  async function ensureCollection() {
    if (args.reset) await deleteCollection(QDRANT_SEMANTIC_COLLECTION);

    if (!(await collectionExists(QDRANT_SEMANTIC_COLLECTION))) {
      await withRetry(() =>
        request("PUT", `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}`, {
          vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
        }),
      );
    }

    await Promise.all([
      request(
        "PUT",
        `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}/index?wait=true`,
        { field_name: "audiences", field_schema: "keyword" },
      ),
      request(
        "PUT",
        `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}/index?wait=true`,
        { field_name: "productArea", field_schema: "keyword" },
      ),
      request(
        "PUT",
        `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}/index?wait=true`,
        { field_name: "capability", field_schema: "keyword" },
      ),
    ]);
  }

  console.log(`Qdrant URL: ${new URL(baseUrl).origin}`);
  console.log(`Semantic collection: ${QDRANT_SEMANTIC_COLLECTION}`);
  console.log(`Legacy source collection: ${QDRANT_COLLECTION}`);
  console.log(`Records: ${records.length}`);
  console.log(`Dry run: ${args.dryRun ? "yes" : "no"}`);
  console.log(`Delete legacy source collection: ${args.deleteLegacy ? "yes" : "no"}`);

  if (args.dryRun) return;

  if (args.deleteLegacy && QDRANT_COLLECTION !== QDRANT_SEMANTIC_COLLECTION) {
    console.log(`Deleting legacy source collection ${QDRANT_COLLECTION} if present...`);
    await deleteCollection(QDRANT_COLLECTION);
  }

  await ensureCollection();

  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = records.slice(offset, offset + batchSize);
    const vectors = await embedTexts(batch.map(makeVectorText));
    const points = batch.map((record, index) => ({
      id: makePointId(record.id),
      vector: vectors[index],
      payload: makePayload(record),
    }));

    await withRetry(() =>
      request(
        "PUT",
        `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}/points?wait=true`,
        { points },
      ),
    );

    console.log(
      `Indexed ${Math.min(offset + batch.length, records.length)}/${records.length} semantic records`,
    );
  }

  const collection = await request<{ points_count?: number | null }>(
    "GET",
    `/collections/${encodeURIComponent(QDRANT_SEMANTIC_COLLECTION)}`,
  );

  console.log(
    `Done. Semantic context points count: ${collection?.result?.points_count ?? "unknown"}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
