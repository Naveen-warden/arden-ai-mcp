import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  searchSemanticContext,
  SEMANTIC_CONTEXT_AUDIENCES,
} from "../../semanticContext";

export const semanticContextSearchTool = createTool({
  id: "arden-semantic-context-search",
  description:
    "Safe semantic search over Arden product, workflow, and role-aware explanation context. Does not return source code, file paths, snippets, routes, or secrets.",
  inputSchema: z.object({
    query: z.string().min(1),
    topK: z.number().int().min(1).max(20).default(8),
    audience: z.enum(SEMANTIC_CONTEXT_AUDIENCES).optional(),
    productArea: z.string().min(1).optional(),
  }),
  outputSchema: z.object({
    query: z.string(),
    audience: z.enum(SEMANTIC_CONTEXT_AUDIENCES).optional(),
    results: z.array(
      z.object({
        id: z.string(),
        score: z.number(),
        audiences: z.array(z.enum(SEMANTIC_CONTEXT_AUDIENCES)),
        productArea: z.string(),
        capability: z.string(),
        plainSummary: z.string(),
        workflowSteps: z.array(z.string()),
        commonQuestions: z.array(z.string()),
        relatedConcepts: z.array(z.string()),
        dataUse: z.string(),
        responseGuidance: z.string(),
        internalPointerId: z.string(),
      }),
    ),
  }),
  execute: async ({ query, topK, audience, productArea }) => {
    const results = await searchSemanticContext(query, {
      topK,
      ...(audience ? { audience } : {}),
      ...(productArea ? { productArea } : {}),
    });

    return { query, ...(audience ? { audience } : {}), results };
  },
});
