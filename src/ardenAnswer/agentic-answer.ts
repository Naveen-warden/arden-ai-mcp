import { explainFromQdrantCodeChunks } from "../codebaseExplainer";
import type { CodebaseExplainerRepo } from "../codebaseExplainer";
import type { CodeSearchProfile } from "../codeChunks";
import { OPENAI_API_KEY, OPENAI_EXPLAINER_MODEL } from "../environment";
import { compactArdenData } from "../liveData";
import {
  ardenGet,
  resolveArdenRoutes,
  type ArdenAppScope,
  type ArdenQueryValue,
} from "../rest";
import { searchSemanticContext, type SemanticContextAudience } from "../semanticContext";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

type ResponseMode = "overview" | "workflow" | "troubleshooting" | "developer_trace" | "change_impact";

export type AgenticArdenAnswerInput = {
  query: string;
  audience: SemanticContextAudience;
  appScope: ArdenAppScope;
  allowLiveData: boolean;
  includeRawLiveData: boolean;
  includeDeveloperEvidence: boolean;
  responseMode?: ResponseMode;
  repos?: CodebaseExplainerRepo[];
  profile?: CodeSearchProfile;
  productArea?: string;
  maxLiveRecords: number;
};

export type AgenticArdenAnswer = {
  query: string;
  audience: SemanticContextAudience;
  answer: string;
  plan: {
    intent: "semantic" | "code" | "live_data" | "hybrid";
    responseMode: ResponseMode;
    usedTools: string[];
    reasoning: string;
  };
  coverage: {
    codeEvidenceCount: number;
    semanticContextCount: number;
    liveDataFetched: boolean;
    liveDataRecordCount?: number;
    modules: string[];
  };
  liveData?: {
    status: number;
    route?: string;
    summary: ReturnType<typeof compactArdenData>;
    rawData?: unknown;
  };
  warnings: string[];
};

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function inferResponseMode(query: string): ResponseMode {
  const value = query.toLowerCase();
  if (includesAny(value, [/troubleshoot/, /debug/, /bug/, /issue/, /not working/, /fail/, /error/])) {
    return "troubleshooting";
  }
  if (includesAny(value, [/impact/, /change/, /modify/, /regression/, /refactor/, /affect/])) {
    return "change_impact";
  }
  if (includesAny(value, [/developer/, /implementation/, /code/, /trace/, /function/, /api/, /backend/, /frontend/])) {
    return "developer_trace";
  }
  if (includesAny(value, [/overview/, /summary/, /what is/])) return "overview";
  return "workflow";
}

function inferProfile(query: string): CodeSearchProfile | undefined {
  const value = query.toLowerCase();
  if (/payment.?plan|installment|commercial/.test(value)) return "paymentPlan";
  if (/payment|invoice|receipt|transaction|collection/.test(value)) return "paymentsWorkflow";
  if (/booking|reservation/.test(value)) return "booking";
  if (/request|ticket|issue/.test(value)) return "request";
  if (/resident|tenant|occupant/.test(value)) return "resident";
  if (/document|kyc|contract|agreement/.test(value)) return "document";
  if (/room|bed|property|occupancy/.test(value)) return "room";
  if (/auth|login|otp|permission|role/.test(value)) return "auth";
  if (/workflow|status|state|transition/.test(value)) return "workflow";
  if (/frontend|ui|screen|page|admin panel/.test(value)) return "frontend";
  if (/backend|api|server|database/.test(value)) return "backend";
  return undefined;
}

function inferRepos(query: string): CodebaseExplainerRepo[] {
  const value = query.toLowerCase();
  const wantsFrontend = /frontend|ui|screen|page|component|admin panel|button|form/.test(value);
  const wantsBackend = /backend|api|server|database|endpoint|controller|service/.test(value);

  if (wantsFrontend && !wantsBackend) return ["arden-admin"];
  if (wantsBackend && !wantsFrontend) return ["arden-server"];
  return ["arden-server", "arden-admin"];
}

function inferToolPlan(query: string, allowLiveData: boolean) {
  const value = query.toLowerCase();
  const asksForLiveData =
    allowLiveData &&
    includesAny(value, [
      /\bshow\b/,
      /\bfetch\b/,
      /\bget\b/,
      /\blist\b/,
      /\blatest\b/,
      /\brecent\b/,
      /\bcurrent\b/,
      /\btoday\b/,
      /\brecords?\b/,
      /\bdata\b/,
      /details? of/,
      /status of/,
    ]);
  const asksForCode = includesAny(value, [
    /\bhow\b/,
    /\bwhy\b/,
    /flow/,
    /works?/,
    /logic/,
    /implementation/,
    /troubleshoot/,
    /debug/,
    /bug/,
    /issue/,
    /impact/,
    /change/,
    /developer/,
    /code/,
    /frontend/,
    /backend/,
  ]);

  if (asksForLiveData && asksForCode) return "hybrid" as const;
  if (asksForLiveData) return "live_data" as const;
  if (asksForCode) return "code" as const;
  return "semantic" as const;
}

function makeLiveQuery(query: string, maxLiveRecords: number): Record<string, ArdenQueryValue> {
  const value = query.toLowerCase();
  const apiQuery: Record<string, ArdenQueryValue> = {};

  if (/latest|recent|newest|first|list|show|fetch|get/.test(value)) {
    apiQuery.page = 0;
    apiQuery.per_page = maxLiveRecords;
  }

  return apiQuery;
}

function audienceInstruction(audience: SemanticContextAudience) {
  if (audience === "developer") {
    return "The user is a developer. Include technical flow, modules, implementation behavior, and debugging checks. You may mention routes or code evidence only if provided.";
  }
  if (audience === "admin" || audience === "operator") {
    return "The user is an admin/operator. Use operational language, statuses, checks, and safe next actions. Do not expose route paths, file paths, or source snippets.";
  }
  if (audience === "support") {
    return "The user is support. Use customer-friendly language, what to verify, likely causes, and what to tell the customer. Do not expose internal implementation details.";
  }
  return "The user is a business user. Use plain language, workflow outcomes, and practical next steps. Do not expose internal implementation details.";
}

function fallbackAnswer(parts: {
  input: AgenticArdenAnswerInput;
  codeAnswer?: string;
  semanticText: string;
  liveText?: string;
  warnings: string[];
}) {
  return [
    parts.codeAnswer,
    parts.liveText ? `Live data summary:\n${parts.liveText}` : undefined,
    !parts.codeAnswer && parts.semanticText ? `Context:\n${parts.semanticText}` : undefined,
    !parts.codeAnswer && !parts.liveText && !parts.semanticText
      ? `I could not find enough context to answer confidently: ${parts.input.query}`
      : undefined,
    parts.warnings.length ? `Notes:\n${parts.warnings.join("\n")}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

async function synthesizeAnswer(parts: {
  input: AgenticArdenAnswerInput;
  intent: AgenticArdenAnswer["plan"]["intent"];
  responseMode: ResponseMode;
  codeAnswer?: string;
  semanticText: string;
  liveText?: string;
  warnings: string[];
}) {
  if (!OPENAI_API_KEY) return fallbackAnswer(parts);

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
            "You are an agentic Arden assistant. You receive selected evidence from code, semantic context, and live data tools.",
            "Synthesize one concise answer. Do not dump JSON. Do not invent missing facts.",
            audienceInstruction(parts.input.audience),
            `Intent: ${parts.intent}. Response mode: ${parts.responseMode}.`,
            "For live data, explain the records and operational meaning, not the raw response structure.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Question: ${parts.input.query}`,
            parts.codeAnswer ? `Code-grounded explanation:\n${parts.codeAnswer}` : undefined,
            parts.semanticText ? `Semantic context:\n${parts.semanticText}` : undefined,
            parts.liveText ? `Live data compact summary:\n${parts.liveText}` : undefined,
            parts.warnings.length ? `Warnings:\n${parts.warnings.join("\n")}` : undefined,
          ]
            .filter((part): part is string => Boolean(part))
            .join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI agentic answer failed: ${response.status} ${body.slice(0, 1_000)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return json.choices?.[0]?.message?.content?.trim() ?? fallbackAnswer(parts);
}

export async function answerArdenQuery(input: AgenticArdenAnswerInput): Promise<AgenticArdenAnswer> {
  const warnings: string[] = [];
  const responseMode = input.responseMode ?? inferResponseMode(input.query);
  const inferredProfile = input.profile ?? inferProfile(input.query);
  const repos = input.repos ?? inferRepos(input.query);
  const intent = inferToolPlan(input.query, input.allowLiveData);
  const usedTools: string[] = [];
  let codeAnswer: string | undefined;
  let codeEvidenceCount = 0;
  let semanticContextCount = 0;
  let modules: string[] = [];
  let semanticText = "";
  let liveData: AgenticArdenAnswer["liveData"] | undefined;

  if (intent === "code" || intent === "hybrid") {
    usedTools.push("arden-codebase-explain-from-code");
    const codeExplanation = await explainFromQdrantCodeChunks({
      query: input.query,
      audience: input.audience,
      repos,
      topK: 8,
      ...(inferredProfile ? { profile: inferredProfile } : {}),
      ...(input.productArea ? { productArea: input.productArea } : {}),
      responseMode,
      includeEvidence: input.includeDeveloperEvidence && input.audience === "developer",
      includeSemanticContext: true,
    });

    codeAnswer = codeExplanation.answer;
    codeEvidenceCount = codeExplanation.sourceCoverage.codeEvidenceCount;
    semanticContextCount += codeExplanation.sourceCoverage.semanticContextCount;
    modules = codeExplanation.sourceCoverage.modules;
    warnings.push(...codeExplanation.warnings);
  }

  if (intent === "semantic") {
    usedTools.push("arden-semantic-context-search");
    const semanticRows = await searchSemanticContext(input.query, {
      topK: 6,
      audience: input.audience,
      ...(input.productArea ? { productArea: input.productArea } : {}),
    });
    semanticContextCount += semanticRows.length;
    semanticText = semanticRows
      .map((row) => `${row.productArea} - ${row.capability}: ${row.plainSummary}`)
      .join("\n");
  }

  if (intent === "live_data" || intent === "hybrid") {
    usedTools.push("arden-server-resolve-api-endpoint", "arden-server-get-api-data");
    const candidates = resolveArdenRoutes({
      query: input.query,
      method: "GET",
      appScope: input.appScope,
      limit: 3,
    });
    const [route] = candidates;

    if (!route) {
      warnings.push("No matching registered GET endpoint was found for the live-data portion of the request.");
    } else {
      const result = await ardenGet(route.path, {
        query: makeLiveQuery(input.query, input.maxLiveRecords),
      });
      const summary = compactArdenData(result.data, { maxRecords: input.maxLiveRecords });

      liveData = {
        status: result.status,
        ...(input.audience === "developer" ? { route: route.path } : {}),
        summary,
        ...(input.includeRawLiveData && input.audience === "developer" ? { rawData: result.data } : {}),
      };
    }
  }

  const liveText = liveData?.summary.text;
  const answer = await synthesizeAnswer({
    input,
    intent,
    responseMode,
    codeAnswer,
    semanticText,
    liveText,
    warnings,
  });

  if (!OPENAI_API_KEY) warnings.push("OPENAI_API_KEY is not configured, so the final answer used deterministic fallback composition.");

  return {
    query: input.query,
    audience: input.audience,
    answer,
    plan: {
      intent,
      responseMode,
      usedTools,
      reasoning: `Inferred intent '${intent}' from the query and selected ${usedTools.join(", ") || "no tools"}.`,
    },
    coverage: {
      codeEvidenceCount,
      semanticContextCount,
      liveDataFetched: Boolean(liveData),
      ...(liveData?.summary.itemCount !== undefined ? { liveDataRecordCount: liveData.summary.itemCount } : {}),
      modules,
    },
    ...(liveData ? { liveData } : {}),
    warnings,
  };
}
