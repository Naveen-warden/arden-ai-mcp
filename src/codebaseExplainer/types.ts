import type { SemanticContextAudience } from "../semanticContext";
import type { CodeSearchProfile } from "../codeChunks";

export const CODEBASE_EXPLAINER_REPOS = ["arden-server", "arden-admin"] as const;

export type CodebaseExplainerRepo = (typeof CODEBASE_EXPLAINER_REPOS)[number];

export type QdrantCodeEvidence = {
  id: string;
  repo: CodebaseExplainerRepo;
  score: number;
  module: string;
  filePath: string;
  name: string;
  content: string;
};

export type CodebaseExplanationInput = {
  query: string;
  audience: SemanticContextAudience;
  repos: CodebaseExplainerRepo[];
  topK: number;
  profile?: CodeSearchProfile;
  productArea?: string;
  responseMode?:
    | "overview"
    | "workflow"
    | "troubleshooting"
    | "developer_trace"
    | "change_impact";
  includeEvidence: boolean;
  includeSemanticContext: boolean;
};

export type CodebaseExplanation = {
  query: string;
  audience: SemanticContextAudience;
  answer: string;
  sourceCoverage: {
    repos: CodebaseExplainerRepo[];
    codeEvidenceCount: number;
    semanticContextCount: number;
    modules: string[];
  };
  evidence?: Array<{
    repo: CodebaseExplainerRepo;
    filePath: string;
    name: string;
    module: string;
    score: number;
    content: string;
  }>;
  warnings: string[];
};
