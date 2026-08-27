import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { workflowInputSchema, workflowOutputSchema } from "../../workflows/live-data-fetch-workflow";

export const fetchLiveDataWorkflowTool = createTool({
  id: "fetch-live-data",
  description:
    "Fetch live Arden server data from natural language. Resolves endpoint, resolves filters using current GitHub/Qdrant evidence, then calls the GET API. Use for queries like 'fetch reserved bookings' or 'fetch latest payments'.",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  execute: async (input, context) => {
    const mastra = context.mastra;
    if (!mastra) throw new Error("Mastra instance not available in context");

    const workflow = mastra.getWorkflow("live-data-fetch-workflow");
    if (!workflow) throw new Error("Workflow 'live-data-fetch-workflow' not registered");

    const run = await workflow.createRun();
    const result = await run.start({ inputData: input });

    if (result.status === "failed") {
      throw new Error(`Workflow failed: ${result.error?.message || "Unknown error"}`);
    }
    if (result.status !== "success") {
      throw new Error(`Workflow completed with status: ${result.status}`);
    }
    return result.result;
  },
});
