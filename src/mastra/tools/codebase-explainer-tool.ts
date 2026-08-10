import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { CODE_SEARCH_PROFILES } from "../../codeChunks/types";
import {
  CODEBASE_EXPLAINER_REPOS,
  explainFromQdrantCodeChunks,
} from "../../codebaseExplainer";
import { SEMANTIC_CONTEXT_AUDIENCES } from "../../semanticContext";

export const qdrantCodebaseExplainerTool = createTool({
  id: "arden-codebase-explain-from-code",
  description:
    "Generate a role-specific Arden explanation grounded in Qdrant Cloud indexed source-code chunks. Use this for implementation flow, product behavior, troubleshooting, change impact, or deeper explanations. It optionally blends safe semantic context and returns raw code evidence only for developer audience when explicitly requested.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe("The user question or workflow to explain. Be specific, for example: booking payment plan flow for admin."),
    audience: z
      .enum(SEMANTIC_CONTEXT_AUDIENCES)
      .default("business_user")
      .describe("Controls how much implementation detail is shown and how the answer is phrased."),
    repos: z
      .array(z.enum(CODEBASE_EXPLAINER_REPOS))
      .min(1)
      .max(2)
      .default([...CODEBASE_EXPLAINER_REPOS])
      .describe("Select backend, frontend, or both repositories for evidence."),
    topK: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(8)
      .describe("Number of final code chunks to synthesize after expanded retrieval and reranking."),
    profile: z
      .enum(CODE_SEARCH_PROFILES)
      .optional()
      .describe("Optional domain filter such as booking, paymentPlan, paymentsWorkflow, request, resident, document, room, auth, workflow, frontend, or backend."),
    productArea: z.string().min(1).optional().describe("Optional semantic context product area filter."),
    responseMode: z
      .enum(["overview", "workflow", "troubleshooting", "developer_trace", "change_impact"])
      .default("workflow")
      .describe("Controls the structure of the synthesized answer."),
    includeSemanticContext: z.boolean().default(true).describe("Blend safe curated product context with source evidence."),
    includeEvidence: z
      .boolean()
      .default(false)
      .describe("Only returns raw code evidence when audience is developer."),
  }),
  outputSchema: z.object({
    query: z.string(),
    audience: z.enum(SEMANTIC_CONTEXT_AUDIENCES),
    answer: z.string(),
    sourceCoverage: z.object({
      repos: z.array(z.enum(CODEBASE_EXPLAINER_REPOS)),
      codeEvidenceCount: z.number().int(),
      semanticContextCount: z.number().int(),
      modules: z.array(z.string()),
    }),
    evidence: z
      .array(
        z.object({
          repo: z.enum(CODEBASE_EXPLAINER_REPOS),
          filePath: z.string(),
          name: z.string(),
          module: z.string(),
          score: z.number(),
          content: z.string(),
        }),
      )
      .optional(),
    warnings: z.array(z.string()),
  }),
  execute: async (input) => explainFromQdrantCodeChunks(input),
});
