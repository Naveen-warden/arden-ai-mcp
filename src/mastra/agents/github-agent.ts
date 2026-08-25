import { Agent } from "@mastra/core/agent";
import { githubMcp } from "../mcp/github-mcp-client";
import { ARDEN_AI_MODEL } from "../../environment";

const githubTools = await githubMcp.listTools();

export const gethubAgent = new Agent({
  id: "github-agent",
  name: "GitHub Agent",
  model: ARDEN_AI_MODEL,
  tools: githubTools,
  instructions: `
    You are a code assistant.
    Use the GitHub tools when you need current repository information.
  `,
});
