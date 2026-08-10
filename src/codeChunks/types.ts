export const CODE_SEARCH_PROFILES = [
  "comms",
  "paymentPlan",
  "paymentsWorkflow",
  "customScript",
  "booking",
  "request",
  "resident",
  "document",
  "room",
  "auth",
  "workflow",
  "frontend",
  "backend",
] as const;

export type CodeSearchProfile = (typeof CODE_SEARCH_PROFILES)[number];
export type CodeRepository = "arden-server" | "arden-admin";

export type CodeSearchOptions = {
  topK: number;
  profile?: CodeSearchProfile;
  repos?: CodeRepository[];
};

export type CodeSearchResult = {
  id: string;
  score: number;
  repo: string;
  kind: string;
  module: string;
  filePath: string;
  name: string;
  content: string;
  profiles: string[];
};
