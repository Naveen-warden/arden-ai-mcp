import { ARDEN_API_URL } from "../environment";
import type { ArdenSession } from "./arden-session-context";

export type ArdenLoginMethod = "GOOGLE" | "MSG91";

type ArdenPhoneLoginInput = {
  token: string;
  method?: ArdenLoginMethod;
};

type ArdenPhoneLoginResult = {
  session: ArdenSession;
  loginData: unknown;
};

function getApiBaseUrl() {
  return ARDEN_API_URL.replace(/\/$/, "");
}

function makeArdenUrl(path: string) {
  return new URL(`${getApiBaseUrl()}${path}`);
}

function parseResponseBody(text: string, contentType: string | null): unknown {
  if (!text) return null;
  if (contentType?.includes("application/json")) return JSON.parse(text);

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readResponse(response: Response) {
  return parseResponseBody(
    await response.text(),
    response.headers.get("content-type"),
  );
}

function getJwtExpiresAt(token: string) {
  const [, payload] = token.split(".");

  if (!payload) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      exp?: unknown;
    };

    return typeof decoded.exp === "number" ? decoded.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = withGetSetCookie.getSetCookie?.();

  if (setCookies?.length) return setCookies;

  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function extractRefreshToken(headers: Headers) {
  for (const cookie of getSetCookieHeaders(headers)) {
    const match = cookie.match(/(?:^|[,;]\s*)refresh_token=([^;,]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return undefined;
}

function getObjectProperty<T>(value: unknown, key: string): T | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, T>)[key];
}

function getUserId(loginData: unknown) {
  const user = getObjectProperty<Record<string, unknown>>(loginData, "user");
  const id = user?.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : undefined;
}

export async function refreshArdenAccessToken(session: ArdenSession) {
  if (!session.refreshToken) {
    throw new Error("Arden refresh token is missing; reconnect Arden access");
  }

  const response = await fetch(makeArdenUrl("/admin-app/refresh"), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: `refresh_token=${encodeURIComponent(session.refreshToken)}`,
      "ngrok-skip-browser-warning": "true",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      `Arden refresh failed with ${response.status} ${response.statusText}: ${JSON.stringify(data).slice(0, 2_000)}`,
    );
  }

  const accessToken = getObjectProperty<string>(data, "accessToken");

  if (!accessToken) {
    throw new Error("Arden refresh response did not include accessToken");
  }

  session.accessToken = accessToken;
  session.expiresAt = getJwtExpiresAt(accessToken);
  session.updatedAt = Date.now();

  return accessToken;
}

export async function exchangeArdenPhoneLogin({
  token,
  method,
}: ArdenPhoneLoginInput): Promise<ArdenPhoneLoginResult> {
  const response = await fetch(makeArdenUrl("/admin-app/phone-login"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ type: "PHONE", token, ...(method ? { method } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  const loginData = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      `Arden phone login failed with ${response.status} ${response.statusText}: ${JSON.stringify(loginData).slice(0, 2_000)}`,
    );
  }

  const refreshToken = extractRefreshToken(response.headers);

  if (!refreshToken) {
    throw new Error("Arden phone login did not return refresh_token cookie");
  }

  const session: ArdenSession = {
    accessToken: "",
    refreshToken,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
    user: getObjectProperty(loginData, "user"),
    permissions: getObjectProperty<unknown[]>(loginData, "permissions") ?? [],
  };

  await refreshArdenAccessToken(session);

  return {
    session: {
      ...session,
      user: session.user ?? (getUserId(loginData) ? { id: getUserId(loginData) } : undefined),
    },
    loginData,
  };
}
