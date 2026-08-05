import { ardenCodebaseMcpServer } from "../src/mastra/mcp/arden-codebase-server";

ardenCodebaseMcpServer.startStdio().catch((error) => {
  console.error("Failed to start Arden MCP server", error);
  process.exitCode = 1;
});
