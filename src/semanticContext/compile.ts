import { getArdenRouteCatalog } from "../rest";
import { SEMANTIC_CONTEXT_RECORDS } from "./records";
import type { SemanticContextRecord } from "./types";

type DomainConfig = {
  productArea: string;
  keywords: string[];
  concepts: string[];
};

const DOMAIN_CONFIGS: DomainConfig[] = [
  {
    productArea: "Bookings",
    keywords: ["booking", "lead", "move", "contract", "source"],
    concepts: ["booking-first workflow", "stay agreement", "room assignment", "move-in", "contract"],
  },
  {
    productArea: "Payments",
    keywords: [
      "payment",
      "invoice",
      "transaction",
      "settlement",
      "payout",
      "razorpay",
      "cashfree",
      "gateway",
      "ledger",
      "tax",
      "coa",
    ],
    concepts: ["payment", "invoice", "transaction", "settlement", "collection"],
  },
  {
    productArea: "Payment Plans",
    keywords: ["payment", "plan", "installment", "schedule", "due"],
    concepts: ["payment plan", "installment", "due date", "scheduled collection"],
  },
  {
    productArea: "Requests",
    keywords: ["request", "task", "activity", "session", "issue"],
    concepts: ["request", "issue", "assignment", "follow-up", "resolution"],
  },
  {
    productArea: "Residents",
    keywords: ["resident", "user", "profile", "attendance", "gatepass", "old", "client"],
    concepts: ["resident", "profile", "stay", "access", "support context"],
  },
  {
    productArea: "Rooms",
    keywords: ["room", "bed", "occupancy", "property", "amenity", "location"],
    concepts: ["room", "bed", "property", "occupancy", "allocation"],
  },
  {
    productArea: "Communications",
    keywords: ["whatsapp", "email", "notice", "message", "template", "poll", "event"],
    concepts: ["message", "notice", "email", "WhatsApp", "template"],
  },
  {
    productArea: "Documents",
    keywords: ["document", "contract", "file", "template", "sign", "legal"],
    concepts: ["document", "contract", "template", "file", "review"],
  },
  {
    productArea: "Operations",
    keywords: ["kitchen", "meal", "attendance", "task", "automation", "session", "activity"],
    concepts: ["operations", "task", "schedule", "team work", "completion"],
  },
  {
    productArea: "Analytics",
    keywords: ["analytics", "report", "dashboard", "csv", "export", "bank"],
    concepts: ["report", "dashboard", "export", "trend", "exception"],
  },
  {
    productArea: "Authentication",
    keywords: ["login", "logout", "refresh", "permission", "device", "auth"],
    concepts: ["login", "permission", "session", "secure access"],
  },
  {
    productArea: "Settings",
    keywords: ["setting", "company", "brand", "integration", "permission", "module"],
    concepts: ["settings", "company", "integration", "configuration", "access"],
  },
];

const STOP_TOKENS = new Set([
  "admin",
  "app",
  "get",
  "set",
  "put",
  "post",
  "delete",
  "create",
  "update",
  "upsert",
  "make",
  "list",
  "all",
  "for",
  "by",
  "with",
  "from",
  "and",
  "new",
  "old",
  "id",
]);

function tokensFromPath(routePath: string) {
  return routePath
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_TOKENS.has(token))
    .map((token) => (token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token));
}

function getScopeLabel(appScope: string) {
  return appScope
    .split("-")
    .filter((part) => part !== "app")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function chooseDomains(tokens: string[]) {
  const tokenSet = new Set(tokens);

  return DOMAIN_CONFIGS.filter((domain) =>
    domain.keywords.some((keyword) => tokenSet.has(keyword) || tokens.includes(keyword)),
  );
}

function topTokens(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 14)
    .map(([token]) => token);
}

function makeRecordId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

export function getCompiledSemanticContextRecords(): SemanticContextRecord[] {
  const groups = new Map<
    string,
    {
      appScope: string;
      domain: DomainConfig;
      tokens: string[];
      count: number;
    }
  >();

  for (const route of getArdenRouteCatalog()) {
    const routeTokens = tokensFromPath(route.path);
    const domains = chooseDomains(routeTokens);

    for (const domain of domains) {
      const key = `${route.appScope}:${domain.productArea}`;
      const group = groups.get(key) ?? {
        appScope: route.appScope,
        domain,
        tokens: [],
        count: 0,
      };
      group.tokens.push(...routeTokens);
      group.count += 1;
      groups.set(key, group);
    }
  }

  const compiledRecords: SemanticContextRecord[] = [...groups.values()].map((group) => {
    const scopeLabel = getScopeLabel(group.appScope);
    const importantConcepts = [...new Set([...group.domain.concepts, ...topTokens(group.tokens)])].slice(
      0,
      18,
    );
    const productArea = group.domain.productArea;

    return {
      id: `compiled.${makeRecordId(group.appScope)}.${makeRecordId(productArea)}`,
      audiences: ["business_user", "operator", "support", "admin", "developer"],
      productArea,
      capability: `${scopeLabel} ${productArea} capabilities`,
      plainSummary: `Arden has ${group.count} ${scopeLabel.toLowerCase()} capabilities related to ${productArea.toLowerCase()}. This area connects business workflows, live data, and operational follow-up around ${importantConcepts.slice(0, 5).join(", ")}.`,
      workflowSteps: [
        `Identify the ${productArea.toLowerCase()} question and the company or workspace context.`,
        `Use approved live-data tools only when the user asks about current Arden data.`,
        `Combine related concepts such as ${importantConcepts.slice(0, 5).join(", ")} before explaining the result.`,
        ...(productArea === "Bookings"
          ? [
              "For admin explanations, keep the flow booking-first; older lead or resident module concepts should be treated as supporting context, not the main starting point.",
            ]
          : []),
        "Explain the answer in the user's role: simple summary for business users, operational next steps for operators, and technical detail only for authorized developers.",
      ],
      commonQuestions: [
        `What does ${productArea.toLowerCase()} mean in Arden?`,
        `How should I understand ${productArea.toLowerCase()} status?`,
        `What should the team do next for a ${productArea.toLowerCase()} issue?`,
      ],
      relatedConcepts: importantConcepts,
      dataUse:
        "This record is derived from the private codebase structure but stores only safe product concepts. Use live read tools for current data and private developer tools for implementation details when authorized.",
      responseGuidance:
        productArea === "Bookings"
          ? "Do not expose source code, file paths, route paths, or snippets. For booking questions, explain the current workflow as booking-first rather than lead/resident-module-first."
          : "Do not expose source code, file paths, route paths, or snippets. For non-technical users, translate this area into product meaning and next steps.",
      internalPointerId: `compiled.${group.appScope}.${makeRecordId(productArea)}`,
    };
  });

  const deduped = new Map<string, SemanticContextRecord>();

  for (const record of [...SEMANTIC_CONTEXT_RECORDS, ...compiledRecords]) {
    deduped.set(record.id, record);
  }

  return [...deduped.values()];
}
