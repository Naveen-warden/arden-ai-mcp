import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  chunkGitHubContent,
  extractSchemaFacts,
  fetchGitHubCodeChunk,
  queryTerms,
} from "../../githubCode/filter-evidence";

const repoSchema = z.enum(["arden-server", "arden-admin", "arden-website"]);

export const githubCodeChunkTool = createTool({
  id: "github-code-chunk",
  description:
    "Fetch a live source-code chunk from GitHub by known repo and file path. Use this to fill missing Qdrant context for filter resolution.",
  inputSchema: z.object({
    repo: repoSchema,
    filePath: z.string().min(1),
    query: z
      .string()
      .min(1)
      .optional()
      .describe("Optional query used to return the most relevant slice from large source files."),
    apiPath: z
      .string()
      .optional()
      .describe("Optional Arden API path used to infer the schema entity for parsed enum facts."),
  }),
  outputSchema: z.object({
    repo: repoSchema,
    filePath: z.string(),
    content: z.string(),
    found: z.boolean(),
  }),
  execute: async ({ repo, filePath, query, apiPath }) => {
    const chunk = await fetchGitHubCodeChunk(repo, filePath);

    if (!chunk) {
      return { repo, filePath, content: "", found: false };
    }

    const schemaFacts = query
      ? extractSchemaFacts(chunk.content, { query, path: apiPath ?? "" })
      : "";
    const content = query
      ? chunkGitHubContent(chunk.content, undefined, queryTerms(query))
      : chunk.content.slice(0, 4_000);

    return {
      repo: chunk.repo,
      filePath: chunk.path,
      content: schemaFacts ? `${schemaFacts}\n\n${content}` : content,
      found: true,
    };
  },
  toModelOutput: (output) => {
    if (!output.found) {
      return {
        type: "text",
        value: `GitHub live code chunk not found for ${output.repo}:${output.filePath}`,
      };
    }

    return {
      type: "text",
      value: [
        "GitHub live code evidence",
        `Repo: ${output.repo}`,
        `File: ${output.filePath}`,
        "Use this source chunk to fill missing indexed/Qdrant context. Do not invent filters, enum values, or route behavior not present in this chunk.",
        "```ts",
        output.content,
        "```",
      ].join("\n"),
    };
  },
});
