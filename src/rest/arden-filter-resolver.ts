import { z } from "zod";
import { ardenLlmAgent } from "../llm/arden-llm-agent";
import { assertKnownArdenGetRoute } from "./arden-route-catalog";
import { searchCode, type CodeSearchResult } from "../codeChunks";
import { searchGitHubFilterEvidence } from "../githubCode/filter-evidence";
type ArdenApiFiltersInput = {
  query: string;
  path: string;
  appScope: string;
  preferredPerPage?: number;
};
type RankedEvidence = CodeSearchResult & {
  boost: number;
  boostedScore: number;
};
//INFO: this helper schemas are needed to resolve the query filters for our custom 'q' parameter

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const queryValueSchema = z.union([scalarSchema, z.array(scalarSchema)]);
const filterOperatorSchema = z.enum([">=", "<=", ":=", "!=", "~="]);
const confidenceSchema = z.enum(["low", "medium", "high", "blocked"]);

//INFO: this is resposible for mainting the filter schema for the custom 'q' parameter.
export const ardenResolvedFilterSchema = z.object({
  field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.$]*$/),
  operator: filterOperatorSchema,
  value: scalarSchema,
});

//INFO: this make sure the pagination is valid according to the arden-server
export const ardenResolvedPaginationSchema = z.object({
  page: z.number().int().min(1).max(100),
  perPage: z.number().int().min(1).max(100).default(20),
  sort: z.string().min(1).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const ardenFilterResolutionSchema = z.object({
  path: z.string().min(2), //this is the path of the arden-server route eg:' /admin-app/get-custom-scripts'
  query: z.record(z.string(), queryValueSchema).default({}), // query from the user
  filters: z.array(ardenResolvedFilterSchema).default([]), //some filters that are resolved from the query
  pagination: ardenResolvedPaginationSchema.optional(), // optional pagination used when the user asks for a specific page or needed more data
  confidence: confidenceSchema,
  shouldExecute: z.boolean(),
  evidenceSummary: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ArdenFilterResolution = z.infer<typeof ardenFilterResolutionSchema>;

const ardenLlmQueryEntrySchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_.$-]*$/),
  value: queryValueSchema,
});

const ardenLlmFilterResolutionSchema = ardenFilterResolutionSchema
  .omit({ query: true })
  .extend({
    // OpenAI response_format rejects z.record because it emits JSON Schema propertyNames.
    // Keep the public helper output as a record, but ask the LLM for key/value pairs.
    query: z.array(ardenLlmQueryEntrySchema).default([]),
  });

function makeBlockedResolution(
  input: ArdenApiFiltersInput,
  warning: string,
): ArdenFilterResolution {
  return {
    path: input.path,
    query: {},
    filters: [],
    confidence: "blocked",
    shouldExecute: false,
    evidenceSummary: [],
    warnings: [warning],
  };
}

function buildSystemPrompt() {
  return [
    "You are an Arden API request resolver.",
    "Convert a user request into structured query params for one already-resolved GET endpoint.",
    "Use ONLY the provided code evidence. Do not invent endpoint paths, filter fields, enum values, sort keys, or query params.",
    "Treat Extracted Schema Facts as exact enum/value evidence parsed from TypeScript union types.",
    "Prefer arden-server evidence for API-accepted filters, validators, filter controls, and sort controls.",
    "Prefer arden-admin schema facts for user-facing status values.",
    "Use structured filters for q parameter pieces. Do not put q inside query when the same filter can be represented in filters.",
    "Use page as one-based in the JSON output. The executor converts it to zero-based.",
    "If preferred page size is supplied and no evidence rejects it, use it as perPage.",
    "If the filter mapping is not supported by evidence, explain the uncertainty in warnings.",
    "Return only valid JSON matching the schema. Do not include markdown or commentary.",
    "",
    "## Understanding arden-server filterControl",
    "",
    "The evidence contains `filterControl` objects that define ALL valid filters for an endpoint.",
    "",
    "### filterControl Structure:",
    "{",
    "  searchText: [{ OR: [{ column, symbol, validator }] }],  // Text search fields",
    "  fieldName: [{ column, symbol, validator }]               // Exact filter fields",
    "}",
    "",
    "### Operators (symbol):",
    '- ":="  → Exact match (equality)',
    '- "~="  → Contains / fuzzy match (ILIKE)',
    '- ">="  → Greater than or equal',
    '- "<="  → Less than or equal',
    '- "!="  → Not equal',
    "",
    "### Validators (from defaultParamValidators):",
    "- string           → Any string value",
    "- number           → Integer (transforms string to int)",
    "- float            → Float number",
    "- boolean          → \"true\" or \"false\" strings",
    "- datetime         → ISO datetime string",
    "- enum([values])   → MUST use one of the provided enum values",
    "",
    "For enum filters, use only values proven by filterControl, constants, or Extracted Schema Facts.",
    "Never pair a value with a field whose enum evidence excludes that value.",
  ].join("\n");
}

function buildUserPrompt(input: ArdenApiFiltersInput, evidence: string) {
  return [
    `User request: ${input.query}`,
    `Resolved endpoint: GET ${input.path}`,
    `App scope: ${input.appScope}`,
    `Preferred page size: ${input.preferredPerPage ?? "not specified"}`,
    "",
    "Resolution rules:",
    "- Keep path exactly equal to the resolved endpoint.",
    "- query is for route-specific query params other than q filters and pagination.",
    "- filters are encoded into Arden q by the executor.",
    "- confidence should reflect the strength of the evidence.",
    "- blocked means do not execute only when the request cannot be safely mapped at all.",
    "",
    "Required output rules:",
    "- If user asks for a specific filter value but no matching enum/value evidence exists → confidence: \"blocked\"",
    "- Each filter MUST have: field, operator, value (matching validator type)",
    "- A value is only valid for a field if evidence shows that field's validator accepts that exact value.",
    "- Use \":=\" operator for enum fields (exact match)",
    "- Use \"~=\" operator for text search fields (contains match)",
    "- For lifecycle/status-like wording, inspect all relevant filterControl fields and do not assume the backend field is named 'status'.",
    "",
    "Return fields:",
    "- path",
    "- query as an array of { key, value } entries for route-specific query params",
    "- filters",
    "- pagination",
    "- confidence",
    "- shouldExecute",
    "- evidenceSummary",
    "- warnings",
    "",
    `Code evidence:\n${evidence}`,
  ].join("\n");
}

function queryEntriesToRecord(
  entries: z.infer<typeof ardenLlmQueryEntrySchema>[],
): ArdenFilterResolution["query"] {
  return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
}

function normalizeLlmResolution(result: unknown) {
  const parsed = ardenLlmFilterResolutionSchema.parse(result);

  return ardenFilterResolutionSchema.parse({
    ...parsed,
    query: queryEntriesToRecord(parsed.query),
  });
}

async function resolveWithLlm(input: ArdenApiFiltersInput, evidence: string) {
  const result = await ardenLlmAgent.generate(
    buildUserPrompt(input, evidence),
    {
      instructions: buildSystemPrompt(),
      maxSteps: 1,
      modelSettings: {
        temperature: 0,
      },
      structuredOutput: {
        schema: ardenLlmFilterResolutionSchema,
        jsonPromptInjection: "auto",
        errorStrategy: "strict",
      },
    },
  );
  if (!result.object) {
    throw new Error("LLM did not return structured filter resolution");
  }

  return {
    ...normalizeLlmResolution(result.object),
    path: input.path,
  };
}

function schemaAllowedStatusFields(evidence: string, value: string) {
  const allowed: Array<{ field: string; value: string }> = [];
  const schemaLines = evidence.matchAll(
    /\b[A-Za-z][A-Za-z0-9_]*\.([A-Za-z][A-Za-z0-9_]*) uses [^:]+ values: ([^\n]+)/g,
  );

  for (const match of schemaLines) {
    const field = match[1];
    const exactValue = (match[2] ?? "")
      .split(",")
      .map((item) => item.trim())
      .find((item) => item.toLowerCase() === value.toLowerCase());

    if (field && exactValue) allowed.push({ field, value: exactValue });
  }

  return allowed.filter(
    (match, index) => allowed.findIndex((item) => item.field === match.field && item.value === match.value) === index,
  );
}

function endpointSupportsFilterField(evidence: string, field: string) {
  return evidence.includes("filterControl") && new RegExp(`\\b${field}\\s*:`).test(evidence);
}

function preferSchemaStatusField(matches: Array<{ field: string; value: string }>) {
  return matches.find((match) => match.field === "status") ?? matches[0];
}

function applySchemaStatusCorrections(
  resolution: ArdenFilterResolution,
  evidence: string,
): ArdenFilterResolution {
  if (!evidence.includes("Extracted Schema Facts")) return resolution;

  return {
    ...resolution,
    filters: resolution.filters.map((filter) => {
      if (!/status/i.test(filter.field) || typeof filter.value !== "string") {
        return filter;
      }

      const field = preferSchemaStatusField(schemaAllowedStatusFields(evidence, filter.value))?.field;
      return field && field !== filter.field ? { ...filter, field } : filter;
    }),
  };
}

function hasSchemaValidStatusFilter(resolution: ArdenFilterResolution, evidence: string) {
  return resolution.filters.some((filter) => {
    if (!/status/i.test(filter.field) || typeof filter.value !== "string") {
      return false;
    }

    return schemaAllowedStatusFields(evidence, filter.value).some(
      (match) => match.field === filter.field && endpointSupportsFilterField(evidence, filter.field),
    );
  });
}

function resolveSchemaStatusFilter(input: ArdenApiFiltersInput, evidence: string) {
  for (const term of input.query.split(/[^a-z0-9-]+/i)) {
    const matches = schemaAllowedStatusFields(evidence, term).filter((match) =>
      endpointSupportsFilterField(evidence, match.field),
    );
    const selected = preferSchemaStatusField(matches);

    if (selected) {
      return { field: selected.field, operator: ":=" as const, value: selected.value };
    }
  }

  return undefined;
}

function enforceSafeFilterResolution(
  input: ArdenApiFiltersInput,
  resolution: ArdenFilterResolution,
  evidence: string,
): ArdenFilterResolution {
  const corrected = applySchemaStatusCorrections(resolution, evidence);
  if (hasSchemaValidStatusFilter(corrected, evidence)) {
    return {
      ...corrected,
      confidence: "high",
      shouldExecute: true,
      warnings: [],
    };
  }

  const schemaFilter = corrected.filters.length === 0 ? resolveSchemaStatusFilter(input, evidence) : undefined;

  if (schemaFilter) {
    return {
      ...corrected,
      filters: [schemaFilter],
      confidence: "high",
      shouldExecute: true,
      evidenceSummary: [
        `Resolved ${schemaFilter.field} := ${schemaFilter.value} from schema facts and endpoint filterControl.`,
      ],
    };
  }

  return corrected.confidence === "blocked"
    ? { ...corrected, shouldExecute: false }
    : corrected;
}

export async function resolveArdenApiFilters(
  input: ArdenApiFiltersInput,
): Promise<ArdenFilterResolution> {
  assertKnownArdenGetRoute(input.path);
  const evidenceRows = await collectFilterEvidence(input);

  if (evidenceRows.length === 0) {
    return makeBlockedResolution(
      input,
      "No indexed code evidence was found for this endpoint.",
    );
  }

  const evidence = formatEvidence(evidenceRows);

  try {
    const resolution = enforceSafeFilterResolution(input, await resolveWithLlm(input, evidence), evidence);

    console.log("*********************");
    console.log(resolution);
    console.log("*********************");
    return {
      ...resolution,
      warnings: [
        ...resolution.warnings,
        `Resolved with ${evidenceRows.length} targeted evidence chunks.`,
      ],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return makeBlockedResolution(
      input,
      `Unable to resolve filters safely: ${detail}`,
    );
  }
}

function deriveRouteTerms(path: string) {
  const routeTail = path.split("/").filter(Boolean).at(-1) ?? path;
  const tokens = routeTail.split(/[^a-z0-9]+/i).filter(Boolean);

  const ignored = new Set(["get", "list", "csv", "data", "all"]);
  const resourceTokens = tokens.filter(
    (token) => !ignored.has(token.toLowerCase()),
  );

  const resource = resourceTokens[0] ?? tokens.at(-1) ?? routeTail;
  const singularResource =
    resource.endsWith("s") && resource.length > 3
      ? resource.slice(0, -1)
      : resource;

  return {
    routeTail,
    resource,
    singularResource,
  };
}

function buildEvidenceQueries(input: ArdenApiFiltersInput) {
  const { routeTail, resource, singularResource } = deriveRouteTerms(
    input.path,
  );
  const resourceTypeName = resource.charAt(0).toUpperCase() + resource.slice(1);
  const singularTypeName = singularResource.charAt(0).toUpperCase() + singularResource.slice(1);

  return [
    `${routeTail} filterControl`,
    `${resource} filterControl`,
    `${singularResource} filterControl`,
    `${routeTail} sortControl`,
    `${routeTail} FilterParams`,
    `${resource} FilterParams`,
    `${input.query} filterControl`,
    `${input.query} FilterParams`,
    `generateSearchQuery getQueryKeys q parameter`,
    `Schema.${resourceTypeName}`,
    `Schema.${singularTypeName}`,
    `${resource} status enum`,
    `${singularResource} status enum`,
  ];
}

async function collectFilterEvidence(input: ArdenApiFiltersInput) {
  const route = assertKnownArdenGetRoute(input.path);
  const evidenceQueries = buildEvidenceQueries(input);

  const searches = evidenceQueries.flatMap((evidenceQuery) => [
    searchCode(evidenceQuery, {
      topK: 5,
      repos: ["arden-admin"],
    }),
    searchCode(evidenceQuery, {
      topK: 5,
      repos: ["arden-server"],
    }),
  ]);

  const qdrantResults = (await Promise.all(searches)).flat();
  const githubResults = await searchGitHubFilterEvidence(input, qdrantResults, {
    filePath: route.sourceFile,
    line: route.sourceLine,
  });

  const results = [...githubResults, ...qdrantResults];

  return rerankEvidence(results);
}
function evidenceBoost(row: CodeSearchResult) {
  const content = row.content.toLowerCase();
  const filePath = row.filePath.toLowerCase();

  let boost = 0;

  if (content.includes("filtercontrol")) boost += 0.45;
  if (content.includes("extracted schema facts")) boost += 0.5;
  if (row.kind === "github-file") boost += 0.2;
  if (content.includes("sortcontrol")) boost += 0.3;
  if (content.includes("filterparams")) boost += 0.3;
  if (content.includes("generatesearchquery")) boost += 0.25;

  if (filePath.startsWith("server/") || filePath.includes("/server/")) {
    boost += 0.25;
  }

  return boost;
}

function rerankEvidence(results: CodeSearchResult[]): RankedEvidence[] {
  const seen = new Set<string>();

  return results
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => {
      const boost = evidenceBoost(row);
      return {
        ...row,
        boost,
        boostedScore: row.score + boost,
      };
    })
    .sort((left, right) => right.boostedScore - left.boostedScore)
    .slice(0, 16);
}

function formatEvidence(rows: RankedEvidence[]) {
  return rows
    .map((row, index) => {
      const source = row.kind === "github-file" ? "GitHub live source" : "Qdrant indexed chunk";
      return [
        `Evidence ${index + 1}`,
        `Source: ${source}`,
        `Repo: ${row.repo}`,
        `File: ${row.filePath}`,
        `Name: ${row.name}`,
        `Score: ${row.score}`,
        `Boost: ${row.boost}`,
        `Boosted score: ${row.boostedScore}`,
        "Content:",
        "```",
        row.content.slice(0, 3_500),
        "```",
      ].join("\n");
    })
    .join("\n\n---\n\n");
}
