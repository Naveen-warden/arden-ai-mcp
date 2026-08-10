import { AsyncLocalStorage } from "node:async_hooks";

export type ArdenSession = {
  accessToken: string;
  refreshToken?: string;
  permissionId?: string;
  expiresAt?: number;
  connectedAt: number;
  updatedAt?: number;
  user?: unknown;
  permissions?: unknown[];
};

const ardenSessionStorage = new AsyncLocalStorage<ArdenSession>();

export function runWithArdenSession<T>(
  ardenSession: ArdenSession,
  callback: () => T,
) {
  return ardenSessionStorage.run(ardenSession, callback);
}

export function getCurrentArdenSession() {
  return ardenSessionStorage.getStore();
}
