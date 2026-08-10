import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import type Parser from "tree-sitter";

import type { CodeRepository, CodeSearchProfile } from "./types";

const require = createRequire(import.meta.url);
const ParserConstructor = require("tree-sitter") as typeof import("tree-sitter");
const typeScriptLanguages = require("tree-sitter-typescript") as {
  typescript: unknown;
  tsx: unknown;
};

const MAX_NODE_CHARS = 7_000;
const MIN_NODE_CHARS = 80;
const IMPORT_CONTEXT_MAX_CHARS = 2_500;
const fallbackBoundaryTypes = new Set([
  "class_declaration",
  "function_declaration",
  "method_definition",
  "public_field_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
  "variable_declaration",
  "export_statement",
  "expression_statement",
]);

export type SourceFileInput = {
  repo: CodeRepository;
  repoRoot: string;
  filePath: string;
  content: string;
};

export type CodeChunk = {
  id: string;
  repo: CodeRepository;
  kind: string;
  module: string;
  filePath: string;
  language: "typescript" | "tsx" | "javascript" | "jsx";
  name: string;
  content: string;
  profiles: CodeSearchProfile[];
  startLine: number;
  endLine: number;
  chunkStrategy: "tree-sitter" | "fallback";
  sourceHash: string;
};

function normalizePath(value: string) {
  return value.split(path.sep).join("/");
}

function makeId(parts: string[]) {
  const bytes = createHash("sha256").update(parts.join("|")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function inferLanguage(filePath: string): CodeChunk["language"] {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "javascript";
  return "typescript";
}

function makeParser(language: CodeChunk["language"]) {
  const parser = new ParserConstructor();
  parser.setLanguage(
    language === "tsx" || language === "jsx"
      ? typeScriptLanguages.tsx
      : typeScriptLanguages.typescript,
  );
  return parser;
}

function inferModule(repo: CodeRepository, relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  const modulesIndex = parts.indexOf("modules");
  if (modulesIndex >= 0 && parts[modulesIndex + 1]) {
    return `modules/${parts[modulesIndex + 1]}`;
  }

  const srcIndex = parts.indexOf("src");
  if (srcIndex >= 0 && parts[srcIndex + 1]) {
    return `src/${parts[srcIndex + 1]}`;
  }

  if (repo === "arden-admin" && parts[0]) return parts.slice(0, 2).join("/");
  if (repo === "arden-server" && parts[0]) return parts.slice(0, 3).join("/");
  return "unknown";
}

function inferProfiles(repo: CodeRepository, relativePath: string, content: string) {
  const haystack = `${relativePath}\n${content.slice(0, 4_000)}`.toLowerCase();
  const profiles = new Set<CodeSearchProfile>();

  profiles.add(repo === "arden-admin" ? "frontend" : "backend");

  if (/comm|message|notification|email|sms|whatsapp/.test(haystack)) profiles.add("comms");
  if (/payment.?plan|installment|commercial/.test(haystack)) profiles.add("paymentPlan");
  if (/payment|invoice|receipt|transaction|razorpay|stripe/.test(haystack)) profiles.add("paymentsWorkflow");
  if (/custom.?script|script.?context/.test(haystack)) profiles.add("customScript");
  if (/booking|reservation/.test(haystack)) profiles.add("booking");
  if (/request|ticket|issue/.test(haystack)) profiles.add("request");
  if (/resident|tenant|occupant/.test(haystack)) profiles.add("resident");
  if (/document|kyc|contract|agreement/.test(haystack)) profiles.add("document");
  if (/room|bed|property|occupancy/.test(haystack)) profiles.add("room");
  if (/auth|login|otp|permission|role/.test(haystack)) profiles.add("auth");
  if (/workflow|status|state|transition/.test(haystack)) profiles.add("workflow");

  return Array.from(profiles);
}

function getImportContext(root: Parser.SyntaxNode) {
  const imports = root.namedChildren
    .filter((child) => child.type === "import_statement")
    .map((child) => child.text.trim())
    .join("\n");

  if (!imports) return "";
  return imports.length <= IMPORT_CONTEXT_MAX_CHARS
    ? imports
    : `${imports.slice(0, IMPORT_CONTEXT_MAX_CHARS)}\n... imports truncated ...`;
}

function getName(node: Parser.SyntaxNode) {
  const directName = node.childForFieldName("name")?.text;
  if (directName) return directName;

  const declarator = node.descendantsOfType("variable_declarator")[0];
  const declaratorName = declarator?.childForFieldName("name")?.text;
  if (declaratorName) return declaratorName;

  const propertyIdentifier = node.descendantsOfType("property_identifier")[0]?.text;
  if (propertyIdentifier) return propertyIdentifier;

  return node.text.trim().replace(/\s+/g, " ").slice(0, 120);
}

function collectBoundaryNodes(root: Parser.SyntaxNode) {
  const nodes: Parser.SyntaxNode[] = [];

  function visit(node: Parser.SyntaxNode, topLevelBoundary: boolean) {
    const isBoundary = fallbackBoundaryTypes.has(node.type);

    if (isBoundary && node.text.trim().length >= MIN_NODE_CHARS) {
      nodes.push(node);
      if (node.text.length <= MAX_NODE_CHARS || topLevelBoundary) return;
    }

    for (const child of node.namedChildren) visit(child, isBoundary || topLevelBoundary);
  }

  visit(root, false);
  return nodes;
}

function splitOversizedContent(value: string) {
  if (value.length <= MAX_NODE_CHARS) return [value];

  const chunks: string[] = [];
  const step = MAX_NODE_CHARS - 500;
  for (let offset = 0; offset < value.length; offset += step) {
    chunks.push(value.slice(offset, offset + MAX_NODE_CHARS));
  }
  return chunks;
}

function makeChunk(
  input: SourceFileInput,
  relativePath: string,
  language: CodeChunk["language"],
  imports: string,
  node: Parser.SyntaxNode,
  content: string,
  index: number,
): CodeChunk {
  const body = imports ? `${imports}\n\n${content}` : content;
  const sourceHash = createHash("sha256").update(input.content).digest("hex");

  return {
    id: makeId([input.repo, relativePath, String(node.startIndex), String(node.endIndex), String(index)]),
    repo: input.repo,
    kind: node.type,
    module: inferModule(input.repo, relativePath),
    filePath: relativePath,
    language,
    name: getName(node),
    content: body,
    profiles: inferProfiles(input.repo, relativePath, body),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    chunkStrategy: "tree-sitter",
    sourceHash,
  };
}

function makeFallbackChunks(
  input: SourceFileInput,
  relativePath: string,
  language: CodeChunk["language"],
): CodeChunk[] {
  const sourceHash = createHash("sha256").update(input.content).digest("hex");

  return splitOversizedContent(input.content.trim()).map((content, index) => ({
    id: makeId([input.repo, relativePath, "fallback", String(index)]),
    repo: input.repo,
    kind: "source_file",
    module: inferModule(input.repo, relativePath),
    filePath: relativePath,
    language,
    name: relativePath,
    content,
    profiles: inferProfiles(input.repo, relativePath, content),
    startLine: 1,
    endLine: input.content.split("\n").length,
    chunkStrategy: "fallback",
    sourceHash,
  }));
}

export function chunkSourceFile(input: SourceFileInput): CodeChunk[] {
  const relativePath = normalizePath(path.relative(input.repoRoot, input.filePath));
  const language = inferLanguage(relativePath);
  let tree: Parser.Tree;

  try {
    const parser = makeParser(language);
    tree = parser.parse(input.content);
  } catch {
    return makeFallbackChunks(input, relativePath, language);
  }

  const imports = getImportContext(tree.rootNode);
  const nodes = collectBoundaryNodes(tree.rootNode);
  const chunks: CodeChunk[] = [];

  for (const node of nodes) {
    const parts = splitOversizedContent(node.text.trim());
    parts.forEach((part, index) => {
      chunks.push(makeChunk(input, relativePath, language, imports, node, part, index));
    });
  }

  if (chunks.length > 0) return chunks;

  return makeFallbackChunks(input, relativePath, language);
}
