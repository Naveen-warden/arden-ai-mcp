import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { searchCode } from "../../../codeChunks";
import { CODE_SEARCH_PROFILES } from "../../../codeChunks/types";

export const ardenServerCodeSearchTool = createTool({
  id: "arden-server-code-search",
  description:
    "Semantic search over indexed arden-server backend code. Returns source chunks with file paths and relevance scores.",
  inputSchema: z.object({
    query: z.string().min(1),
    topK: z.number().int().min(1).max(30).default(10),
    profile: z.enum(CODE_SEARCH_PROFILES).optional(),
    includeContent: z.boolean().default(true),
    maxContentChars: z.number().int().min(200).max(20_000).default(8_000),
  }),
  outputSchema: z.object({
    query: z.string(),
    repo: z.literal("arden-server"),
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        kind: z.string(),
        module: z.string(),
        filePath: z.string(),
        name: z.string(),
        profiles: z.array(z.string()),
        content: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ query, topK, profile, includeContent, maxContentChars }) => {
    const rows = await searchCode(query, {
      topK,
      repos: ["arden-server"],
      ...(profile ? { profile } : {}),
    });

    return {
      query,
      repo: "arden-server" as const,
      results: rows.map(({ repo: _repo, content, ...row }) => ({
        ...row,
        ...(includeContent
          ? {
              content:
                content.length <= maxContentChars
                  ? content
                  : `${content.slice(0, maxContentChars)}\n... truncated ...`,
            }
          : {}),
      })),
    };
  },
});
