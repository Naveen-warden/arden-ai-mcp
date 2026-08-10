import { searchCode } from "../codeChunks";
import { OPENAI_API_KEY, OPENAI_EXPLAINER_MODEL } from "../environment";
import { searchSemanticContext } from "../semanticContext";
import type {
  CodebaseExplanation,
  CodebaseExplanationInput,
  QdrantCodeEvidence,
} from "./types";

const MAX_CONTEXT_CHARS = 24_000;
const MAX_CHUNK_CHARS = 4_000;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... truncated ...`;
}

function redactSecrets(value: string) {
  return value
    .replace(/(api[_-]?key\s*[:=]\s*)["']?[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)["']?[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)["']?[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)["']?[^"'\s,}]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[REDACTED]");
}

function audienceRules(input: CodebaseExplanationInput) {
  if (input.audience === "developer") {
    return `The user is a developer. Explain control flow, data flow, important functions/classes/components, state transitions, validation, side effects, and likely extension points. You may mention module names and implementation details. Quote only short code fragments when necessary; do not dump whole chunks.`;
  }

  if (input.audience === "admin" || input.audience === "operator") {
    return `The user is an admin/operator. Explain the operational workflow, what screens/actions are involved, what system state changes, validations, exceptions, and safe next actions. Do not expose file paths, route paths, source snippets, function names, database schema internals, or low-level implementation details.`;
  }

  if (input.audience === "support") {
    return `The user is support. Explain the behavior in customer-friendly language, likely causes, what to verify, what evidence to collect, and what to tell the customer. Do not expose file paths, route paths, source snippets, function names, database schema internals, or low-level implementation details.`;
  }

  return `The user is a business user. Explain in plain language: what the feature does, why it exists, the practical workflow, and what outcomes to expect. Do not expose file paths, route paths, source snippets, function names, database schema internals, or low-level implementation details.`;
}

function responseModeRules(input: CodebaseExplanationInput) {
  switch (input.responseMode ?? "workflow") {
    case "overview":
      return "Answer as a concise product/technical overview: purpose, main actors, main lifecycle, and important constraints.";
    case "troubleshooting":
      return "Answer as troubleshooting guidance: expected behavior, common failure points, checks to perform, safe fixes/workarounds, and what remains uncertain.";
    case "developer_trace":
      return "Answer as an implementation trace: entry point, internal calls, data read/writes, validations, side effects, and exit/result. If audience is not developer, translate this into non-code workflow language.";
    case "change_impact":
      return "Answer as change-impact analysis: affected modules, behavior that can regress, data/live-operation risks, and tests or checks to run.";
    case "workflow":
    default:
      return "Answer as a workflow explanation: trigger, steps in order, decisions/branches, resulting state, and next actions.";
  }
}

function requiredAnswerShape(input: CodebaseExplanationInput) {
  if (input.audience === "developer") {
    return [
      "Use this answer shape:",
      "1. Direct answer in 1-2 sentences.",
      "2. Implementation flow in ordered steps.",
      "3. Important conditions, validations, side effects, and edge cases found in evidence.",
      "4. Source confidence: say whether evidence is strong, partial, or missing and why.",
      "5. If useful, give test/debug checks. Avoid broad generic advice.",
    ].join("\n");
  }

  return [
    "Use this answer shape:",
    "1. Direct answer in plain language.",
    "2. How the workflow behaves in ordered steps.",
    "3. Important rules, exceptions, or statuses the user should know.",
    "4. Safe next actions or checks.",
    "5. If evidence is incomplete, say what is uncertain without exposing internal code details.",
  ].join("\n");
}

function formatCodeContext(evidence: QdrantCodeEvidence[]) {
  let usedChars = 0;
  const sections: string[] = [];

  for (const item of evidence) {
    const content = truncate(item.content, MAX_CHUNK_CHARS);
    const section = [
      `Repo: ${item.repo}`,
      `Module: ${item.module}`,
      `Name: ${item.name}`,
      `File: ${item.filePath}`,
      `Score: ${item.score}`,
      "Code chunk:",
      "```",
      content,
      "```",
    ].join("\n");

    if (usedChars + section.length > MAX_CONTEXT_CHARS) break;

    usedChars += section.length;
    sections.push(section);
  }

  return sections.join("\n\n---\n\n");
}

function fallbackAnswer(input: CodebaseExplanationInput, evidence: QdrantCodeEvidence[]) {
  const modules = uniqueValues(evidence.map((item) => item.module));
  const repos = uniqueValues(evidence.map((item) => item.repo));

  return [
    `I found ${evidence.length} relevant code chunks in ${repos.join(", ") || "the indexed codebase"}.`,
    modules.length ? `The strongest matches are around: ${modules.join(", ")}.` : "No clear module grouping was available from the indexed chunks.",
    "OpenAI synthesis was skipped because `OPENAI_API_KEY` is not configured, so this is a retrieval summary rather than a generated explanation.",
    `Question: ${input.query}`,
  ].join("\n\n");
}

async function generateOpenAiAnswer(
  input: CodebaseExplanationInput,
  codeContext: string,
  semanticContext: string,
) {
  if (!OPENAI_API_KEY) return undefined;

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EXPLAINER_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You explain Arden product and engineering behavior using indexed source-code chunks as private evidence.",
            "Use the code chunks as the source of truth, and use semantic context only for product framing.",
            "Prefer source-grounded specifics over generic SaaS explanations. Extract actual sequence, checks, statuses, permissions, side effects, and relationships from the evidence.",
            "When chunks disagree, favor more specific chunks over broad docs/config chunks and state uncertainty if needed.",
            audienceRules(input),
            responseModeRules(input),
            requiredAnswerShape(input),
            "If the evidence is incomplete, say what is clear and what is uncertain. Do not invent behavior.",
            "Do not mention that you are reading Qdrant unless the user asks about the architecture.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Question: ${input.query}`,
            `Requested answer mode: ${input.responseMode ?? "workflow"}`,
            semanticContext ? `Semantic framing:\n${semanticContext}` : "Semantic framing: none requested or no matches found.",
            `Indexed code chunks:\n${codeContext}`,
            "Write the best source-grounded role-specific explanation for the user. Do not reveal private evidence to non-developer audiences.",
          ].join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI explanation failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return json.choices?.[0]?.message?.content?.trim();
}

export async function explainFromQdrantCodeChunks(
  input: CodebaseExplanationInput,
): Promise<CodebaseExplanation> {
  const warnings: string[] = [];
  const [codeRows, semanticRows] = await Promise.all([
    searchCode(input.query, {
      topK: input.topK,
      repos: input.repos,
      ...(input.profile ? { profile: input.profile } : {}),
    }),
    input.includeSemanticContext
      ? searchSemanticContext(input.query, {
          topK: 5,
          audience: input.audience,
          ...(input.productArea ? { productArea: input.productArea } : {}),
        })
      : Promise.resolve([]),
  ]);

  const codeEvidence = codeRows.map((row): QdrantCodeEvidence => ({
    id: row.id,
    repo: row.repo === "arden-admin" ? "arden-admin" : "arden-server",
    score: row.score,
    module: row.module,
    filePath: row.filePath,
    name: row.name,
    content: redactSecrets(row.content),
  }));

  if (codeEvidence.length === 0) {
    warnings.push(
      "No code chunks were returned from the Qdrant code collection. The source collection may need to be indexed or refreshed.",
    );
  }

  const semanticContext = semanticRows
    .map((row) =>
      [
        `Area: ${row.productArea}`,
        `Capability: ${row.capability}`,
        `Summary: ${row.plainSummary}`,
        `Guidance: ${row.responseGuidance}`,
      ].join("\n"),
    )
    .join("\n\n");

  const codeContext = formatCodeContext(codeEvidence);
  const generatedAnswer = codeContext
    ? await generateOpenAiAnswer(input, codeContext, semanticContext)
    : undefined;

  if (!generatedAnswer && !OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY is not configured, so a retrieval-only fallback answer was returned.");
  }

  const includeRawEvidence = input.includeEvidence && input.audience === "developer";

  if (input.includeEvidence && input.audience !== "developer") {
    warnings.push("Raw code evidence is only returned for developer audience.");
  }

  return {
    query: input.query,
    audience: input.audience,
    answer: generatedAnswer ?? fallbackAnswer(input, codeEvidence),
    sourceCoverage: {
      repos: input.repos,
      codeEvidenceCount: codeEvidence.length,
      semanticContextCount: semanticRows.length,
      modules: uniqueValues(codeEvidence.map((item) => item.module)),
    },
    ...(includeRawEvidence
      ? {
          evidence: codeEvidence.map((item) => ({
            repo: item.repo,
            filePath: item.filePath,
            name: item.name,
            module: item.module,
            score: item.score,
            content: truncate(item.content, MAX_CHUNK_CHARS),
          })),
        }
      : {}),
    warnings,
  };
}
