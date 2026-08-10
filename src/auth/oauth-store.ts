import type { ArdenSession } from "./arden-session-context";

export type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: string;
};

export type PendingAuthorizationRequest = {
  requestId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  expiresAt: number;
  ardenSession?: ArdenSession;
};

export type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  expiresAt: number;
  ardenSession: ArdenSession;
};

export type AccessToken = {
  clientId: string;
  scope: string;
  expiresAt: number;
  ardenSession: ArdenSession;
};

export type OAuthStore = {
  clients: Map<string, OAuthClient>;
  pendingAuthorizationRequests: Map<string, PendingAuthorizationRequest>;
  authorizationCodes: Map<string, AuthorizationCode>;
  accessTokens: Map<string, AccessToken>;
};

export const oauthStore: OAuthStore = {
  clients: new Map(),
  pendingAuthorizationRequests: new Map(),
  authorizationCodes: new Map(),
  accessTokens: new Map(),
};
