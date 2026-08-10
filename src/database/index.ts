import { QdrantClient } from "@qdrant/js-client-rest";
import { QDRANT_URL } from "../environment";

export {
  ensureCodeCollection,
  ensureSemanticContextCollection,
  qdrant,
  withQdrantRetry,
} from "./qdrant";
export { qdrantRestCollectionExists, qdrantRestRequest } from "./qdrant-rest";

export async function countCollections() {
  const client = new QdrantClient({
    url: QDRANT_URL ?? "http://localhost:6333",
  });

  try {
    const response = await client.getCollections();
    console.log({ response }, "response");
    const count = response.collections.length;
    const collections = response.collections.map((c) => c.name);

    return { count, collections };
  } catch {
    return { count: 0, collections: [] };
  }
}
