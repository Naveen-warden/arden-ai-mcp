import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import { ardenAdminCodebaseAgent } from "./agents/arden-admin/codebase-agent";
import { ardenServerCodebaseAgent } from "./agents/arden-server/codebase-agent";
import { ardenCodebaseMcpServer } from "./mcp/arden-codebase-server";
import { ardenAdminCodeSearchTool } from "./tools/arden-admin/code-search-tool";
import { ardenServerCodeSearchTool } from "./tools/arden-server/code-search-tool";
import {
  getApiDataTool,
  resolveApiEndpointTool,
} from "./tools/arden-server/server-tools";

export const mastra = new Mastra({
  agents: { ardenServerCodebaseAgent, ardenAdminCodebaseAgent },
  mcpServers: { ardenCodebaseMcpServer },
  tools: {
    ardenServerCodeSearchTool,
    ardenAdminCodeSearchTool,
    resolveApiEndpointTool,
    getApiDataTool,
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore("observability"),
    },
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});
