import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  resolveArdenRoutes,
  resolveArdenApiFilters,
  ardenGet,
  compactArdenData,
  assertKnownArdenGetRoute,
  type ArdenFilterResolution,
  type ArdenQueryValue,
} from "../../rest";

const appScopeSchema = z.enum([
  "admin-app",
  "booking-app",
  "resident-app",
  "super-admin",
  "external-app",
  "mcp-app",
  "public-app",
]);

const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(1000).default(10),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const filterSchema = z.object({
  field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.$]*$/),
  operator: z.enum([">=", "<=", ":=", "!=", "~="]).default(":="),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const dataSummarySchema = z.object({
  kind: z.enum(["empty", "scalar", "object", "array"]),
  itemCount: z.number().int().optional(),
  displayedItemCount: z.number().int().optional(),
  collectionPath: z.string().optional(),
  fields: z.array(z.string()),
  records: z.array(z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  text: z.string(),
  notes: z.array(z.string()),
});

const debugInfoSchema = z.object({
  resolvedPath: z.string().optional(),
  resolvedFilters: z.array(filterSchema).optional(),
  resolvedPagination: paginationSchema.optional(),
});

export const workflowInputSchema = z.object({
  query: z.string().min(2).optional(),
  path: z.string().optional(),
  appScope: appScopeSchema.default("admin-app"),
  pagination: paginationSchema.optional(),
  debug: z.boolean().default(false),
});

export const workflowOutputSchema = z.object({
  data: z.unknown(),
  dataSummary: dataSummarySchema,
  url: z.string(),
  status: z.number().int(),
  debugInfo: debugInfoSchema.optional(),
});

function makeFilterQuery(filters: z.infer<typeof filterSchema>[]): string {
  return filters
    .map(({ field, operator, value }) => `${field}${operator}${String(value)}`)
    .join("$$");
}

const resolveEndpointStep = createStep({
  id: "resolve-endpoint",
  description: "Resolves a natural language query to an API endpoint",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    path: z.string(),
    appScope: appScopeSchema,
    query: z.string(),
    pagination: paginationSchema.optional(),
    debug: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.path) {
      assertKnownArdenGetRoute(inputData.path);
      return {
        path: inputData.path,
        appScope: inputData.appScope,
        query: inputData.query || "",
        pagination: inputData.pagination,
        debug: inputData.debug,
      };
    }

    if (!inputData.query) {
      throw new Error("Either query or path must be provided");
    }

    const candidates = resolveArdenRoutes({
      query: inputData.query,
      method: "GET",
      appScope: inputData.appScope,
      limit: 10,
    });

    if (!candidates?.length) {
      throw new Error(`No endpoints found for query: ${inputData.query}`);
    }

    const bestCandidate = candidates[0];

    return {
      path: bestCandidate.path,
      appScope: bestCandidate.appScope,
      query: inputData.query,
      pagination: inputData.pagination,
      debug: inputData.debug,
    };
  },
});

const resolveFiltersStep = createStep({
  id: "resolve-filters",
  description: "Resolves filters and pagination for a known API endpoint",
  inputSchema: z.object({
    path: z.string(),
    appScope: appScopeSchema,
    query: z.string(),
    pagination: paginationSchema.optional(),
    debug: z.boolean(),
  }),
  outputSchema: z.object({
    path: z.string(),
    appScope: appScopeSchema,
    filters: z.array(filterSchema),
    pagination: paginationSchema.optional(),
    debug: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const resolution = await resolveArdenApiFilters({
      query: inputData.query,
      path: inputData.path,
      appScope: inputData.appScope,
      preferredPerPage: inputData.pagination?.perPage,
    });

    if (resolution.confidence === "blocked") {
      throw new Error(
        `Filter resolution blocked: ${resolution.warnings.join("; ")}`,
      );
    }

    if (!resolution.shouldExecute) {
      throw new Error(
        `Filter resolution marked request unsafe: ${resolution.warnings.join("; ")}`,
      );
    }

    return {
      path: inputData.path,
      appScope: inputData.appScope,
      filters: resolution.filters || [],
      pagination: inputData.pagination,
      debug: inputData.debug,
    };
  },
});

const fetchLiveDataStep = createStep({
  id: "fetch-live-data",
  description: "Fetches live data from the resolved API endpoint with filters",
  inputSchema: z.object({
    path: z.string(),
    appScope: appScopeSchema,
    filters: z.array(filterSchema),
    pagination: paginationSchema.optional(),
    debug: z.boolean(),
  }),
  outputSchema: workflowOutputSchema,
  execute: async ({ inputData }) => {
    const apiQuery: Record<string, ArdenQueryValue> = {};

    const structuredQ = makeFilterQuery(inputData.filters);
    if (structuredQ) {
      apiQuery.q = structuredQ;
    }

    if (inputData.pagination) {
      apiQuery.page = inputData.pagination.page - 1;
      apiQuery.per_page = inputData.pagination.perPage;
      if (inputData.pagination.sort) apiQuery.sort = inputData.pagination.sort;
      if (inputData.pagination.order)
        apiQuery.order = inputData.pagination.order;
    }

    const result = await ardenGet(inputData.path, { query: apiQuery });

    const output: z.infer<typeof workflowOutputSchema> = {
      data: result.data,
      dataSummary: compactArdenData(result.data),
      url: result.url,
      status: result.status,
    };

    if (inputData.debug) {
      output.debugInfo = {
        resolvedPath: inputData.path,
        resolvedFilters: inputData.filters,
        resolvedPagination: inputData.pagination,
      };
    }

    return output;
  },
});

const liveDataFetchWorkflow = createWorkflow({
  id: "live-data-fetch-workflow",
  description:
    "Fetch live Arden server data from natural language by resolving endpoint, resolving filters with GitHub/Qdrant evidence, and calling the read-only GET API.",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(resolveEndpointStep)
  .then(resolveFiltersStep)
  .then(fetchLiveDataStep)
  .commit();

export { liveDataFetchWorkflow };
