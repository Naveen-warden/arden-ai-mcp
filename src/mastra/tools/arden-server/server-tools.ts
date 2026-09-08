import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  ardenGet,
  assertKnownArdenGetRoute,
  getArdenRouteManifest,
  resolveArdenRoutes,
  type ArdenQueryValue,
} from "../../../rest";
import { compactArdenData } from "../../../liveData";
import {
  ardenFilterResolutionSchema,
  resolveArdenApiFilters,
} from "../../../rest/arden-filter-resolver";

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export const queryValueSchema = z.union([scalarSchema, z.array(scalarSchema)]);
const filterOperatorSchema = z.enum([">=", "<=", ":=", "!=", "~="]);
const appScopeSchema = z.enum([
  "admin-app",
  "booking-app",
  "resident-app",
  "super-admin",
  "external-app",
  "mcp-app",
  "public-app",
]);

export const resolveApiEndpointTool = createTool({
  id: "arden-server-resolve-api-endpoint",
  description:
    "Resolve a live-data request to exact API routes declared by arden-server. Always call this before the GET API data tool. Results come from a versioned manifest generated from router declarations and cannot contain invented endpoints.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe(
        "Describe the resource and operation, for example: list bookings ordered by newest first",
      ),
    appScope: appScopeSchema.default("admin-app"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  outputSchema: z.object({
    query: z.string(),
    manifest: z.object({
      sourceCommit: z.string(),
      generatedAt: z.string(),
      routeCount: z.number().int(),
    }),
    candidates: z.array(
      z.object({
        method: z.literal("GET"),
        path: z.string(),
        appScope: appScopeSchema,
        access: z.string(),
        sourceFile: z.string(),
        sourceLine: z.number().int(),
      }),
    ),
  }),
  execute: async ({ query, appScope, limit }) => {
    const manifest = getArdenRouteManifest();
    const candidates = resolveArdenRoutes({
      query,
      method: "GET",
      appScope,
      limit,
    });

    return {
      query,
      manifest: {
        sourceCommit: manifest.sourceCommit,
        generatedAt: manifest.generatedAt,
        routeCount: manifest.routes.length,
      },
      candidates: candidates.map((candidate) => ({
        ...candidate,
        method: "GET" as const,
      })),
    };
  },
});

function makeFilterQuery(
  filters: Array<{
    field: string;
    operator: z.infer<typeof filterOperatorSchema>;
    value: string | number | boolean;
  }>,
) {
  return filters
    .map(({ field, operator, value }) => `${field}${operator}${String(value)}`)
    .join("$$");
}

export const getApiDataTool = createTool({
  id: "arden-server-get-api-data",
  description:
    "Fetch live data from a registered GET endpoint in arden-server. First use the endpoint resolver for an exact path, then use code search if supported query parameters are unclear. The API host and authentication are configured server-side.",
  inputSchema: z.object({
    path: z
      .string()
      .min(2)
      .describe(
        "API path relative to ARDEN_API_URL, including its app prefix, for example /admin-app/get-custom-scripts. Do not provide a host or query string.",
      ),
    searchParams: z
      .record(z.string(), queryValueSchema)
      .default({})
      .describe(
        "Route-specific query parameters other than structured filters and pagination.",
      ),
    filters: z
      .array(
        z.object({
          field: z
            .string()
            .regex(/^[A-Za-z][A-Za-z0-9_.$]*$/)
            .describe("Filter key accepted by the endpoint"),
          operator: filterOperatorSchema.default(":="),
          value: scalarSchema,
        }),
      )
      .default([])
      .describe("Filters encoded into arden-server's q parameter"),
    pagination: z
      .object({
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("One-based page number"),
        perPage: z.number().int().min(1).max(1_000).default(20),
        sort: z.string().min(1).optional(),
        order: z.enum(["asc", "desc"]).optional(),
      })
      .optional()
      .describe(
        "Optional list pagination. The one-based page is converted to arden-server's zero-based page parameter.",
      ),
  }),
  outputSchema: z.object({
    status: z.number().int(),
    url: z.string(),
    request: z.object({
      path: z.string(),
      page: z.number().int().optional(),
      perPage: z.number().int().optional(),
    }),
    dataSummary: z.object({
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
    data: z.unknown(),
  }),
  execute: async ({ path, searchParams, filters, pagination }) => {
    await assertKnownArdenGetRoute(path);

    const apiQuery: Record<string, ArdenQueryValue> = { ...searchParams };
    const structuredQ = makeFilterQuery(filters);

    if (structuredQ) {
      const existingQ = apiQuery.q;
      if (existingQ !== undefined && typeof existingQ !== "string") {
        throw new Error("query.q must be a string when filters are also used");
      }
      apiQuery.q = existingQ ? `${existingQ}$$${structuredQ}` : structuredQ;
    }

    if (pagination) {
      apiQuery.page = pagination.page - 1;
      apiQuery.per_page = pagination.perPage;
      if (pagination.sort) apiQuery.sort = pagination.sort;
      if (pagination.order) apiQuery.order = pagination.order;
    }

    const result = await ardenGet(path, { query: apiQuery });

    return {
      ...result,
      request: {
        path,
        ...(pagination
          ? { page: pagination.page, perPage: pagination.perPage }
          : {}),
      },
      dataSummary: compactArdenData(result.data),
    };
  },
});

export const resolveApiFiltersTool = createTool({
  id: "arden-server-resolve-api-filters",
  description:
    "Resolve route-specific filters and pagination for a known Arden GET endpoint using indexed arden-admin and arden-server code evidence.",
  inputSchema: z.object({
    query: z.string().min(2),
    path: z.string().min(2),
    appScope: appScopeSchema.default("admin-app"),
    preferredPerPage: z.number().int().min(1).max(1_000).optional(),
  }),
  outputSchema: ardenFilterResolutionSchema,
  execute: async (input, context) => {
    console.log("string tool");
    return resolveArdenApiFilters(input);
  },
});
