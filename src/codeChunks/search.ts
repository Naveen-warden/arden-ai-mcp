import type { Schemas } from "@qdrant/js-client-rest";

import { ensureCodeCollection, qdrant, withQdrantRetry } from "../database";
import { QDRANT_COLLECTION } from "../environment";
import { embedText } from "./embedding";
import type { CodeSearchOptions, CodeSearchResult } from "./types";

function makeFilter({ profile, repos }: Omit<CodeSearchOptions, "topK">) {
  const must: Schemas["Condition"][] = [];

  if (profile) {
    must.push({ key: "profiles", match: { value: profile } });
  }

  if (repos?.length) {
    must.push({ key: "repo", match: { any: repos } });
  }

  return must.length ? { must } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function searchCode(
  query: string,
  options: CodeSearchOptions,
): Promise<CodeSearchResult[]> {
  await ensureCodeCollection();
  const vector = await embedText(query);
  const filter = makeFilter(options);
  const points = await withQdrantRetry(() =>
    qdrant.search(QDRANT_COLLECTION, {
      vector,
      limit: options.topK,
      ...(filter ? { filter } : {}),
      with_payload: true,
      with_vector: false,
    }),
  );

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
  });
}
