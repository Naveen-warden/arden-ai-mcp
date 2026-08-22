import { Agent } from "@mastra/core/agent";

import { OPENAI_MODEL } from "../environment";

export const ARDEN_LLM_MODEL = OPENAI_MODEL;

export const ardenLlmAgent = new Agent({
  id: "arden-llm-agent",
  name: "Arden LLM Agent",
  model: ARDEN_LLM_MODEL,
  instructions: `You are a private internal Arden reasoning helper.

Follow the task-specific instructions passed at generation time.
Use only the provided evidence and context.
Do not invent facts, code behavior, endpoint paths, filters, enum values, or live data.
When asked for structured output, return data that strictly matches the requested schema.`,
});
