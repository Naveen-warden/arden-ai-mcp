import { posix as path } from "node:path";

import type { CodeSearchResult } from "../codeChunks";
import { githubMcp } from "../mastra/mcp/github-mcp-client";

const GITHUB_REPOS = {
  "arden-server": {
    owner: "citizenTwo",
    repo: "arden-server",
    branch: "master",
  },
  "arden-admin": {
    owner: "jarvaibhavraj",
    repo: "arden-admin",
    branch: "main",
  },
  "arden-website": {
    owner: "jarvaibhavraj",
    repo: "arden-website",
    branch: "main",
  },
} as const;

const MAX_RESULTS = 8;
const fileCache = new Map<string, { repo: KnownGithubRepo; path: string; content: string }>();

export type KnownGithubRepo = keyof typeof GITHUB_REPOS;
type GitHubTool = { execute: (input: Record<string, unknown>) => Promise<unknown> };

type FilterEvidenceInput = {
  query: string;
  path: string;
};

type RouteSource = {
  filePath: string;
  line?: number;
};

function payload(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (record.structuredContent) return record.structuredContent;

  const content = record.content;
  if (!Array.isArray(content)) return result;

  const text = content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = (item as Record<string, unknown>).text;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean)
    .join("\n");

  if (!text) return result;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function decodeContent(result: unknown) {
  const data = payload(result);
  if (!data || typeof data !== "object") return "";

  const record = data as Record<string, unknown>;
  const content = record.data ?? record.content ?? record.text;

  if (content instanceof ArrayBuffer) return Buffer.from(content).toString("utf8");
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("utf8");
  }
  if (Array.isArray(content)) return Buffer.from(content).toString("utf8");

  if (typeof content !== "string") return "";

  if (record.encoding === "base64") {
    try {
      const decoded = Buffer.from(content, "base64").toString("utf8");
      return isLikelyText(decoded) ? decoded : content;
    } catch {
      return content;
    }
  }

  return content;
}

function isLikelyText(value: string) {
  if (!value) return false;

  const sample = value.slice(0, 1_000);
  const replacementChars = (sample.match(/�/g) ?? []).length;
  const controlChars = (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;

  return replacementChars + controlChars < Math.max(3, sample.length * 0.05);
}

function pathVariants(repo: KnownGithubRepo, filePath: string) {
  const config = GITHUB_REPOS[repo];
  const cleanPath = filePath.replace(/^\/+/, "");
  const baseVariants = [
    cleanPath,
    cleanPath.replace(new RegExp(`^${repo}/`), ""),
    cleanPath.replace(new RegExp(`^${config.repo}/`), ""),
  ];

  return Array.from(
    new Set(
      baseVariants
        .filter(Boolean)
        .flatMap((variant) => {
          if (/\.[a-z0-9]+$/i.test(variant)) return [variant];
          return [`${variant}.ts`, `${variant}.tsx`, path.join(variant, "index.ts")];
        }),
    ),
  );
}

async function getGithubTools() {
  const toolsets = await githubMcp.listToolsets();
  return toolsets.github as Record<string, GitHubTool | undefined> | undefined;
}

export async function fetchGitHubCodeChunk(repo: KnownGithubRepo, filePath: string) {
  const cacheKey = `${repo}:${filePath}`;
  const cached = fileCache.get(cacheKey);
  if (cached) return cached;

  const githubTools = await getGithubTools();
  const getFileContents = githubTools?.get_file_contents;
  if (!getFileContents) return undefined;

  const config = GITHUB_REPOS[repo];

  for (const path of pathVariants(repo, filePath)) {
    try {
      const content = decodeContent(
        await getFileContents.execute({
          owner: config.owner,
          repo: config.repo,
          path,
          branch: config.branch,
        }),
      );

      if (content.trim()) {
        const chunk = { repo, path, content };
        fileCache.set(cacheKey, chunk);
        fileCache.set(`${repo}:${path}`, chunk);
        return chunk;
      }
    } catch {
      // Try the next path variant before giving up.
    }
  }

  return undefined;
}

const CHUNK_HINTS = [
  "filterControl",
  "FilterParams",
  "generateSearchQuery",
  "getQueryKeys",
  "defaultParamValidators",
  "validator",
  "enum",
  "constants",
  "filter",
  "Schema.",
  "use",
];

export function queryTerms(query: string) {
  const ignored = new Set(["fetch", "get", "give", "list", "me", "show", "the", "with"]);
  return query
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length > 2 && !ignored.has(term.toLowerCase()));
}

function routeTermsFromApiPath(apiPath: string) {
  const tail = apiPath.split("/").filter(Boolean).at(-1) ?? apiPath;
  const tokens = tail.split(/[^a-z0-9]+/i).filter(Boolean);
  const ignored = new Set(["get", "list", "all", "data", "csv"]);
  const useful = tokens.filter((token) => !ignored.has(token.toLowerCase()));
  const resource = useful[0] ?? tokens.at(-1) ?? tail;
  const singular = resource.endsWith("s") && resource.length > 3 ? resource.slice(0, -1) : resource;

  return { resource, singular };
}

function pascalCase(value: string) {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function backendUseCasePath(apiPath: string) {
  const { resource, singular } = routeTermsFromApiPath(apiPath);
  return `src/use-cases/${singular}/makeGet${pascalCase(resource)}.ts`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractStringUnionValues(content: string) {
  const unions = new Map<string, string[]>();
  const matches = content.matchAll(/export\s+type\s+([A-Za-z][A-Za-z0-9_]*)\s*=([\s\S]*?);/g);

  for (const match of matches) {
    const typeName = match[1];
    const body = match[2] ?? "";
    const values = Array.from(body.matchAll(/["']([^"']+)["']/g)).map((valueMatch) => valueMatch[1]);
    if (typeName && values.length > 0) unions.set(typeName, Array.from(new Set(values)));
  }

  return unions;
}

function extractEntitySnippet(content: string, entityName: string) {
  const startMatch = new RegExp(
    `export\\s+(?:type|interface)\\s+${escapeRegExp(entityName)}\\b`,
  ).exec(content);
  if (!startMatch?.index && startMatch?.index !== 0) return undefined;

  const start = startMatch.index;
  const rest = content.slice(start + startMatch[0].length);
  const nextExport = rest.search(/\n\s*export\s+(?:type|interface|enum)\s+[A-Za-z][A-Za-z0-9_]*/);
  const end = nextExport === -1 ? start + 8_000 : start + startMatch[0].length + nextExport;

  return content.slice(start, Math.min(content.length, end));
}

export function extractSchemaFacts(content: string, input: FilterEvidenceInput) {
  const unions = extractStringUnionValues(content);
  if (unions.size === 0) return "";

  const { resource, singular } = routeTermsFromApiPath(input.path);
  const entityNames = Array.from(
    new Set([
      pascalCase(singular),
      pascalCase(resource),
      ...queryTerms(input.query).map(pascalCase),
    ].filter(Boolean)),
  );
  const requestedValues = queryTerms(input.query).map((term) => term.toLowerCase());
  const lines: string[] = [];

  for (const entityName of entityNames) {
    const snippet = extractEntitySnippet(content, entityName);
    if (!snippet) continue;

    const fields = Array.from(
      snippet.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\??:\s*([A-Za-z][A-Za-z0-9_]*)\b/gm),
    )
      .map((match) => ({ field: match[1] ?? "", typeName: match[2] ?? "" }))
      .filter(({ field, typeName }) => field && typeName && unions.has(typeName));

    const statusFields = fields.filter(
      ({ field, typeName }) => /status/i.test(field) || /status/i.test(typeName),
    );

    for (const { field, typeName } of statusFields) {
      const values = unions.get(typeName) ?? [];
      lines.push(`${entityName}.${field} uses ${typeName} values: ${values.join(", ")}`);
    }

    for (const requestedValue of requestedValues) {
      for (const { field, typeName } of statusFields) {
        const values = unions.get(typeName) ?? [];
        const exactValue = values.find((value) => value.toLowerCase() === requestedValue);
        if (exactValue) lines.push(`Requested value ${exactValue} is accepted by ${entityName}.${field} (${typeName}).`);
        if (!exactValue) lines.push(`Requested value ${requestedValue} is not accepted by ${entityName}.${field} (${typeName}).`);
      }
    }
  }

  if (lines.length === 0) return "";

  return [
    "Extracted Schema Facts",
    "Use these parsed facts as exact enum/value evidence from the schema file.",
    ...Array.from(new Set(lines)).map((line) => `- ${line}`),
  ].join("\n");
}

async function appendSchemaEvidence(
  rows: CodeSearchResult[],
  seen: Set<string>,
  input: FilterEvidenceInput,
) {
  const hints = [...queryTerms(input.query), ...CHUNK_HINTS];
  const chunk = await fetchGitHubCodeChunk("arden-admin", "types/schema");
  if (!chunk) return;

  const schemaFacts = extractSchemaFacts(chunk.content, input);
  if (schemaFacts) {
    rows.push({
      id: `github-schema-facts:arden-admin:${chunk.path}`,
      score: 0.98,
      repo: "arden-admin",
      kind: "github-file",
      module: "types",
      filePath: chunk.path,
      name: "schema facts",
      content: schemaFacts,
      profiles: [],
    });
  }

  rows.push(toCodeSearchResult("arden-admin", chunk.path, chunk.content, undefined, hints));
  seen.add("arden-admin:types/schema");
  seen.add(`arden-admin:${chunk.path}`);
}

async function appendBackendUseCaseEvidence(
  rows: CodeSearchResult[],
  seen: Set<string>,
  input: FilterEvidenceInput,
  hints: string[],
) {
  const filePath = backendUseCasePath(input.path);
  const key = `arden-server:${filePath}`;
  if (seen.has(key)) return;

  const chunk = await fetchGitHubCodeChunk("arden-server", filePath);
  if (!chunk) return;

  rows.push(toCodeSearchResult("arden-server", chunk.path, chunk.content, undefined, hints));
  seen.add(key);
  seen.add(`arden-server:${chunk.path}`);
}

function resolveImportPath(filePath: string, importPath: string) {
  if (!importPath.startsWith(".")) return undefined;

  return path.normalize(path.join(path.dirname(filePath), importPath));
}

function relativeImportPaths(filePath: string, content: string) {
  const imports = Array.from(
    content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g),
  )
    .map((match) => resolveImportPath(filePath, match[1] ?? ""))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(imports));
}

async function appendResourceImportChunks(
  rows: CodeSearchResult[],
  seen: Set<string>,
  repo: KnownGithubRepo,
  filePath: string,
  content: string,
  apiPath: string,
  hints: string[] = CHUNK_HINTS,
) {
  const { resource, singular } = routeTermsFromApiPath(apiPath);
  const terms = [resource, singular].map((term) => term.toLowerCase());
  const imports = relativeImportPaths(filePath, content)
    .filter((importPath) => terms.some((term) => importPath.toLowerCase().includes(term)))
    .slice(0, 3);

  for (const importPath of imports) {
    const key = `${repo}:${importPath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const chunk = await fetchGitHubCodeChunk(repo, importPath);
    if (!chunk) continue;

    rows.push(
      toCodeSearchResult(repo, chunk.path, chunk.content, undefined, hints),
    );

    if (rows.length >= MAX_RESULTS) break;
  }
}

function lineForHints(content: string, hints: string[]) {
  const lines = content.split("\n");
  const lowerHints = hints
    .map((hint) => hint.toLowerCase())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const hint of lowerHints) {
    const index = lines.findIndex((line) => line.toLowerCase().includes(hint));
    if (index !== -1) return index + 1;
  }

  return undefined;
}

export function chunkGitHubContent(content: string, line?: number, hints: string[] = []) {
  const centerLine = line ?? lineForHints(content, hints);
  if (!centerLine) return content.slice(0, 4_000);

  const lines = content.split("\n");
  const start = Math.max(0, centerLine - 60);
  const selected: string[] = [];
  let usedChars = 0;

  for (let index = start; index < lines.length; index += 1) {
    const next = `${index + 1}: ${lines[index]}`;
    if (usedChars + next.length > 4_000) break;
    selected.push(next);
    usedChars += next.length;
  }

  return selected.join("\n");
}

function toCodeSearchResult(
  repo: KnownGithubRepo,
  filePath: string,
  content: string,
  line?: number,
  hints: string[] = [],
): CodeSearchResult {
  return {
    id: `github:${repo}:${filePath}`,
    score: 0.9,
    repo,
    kind: "github-file",
    module: filePath.split("/").at(-2) ?? "unknown",
    filePath,
    name: filePath.split("/").at(-1) ?? filePath,
    content: chunkGitHubContent(content, line, hints),
    profiles: [],
  };
}

export async function searchGitHubFilterEvidence(
  input: FilterEvidenceInput,
  _qdrantRows: CodeSearchResult[],
  routeSource?: RouteSource,
) {
  try {
    const rows: CodeSearchResult[] = [];
    const seen = new Set<string>();
    const hints = [...queryTerms(input.query), ...CHUNK_HINTS];

    if (routeSource?.filePath) {
      const chunk = await fetchGitHubCodeChunk("arden-server", routeSource.filePath);
      if (chunk) {
        rows.push(
          toCodeSearchResult("arden-server", chunk.path, chunk.content, routeSource.line, hints),
        );
        seen.add(`arden-server:${routeSource.filePath}`);
        seen.add(`arden-server:${chunk.path}`);
        await appendResourceImportChunks(rows, seen, "arden-server", chunk.path, chunk.content, input.path, hints);
      }
    }

    await appendBackendUseCaseEvidence(rows, seen, input, hints);
    await appendSchemaEvidence(rows, seen, input);

    return rows;
  } catch (error) {
    console.warn("GitHub filter evidence skipped", error);
    return [];
  }
}
