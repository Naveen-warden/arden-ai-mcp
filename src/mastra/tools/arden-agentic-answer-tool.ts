import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { answerArdenQuery } from "../../ardenAnswer";
import { CODE_SEARCH_PROFILES } from "../../codeChunks/types";
import { CODEBASE_EXPLAINER_REPOS } from "../../codebaseExplainer";
import { SEMANTIC_CONTEXT_AUDIENCES } from "../../semanticContext";

const appScopeSchema = z.enum([
  "admin-app",
  "booking-app",
  "resident-app",
  "super-admin",
  "external-app",
  "mcp-app",
  "public-app",
]);
const responseModeSchema = z.enum([
  "overview",
  "workflow",
  "troubleshooting",
  "developer_trace",
  "change_impact",
]);

export const ardenAgenticAnswerTool = createTool({
  id: "arden-answer",
  description:
    "Agentic Arden answer tool. It decides whether to use semantic context, Qdrant code chunks, live Arden GET data, or a hybrid path based on the query, then returns a concise role-aware answer. Prefer this as the first tool for normal user questions.",
  inputSchema: z.object({
    query: z.string().min(2).describe("The user's full question."),
    audience: z.enum(SEMANTIC_CONTEXT_AUDIENCES).default("business_user"),
    appScope: appScopeSchema.default("admin-app"),
    allowLiveData: z
      .boolean()
      .default(true)
      .describe("Allow read-only live Arden GET calls when the query asks for current records or data."),
    includeRawLiveData: z
      .boolean()
      .default(false)
      .describe("Only returns raw live data for developer audience. Otherwise data is compacted."),
    includeDeveloperEvidence: z
      .boolean()
      .default(false)
      .describe("Only returns raw code evidence when audience is developer and the explainer uses code chunks."),
    responseMode: responseModeSchema.optional().describe("Optional override; otherwise inferred from query."),
    repos: z.array(z.enum(CODEBASE_EXPLAINER_REPOS)).min(1).max(2).optional(),
    profile: z.enum(CODE_SEARCH_PROFILES).optional(),
    productArea: z.string().min(1).optional(),
    maxLiveRecords: z.number().int().min(1).max(20).default(5),
  }),
  outputSchema: z.object({
    query: z.string(),
    audience: z.enum(SEMANTIC_CONTEXT_AUDIENCES),
    answer: z.string(),
    plan: z.object({
      intent: z.enum(["semantic", "code", "live_data", "hybrid"]),
      responseMode: responseModeSchema,
      usedTools: z.array(z.string()),
      reasoning: z.string(),
    }),
    coverage: z.object({
      codeEvidenceCount: z.number().int(),
      semanticContextCount: z.number().int(),
      liveDataFetched: z.boolean(),
      liveDataRecordCount: z.number().int().optional(),
      modules: z.array(z.string()),
    }),
    liveData: z
      .object({
        status: z.number().int(),
        route: z.string().optional(),
        summary: z.object({
          kind: z.enum(["empty", "scalar", "object", "array"]),
          itemCount: z.number().int().optional(),
          displayedItemCount: z.number().int().optional(),
          collectionPath: z.string().optional(),
          fields: z.array(z.string()),
          records: z.array(z.unknown()),
          metadata: z.record(z.string(), z.unknown()),
          text: z.string(),
          notes: z.array(z.string()),
        }),
        rawData: z.unknown().optional(),
      })
      .optional(),
    warnings: z.array(z.string()),
  }),
  execute: async (input) => answerArdenQuery(input),
});
