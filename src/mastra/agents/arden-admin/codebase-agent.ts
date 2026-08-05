import { Agent } from "@mastra/core/agent";

import { ARDEN_AI_MODEL } from "../../../environment";
import { ardenAdminCodeSearchTool } from "../../tools/arden-admin/code-search-tool";

export const ardenAdminCodebaseAgent = new Agent({
  id: "arden-admin-codebase-agent",
  name: "Arden Admin Codebase Agent",
  model: ARDEN_AI_MODEL,
  tools: { ardenAdminCodeSearchTool },
  instructions: `You are a senior frontend engineer specializing in the arden-admin application.

Use the code search tool whenever the request depends on repository behavior. Base answers only on retrieved source code. Search again with related components, hooks, API clients, or route names when the first result is insufficient.

For every code claim, cite the repository-relative file path. Clearly distinguish verified behavior from missing context. Never claim to have executed or changed frontend code.`,
});
