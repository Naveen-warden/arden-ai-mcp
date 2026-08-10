import { MCPServer } from "@mastra/mcp";

import { getArdenRouteManifest } from "../../rest";
import {
  getApiDataTool,
  resolveApiEndpointTool,
} from "../tools/arden-server/server-tools";
import { ardenAgenticAnswerTool } from "../tools/arden-agentic-answer-tool";
import { qdrantCodebaseExplainerTool } from "../tools/codebase-explainer-tool";
import { semanticContextSearchTool } from "../tools/semantic-context-tool";

const ROUTE_MANIFEST_URI = "arden://knowledge/route-manifest";
const USAGE_GUIDE_URI = "arden://knowledge/usage-guide";

export const ardenCodebaseMcpServer = new MCPServer({
  id: "arden-codebase",
  name: "Arden Codebase",
  version: "1.0.0",
  description:
    "Agentic Arden answers, safe semantic context, controlled Qdrant code-chunk explanations, exact endpoint resolution, and read-only live data access.",
  instructions: `Tool selection rules:

- Prefer arden-answer for normal user questions. It decides whether to use semantic context, Qdrant code chunks, live Arden GET data, or a hybrid path and returns a concise role-aware answer.

- Use arden-codebase-explain-from-code first when the user asks how a feature works, why behavior happens, how frontend/backend flow connects, troubleshooting, change impact, or any deeper explanation that needs implementation flow.
- Use responseMode=workflow for normal explanations, responseMode=troubleshooting for bug/support questions, responseMode=developer_trace for developer implementation questions, responseMode=change_impact for modification/regression questions, and responseMode=overview for short product summaries.
- Use profile filters when the domain is clear: booking, paymentPlan, paymentsWorkflow, request, resident, document, room, auth, workflow, frontend, backend.
- Raw code evidence must only be requested for audience=developer and only when the user asks for evidence or implementation details.

Use arden-semantic-context-search for safe product, workflow, and role-aware explanation context. It intentionally does not expose source code, file paths, snippets, routes, or secrets.

For live arden-server data, always call arden-server-resolve-api-endpoint first, then call arden-server-get-api-data with an exact resolved path.

Answer style must match the user's role. For business users, use plain language and next steps. For operators/admins, include operational status and safe actions. For developers, technical details may be provided from controlled Qdrant code-chunk evidence when authorized.

Never invent endpoint paths. Words such as latest or recent usually represent sorting and pagination rather than part of a route name. This server exposes read-only live API access; it does not provide POST, PUT, PATCH, or DELETE operations.`,
  tools: {
    "arden-answer": ardenAgenticAnswerTool,
    "arden-codebase-explain-from-code": qdrantCodebaseExplainerTool,
    "arden-semantic-context-search": semanticContextSearchTool,
    "arden-server-resolve-api-endpoint": resolveApiEndpointTool,
    "arden-server-get-api-data": getApiDataTool,
  },
  resources: {
    listResources: async () => [
      {
        uri: ROUTE_MANIFEST_URI,
        name: "Arden Server Route Manifest",
        description:
          "Versioned exact API routes generated from arden-server source code.",
        mimeType: "application/json",
      },
      {
        uri: USAGE_GUIDE_URI,
        name: "Arden Tool Usage Guide",
        description:
          "Required tool sequence and safety rules for Arden code and live-data requests.",
        mimeType: "text/markdown",
      },
    ],
    getResourceContent: async ({ uri }) => {
      const manifest = getArdenRouteManifest();

      if (uri === ROUTE_MANIFEST_URI) {
        return { text: JSON.stringify(manifest, null, 2) };
      }

      if (uri === USAGE_GUIDE_URI) {
        return {
          text: `# Arden MCP Usage

## Context questions

- Use \`arden-answer\` first for normal user questions. It routes between semantic context, code chunks, and live data automatically.
- Use \`arden-semantic-context-search\` for safe product, workflow, and role-aware explanation context.
- Use \`arden-codebase-explain-from-code\` when the user asks for a deeper explanation grounded in implementation flow. Choose \`responseMode\` based on intent: \`workflow\`, \`troubleshooting\`, \`developer_trace\`, \`change_impact\`, or \`overview\`.
- Do not expose file paths, source snippets, route paths, or low-level implementation details to non-technical users.
- Qdrant Cloud may contain indexed source-code chunks in the code collection. Treat those chunks as private evidence and expose raw snippets only to developer audience when explicitly requested.

## Live backend data

1. Call \`arden-server-resolve-api-endpoint\` to obtain registered GET routes.
2. Call \`arden-server-get-api-data\` with an exact resolved path.
3. Explain the live data using the user's role and audience.

Do not invent routes. Treat words such as latest and recent as sorting or pagination unless an exact specialized route is confirmed.

Route knowledge was generated from arden-server commit \`${manifest.sourceCommit}\` at \`${manifest.generatedAt}\` and contains ${manifest.routes.length} routes.
`,
        };
      }

      throw new Error(`Unknown Arden MCP resource: ${uri}`);
    },
  },
});
