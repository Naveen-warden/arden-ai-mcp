import { z } from "zod";
import { ardenLlmAgent } from "../llm/arden-llm-agent";
import { assertKnownArdenGetRoute } from "./arden-route-catalog";
import { searchCode, type CodeSearchResult } from "../codeChunks";
import { log } from "node:console";
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

//INFO: this is resposible for mainting the filter schema for the custom 'q' parameter ,
//eg:{ field: "displayStatus", operator: ":=", value: { status: "Draft" } }
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
    "Use ONLY the provided indexed code evidence. Do not invent endpoint paths, filter fields, enum values, sort keys, or query params.",
    "Prefer arden-admin evidence for user-facing labels, UI filters, hook parameters,types(Schema.type), constants, and status labels.",
    "Prefer arden-server evidence for API-accepted filters, validators, filter controls, and sort controls.",
    "Distinguish user-facing labels from internal values. Example: a UI label may differ from the API enum value.",
    "Use structured filters for q parameter pieces. Do not put q inside query when the same filter can be represented in filters.",
    "Use page as one-based in the JSON output. The executor converts it to zero-based.",
    "If preferred page size is supplied and no evidence rejects it, use it as perPage.",
    "If the filter mapping is not supported by evidence, set confidence to blocked and shouldExecute to false.",
    "Return only valid JSON matching the schema. Do not include markdown or commentary.",
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
    "- For normal list/latest/newest requests, use page 1 and prefer id desc only if evidence supports id sorting or common list sorting.",
    "- high confidence requires endpoint/filter evidence and value/label evidence.",
    "- medium confidence means route and filter are supported but value evidence is partial.",
    "- low confidence means plausible but weak evidence; shouldExecute should usually be false.",
    "- blocked means do not execute.",
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
    `Indexed code evidence:\n${evidence}`,
  ].join("\n");
}

function queryEntriesToRecord(
  entries: z.infer<typeof ardenLlmQueryEntrySchema>[],
): ArdenFilterResolution["query"] {
  return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
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

  const parsed = ardenLlmFilterResolutionSchema.parse(result.object);
  const normalized = ardenFilterResolutionSchema.parse({
    ...parsed,
    query: queryEntriesToRecord(parsed.query),
  });

  return {
    ...normalized,
    path: input.path,
    shouldExecute:
      normalized.confidence === "blocked" ? false : normalized.shouldExecute,
  };
}

// export async function resolveArdenApiFilters(input: ArdenApiFiltersInput) {
//   await assertKnownArdenGetRoute(input.path);
//   console.error(input);
//   return { status: "success" };
// }
export async function resolveArdenApiFilters(
  input: ArdenApiFiltersInput,
): Promise<ArdenFilterResolution> {
  await assertKnownArdenGetRoute(input.path);
  const evidenceRows = await collectFilterEvidence(input);

  if (evidenceRows.length === 0) {
    return makeBlockedResolution(
      input,
      "No indexed code evidence was found for this endpoint.",
    );
  }

  const evidence = formatEvidence(evidenceRows);

  try {
    const resolution = await resolveWithLlm(input, evidence);

    // console.log("*********************");
    // console.log(resolution);
    // console.log("*********************");
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

  return [
    `${routeTail} filterControl`,
    `${resource} filterControl`,
    `${singularResource} filterControl`,
    `${routeTail} sortControl`,
    `${resource} sortControl`,
    `${routeTail} FilterParams`,
    `${resource} FilterParams`,
    `${singularResource} FilterParams`,
    `${input.query} filterControl`,
    `${input.query} FilterParams`,
    `generateSearchQuery getQueryKeys q parameter`,
  ];
}

async function collectFilterEvidence(input: ArdenApiFiltersInput) {
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

  const results = (await Promise.all(searches)).flat();

  return rerankEvidence(results);
}
//this function helps to re-rank the evidence eg: if a codeChunk contains 'filterControl' function (backend) it gets boosted to 0.45 or the filePath includes 'server/*' (frontend)
//helps to enrich the correct filers of the specific query

function evidenceBoost(row: CodeSearchResult) {
  const content = row.content.toLowerCase();
  const filePath = row.filePath.toLowerCase();

  let boost = 0;

  if (content.includes("filtercontrol")) boost += 0.45;
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
    .map((row, index) =>
      [
        `Evidence ${index + 1}`,
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
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
