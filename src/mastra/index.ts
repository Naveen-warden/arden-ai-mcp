import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import { ardenAdminCodebaseAgent } from "./agents/arden-admin/codebase-agent";
import { ardenServerCodebaseAgent } from "./agents/arden-server/codebase-agent";
import { ardenCodebaseMcpServer } from "./mcp/arden-codebase-server";
import {
  getApiDataTool,
  resolveApiEndpointTool,
  resolveApiFiltersTool,
} from "./tools/arden-server/server-tools";
import { fetchLiveDataWorkflowTool } from "./tools/arden-server/workflow-tools";
import { ardenAgenticAnswerTool } from "./tools/arden-agentic-answer-tool";
import { qdrantCodebaseExplainerTool } from "./tools/codebase-explainer-tool";
import { semanticContextSearchTool } from "./tools/semantic-context-tool";
import { liveDataFetchWorkflow } from "./workflows/live-data-fetch-workflow";

export const mastra = new Mastra({
  agents: { ardenServerCodebaseAgent, ardenAdminCodebaseAgent },

  mcpServers: { ardenCodebaseMcpServer },
  tools: {
    ardenAgenticAnswerTool,
    qdrantCodebaseExplainerTool,
    semanticContextSearchTool,
    resolveApiEndpointTool,
    resolveApiFiltersTool,
    getApiDataTool,
    fetchLiveDataWorkflowTool,
  },
  workflows: { liveDataFetchWorkflow },
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
