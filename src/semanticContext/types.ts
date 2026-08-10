export const SEMANTIC_CONTEXT_AUDIENCES = [
  "business_user",
  "operator",
  "support",
  "admin",
  "developer",
] as const;

export type SemanticContextAudience =
  (typeof SEMANTIC_CONTEXT_AUDIENCES)[number];

export type SemanticContextRecord = {
  id: string;
  audiences: SemanticContextAudience[];
  productArea: string;
  capability: string;
  plainSummary: string;
  workflowSteps: string[];
  commonQuestions: string[];
  relatedConcepts: string[];
  dataUse: string;
  responseGuidance: string;
  internalPointerId: string;
};

export type SemanticContextSearchOptions = {
  topK: number;
  audience?: SemanticContextAudience;
  productArea?: string;
};

export type SemanticContextSearchResult = SemanticContextRecord & {
  score: number;
};
