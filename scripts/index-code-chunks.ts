import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { MDocument } from "@mastra/rag";

import { chunkSourceFile, embedTexts } from "../src/codeChunks";
import { qdrantRestCollectionExists, qdrantRestRequest } from "../src/database";
import { QDRANT_COLLECTION } from "../src/environment";
import type { CodeRepository, CodeSearchProfile } from "../src/codeChunks";

const EMBEDDING_SIZE = 384;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const DEFAULT_DOC_EXTENSIONS = new Set([".md", ".mdx", ".json"]);
const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "public",
]);
const EXCLUDED_FILES = new Set(["package-lock.json", "tsconfig.tsbuildinfo"]);

type RepoConfig = {
  repo: CodeRepository;
  root: string;
};

type IndexableChunk = {
  id: string;
  repo: CodeRepository;
  kind: string;
  module: string;
  filePath: string;
  name: string;
  content: string;
  profiles: CodeSearchProfile[];
  startLine: number;
  endLine: number;
  chunkStrategy: string;
  sourceHash: string;
};

function formatDuration(startedAt: number) {
  const seconds = Math.round((Date.now() - startedAt) / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));

  return {
    dryRun: args.has("--dry-run"),
    reset: !args.has("--no-reset"),
    includeDocs: !args.has("--code-only"),
    batchSize: Number(process.env.CODE_INDEX_BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
  };
}

function makeUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizePath(value: string) {
  return value.split(path.sep).join("/");
}

function inferDocModule(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts[0] === "docs" || parts[0] === "documentation") {
    return parts.slice(0, 2).join("/") || parts[0];
  }
  return parts.slice(0, 2).join("/") || "docs";
}

function inferDocProfiles(repo: CodeRepository, relativePath: string, content: string) {
  const profiles = new Set<CodeSearchProfile>([repo === "arden-admin" ? "frontend" : "backend"]);
  const haystack = `${relativePath}\n${content}`.toLowerCase();

  if (/booking|reservation/.test(haystack)) profiles.add("booking");
  if (/payment|invoice|receipt|transaction/.test(haystack)) profiles.add("paymentsWorkflow");
  if (/payment.?plan|installment/.test(haystack)) profiles.add("paymentPlan");
  if (/request|ticket|issue/.test(haystack)) profiles.add("request");
  if (/resident|tenant|occupant/.test(haystack)) profiles.add("resident");
  if (/document|kyc|contract|agreement/.test(haystack)) profiles.add("document");
  if (/room|bed|property|occupancy/.test(haystack)) profiles.add("room");
  if (/auth|login|otp|permission|role/.test(haystack)) profiles.add("auth");
  if (/workflow|status|state|transition/.test(haystack)) profiles.add("workflow");
  if (/message|notification|email|sms|whatsapp/.test(haystack)) profiles.add("comms");

  return Array.from(profiles);
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walkFiles(absolutePath);
      continue;
    }

    if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue;

    const extension = path.extname(entry.name);
    if (DEFAULT_CODE_EXTENSIONS.has(extension) || DEFAULT_DOC_EXTENSIONS.has(extension)) {
      yield absolutePath;
    }
  }
}

async function chunkDocumentFile(repoConfig: RepoConfig, filePath: string): Promise<IndexableChunk[]> {
  const content = await fs.readFile(filePath, "utf8");
  const relativePath = normalizePath(path.relative(repoConfig.root, filePath));
  const extension = path.extname(filePath);
  const sourceHash = createHash("sha256").update(content).digest("hex");
  let chunks: Awaited<ReturnType<ReturnType<typeof MDocument.fromText>["chunk"]>>;

  try {
    const doc = extension === ".json" ? MDocument.fromJSON(content) : MDocument.fromMarkdown(content);
    chunks = await doc.chunk({
      strategy: extension === ".json" ? "json" : "markdown",
      maxSize: 2_500,
      overlap: 150,
      addStartIndex: true,
    });
  } catch {
    chunks = await MDocument.fromText(content).chunk({
      strategy: "recursive",
      maxSize: 2_500,
      overlap: 150,
      addStartIndex: true,
    });
  }

  return chunks.map((chunk, index) => ({
    id: makeUuid([repoConfig.repo, relativePath, "doc", String(index)].join("|")),
    repo: repoConfig.repo,
    kind: "document_chunk",
    module: inferDocModule(relativePath),
    filePath: relativePath,
    name: `${relativePath}#${index + 1}`,
    content: chunk.text,
    profiles: inferDocProfiles(repoConfig.repo, relativePath, chunk.text),
    startLine: 1,
    endLine: content.split("\n").length,
    chunkStrategy: "mastra-document",
    sourceHash,
  }));
}

async function chunkFile(repoConfig: RepoConfig, filePath: string, includeDocs: boolean) {
  const extension = path.extname(filePath);

  if (DEFAULT_CODE_EXTENSIONS.has(extension)) {
    const content = await fs.readFile(filePath, "utf8");
    return chunkSourceFile({
      repo: repoConfig.repo,
      repoRoot: repoConfig.root,
      filePath,
      content,
    });
  }

  if (includeDocs && DEFAULT_DOC_EXTENSIONS.has(extension)) {
    return chunkDocumentFile(repoConfig, filePath);
  }

  return [];
}

async function upsertChunks(chunks: IndexableChunk[], batchSize: number) {
  const startedAt = Date.now();
  const totalBatches = Math.ceil(chunks.length / batchSize);

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    const completedBeforeBatch = offset;
    const progressBeforeBatch = Math.floor((completedBeforeBatch / chunks.length) * 100);

    console.log(
      `[${batchNumber}/${totalBatches}] embedding ${batch.length} chunks (${completedBeforeBatch}/${chunks.length}, ${progressBeforeBatch}%)`,
    );
    const embedStartedAt = Date.now();
    const vectors = await embedTexts(
      batch.map((chunk) =>
        [chunk.repo, chunk.module, chunk.kind, chunk.name, chunk.profiles.join(" "), chunk.content].join("\n"),
      ),
    );
    console.log(`[${batchNumber}/${totalBatches}] embedded in ${formatDuration(embedStartedAt)}`);

    const upsertStartedAt = Date.now();
    await withRetry(() =>
      qdrantRestRequest(
        "PUT",
        `/collections/${encodeURIComponent(QDRANT_COLLECTION)}/points?wait=true`,
        {
          points: batch.map((chunk, index) => ({
            id: chunk.id,
            vector: vectors[index],
            payload: {
              ...chunk,
              indexedAt: new Date().toISOString(),
            },
          })),
        },
      ),
    );
    const completed = Math.min(offset + batch.length, chunks.length);
    const progress = Math.floor((completed / chunks.length) * 100);
    console.log(
      `[${batchNumber}/${totalBatches}] uploaded in ${formatDuration(upsertStartedAt)} (${completed}/${chunks.length}, ${progress}%, elapsed ${formatDuration(startedAt)})`,
    );
  }
}

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }

  throw lastError;
}

async function createPayloadIndex(fieldName: string, fieldSchema: string) {
  await withRetry(() =>
    qdrantRestRequest(
      "PUT",
      `/collections/${encodeURIComponent(QDRANT_COLLECTION)}/index?wait=true`,
      { field_name: fieldName, field_schema: fieldSchema },
    ),
  );
}

async function ensureCodeCollectionForIndexing() {
  if (!(await qdrantRestCollectionExists(QDRANT_COLLECTION))) {
    await withRetry(() =>
      qdrantRestRequest("PUT", `/collections/${encodeURIComponent(QDRANT_COLLECTION)}`, {
        vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
      }),
    );
  }

  await Promise.all([
    createPayloadIndex("repo", "keyword"),
    createPayloadIndex("profiles", "keyword"),
    createPayloadIndex("kind", "keyword"),
    createPayloadIndex("module", "keyword"),
    createPayloadIndex("filePath", "keyword"),
  ]);
}

async function main() {
  const args = parseArgs();
  const repos: RepoConfig[] = [
    {
      repo: "arden-server",
      root: process.env.ARDEN_SERVER_SOURCE_PATH ?? "/Users/naveen/Desktop/arden-server",
    },
    {
      repo: "arden-admin",
      root: process.env.ARDEN_ADMIN_SOURCE_PATH ?? "/Users/naveen/Desktop/arden-admin",
    },
  ];
  const chunks: IndexableChunk[] = [];

  for (const repoConfig of repos) {
    console.log(`Scanning ${repoConfig.repo}: ${repoConfig.root}`);
    const repoStartedAt = Date.now();
    let fileCount = 0;
    let repoChunkCount = 0;

    for await (const filePath of walkFiles(repoConfig.root)) {
      fileCount += 1;
      const fileChunks = await chunkFile(repoConfig, filePath, args.includeDocs);
      repoChunkCount += fileChunks.length;
      chunks.push(...fileChunks);

      if (fileCount % 250 === 0) {
        console.log(
          `Scanned ${repoConfig.repo}: ${fileCount} files, ${repoChunkCount} chunks (${formatDuration(repoStartedAt)})`,
        );
      }
    }

    console.log(
      `Finished ${repoConfig.repo}: ${fileCount} files, ${repoChunkCount} chunks (${formatDuration(repoStartedAt)})`,
    );
  }

  console.log(`Code collection: ${QDRANT_COLLECTION}`);
  console.log(`Chunks: ${chunks.length}`);
  console.log(`Reset collection: ${args.reset ? "yes" : "no"}`);
  console.log(`Dry run: ${args.dryRun ? "yes" : "no"}`);

  if (args.dryRun) return;

  if (args.reset) {
    if (await qdrantRestCollectionExists(QDRANT_COLLECTION)) {
      console.log(`Deleting existing collection: ${QDRANT_COLLECTION}`);
      await withRetry(() =>
        qdrantRestRequest("DELETE", `/collections/${encodeURIComponent(QDRANT_COLLECTION)}`),
      );
    }
  }

  console.log(`Ensuring collection and payload indexes: ${QDRANT_COLLECTION}`);
  await ensureCodeCollectionForIndexing();
  console.log(`Starting local BGE embedding and Qdrant upload with batch size ${args.batchSize}`);
  await upsertChunks(chunks, args.batchSize);
  console.log(`Indexed ${chunks.length} chunks into ${QDRANT_COLLECTION}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
