import { MCPServer } from "@mastra/mcp";

import { getArdenRouteManifest } from "../../rest";
import { ardenAdminCodeSearchTool } from "../tools/arden-admin/code-search-tool";
import { ardenServerCodeSearchTool } from "../tools/arden-server/code-search-tool";
import {
  getApiDataTool,
  resolveApiEndpointTool,
} from "../tools/arden-server/server-tools";

const ROUTE_MANIFEST_URI = "arden://knowledge/route-manifest";
const USAGE_GUIDE_URI = "arden://knowledge/usage-guide";

export const ardenCodebaseMcpServer = new MCPServer({
  id: "arden-codebase",
  name: "Arden Codebase",
  version: "1.0.0",
  description:
    "Safe code search, exact endpoint resolution, and read-only live data access for arden-server and arden-admin.",
  instructions: `Use repository-specific code search for implementation questions.

For live arden-server data, always call arden-server-resolve-api-endpoint first. Use code search when candidate semantics or supported filters are unclear, then call arden-server-get-api-data with an exact resolved path.

  Never invent endpoint paths. Words such as latest or recent usually represent sorting and pagination rather than part of a route name. This server exposes read-only live API access; it does not provide POST, PUT, PATCH, or DELETE operations.`,
  tools: {
    "arden-server-code-search": ardenServerCodeSearchTool,
    "arden-admin-code-search": ardenAdminCodeSearchTool,
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

## Code questions

- Use \`arden-server-code-search\` for backend implementation and business logic.
- Use \`arden-admin-code-search\` for frontend components, hooks, and API usage.

## Live backend data

1. Call \`arden-server-resolve-api-endpoint\` to obtain registered GET routes.
2. Use backend code search if candidate behavior or query filters are unclear.
3. Call \`arden-server-get-api-data\` with an exact resolved path.

Do not invent routes. Treat words such as latest and recent as sorting or pagination unless an exact specialized route is confirmed.

Route knowledge was generated from arden-server commit \`${manifest.sourceCommit}\` at \`${manifest.generatedAt}\` and contains ${manifest.routes.length} routes.
`,
        };
      }

      throw new Error(`Unknown Arden MCP resource: ${uri}`);
    },
  },
});
