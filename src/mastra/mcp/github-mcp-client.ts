import { MCPClient } from "@mastra/mcp";

export const githubMcp = new MCPClient({
  id: "github-code-fetcher",

  servers: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
      },
      timeout: 30_000,
    },
  },
});

