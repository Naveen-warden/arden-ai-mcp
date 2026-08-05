import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { countCollections } from "../../database";

export const getDatabaseDataTool = createTool({
  id: "get-database-data",
  description: "Get the total number of collections in the database",
  outputSchema: z.object({
    count: z.number(),
    collections: z.array(z.string()),
  }),
  execute: async () => {
    const { count, collections } = await countCollections();
    return { count, collections };
  },
});
