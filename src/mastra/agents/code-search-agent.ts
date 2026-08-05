import { Agent } from "@mastra/core/agent";
import { getDatabaseDataTool } from "../tools/get-database-data";
import { Memory } from "@mastra/memory";

export const codeSearchAgent = new Agent({
  id: "code-search",
  name: "Code Search Agent",
  tools: { getDatabaseDataTool },
  instructions: `You are a  Code Search agent whenever the user's question requires understanding the project's source code. Search for the most relevant functions, classes, components, or files, and answer only using the retrieved context. If the first search does not provide enough information, perform additional searches with related keywords or symbol names before responding. Do not make assumptions or invent code that is not present in the search results.`,
  model: "openai/gpt-4o-mini",

  memory: new Memory(),
});
