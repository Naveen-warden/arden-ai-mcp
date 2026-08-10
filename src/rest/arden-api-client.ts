import {
  ARDEN_ACCESS_TOKEN,
  ARDEN_API_URL,
  ARDEN_PERMISSION_ID,
} from "../environment";
import {
  getCurrentArdenSession,
  type ArdenSession,
} from "../auth/arden-session-context";
import { refreshArdenAccessToken } from "../auth/arden-login-exchange";

export type ArdenQueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>;

type ArdenGetOptions = {
  query?: Record<string, ArdenQueryValue>;
};

type ArdenAuth = {
  accessToken: string;
  permissionId?: string;
};

function getApiBaseUrl() {
  return ARDEN_API_URL.replace(/\/$/, "");
}

function makeUrl(path: string, query: ArdenGetOptions["query"]) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new Error(
      "Arden API path must be a relative path beginning with one slash and must not contain a query string or fragment",
    );
  }

  const baseUrl = new URL(getApiBaseUrl());
  const url = new URL(`${getApiBaseUrl()}${path}`);
  const basePath = baseUrl.pathname.replace(/\/$/, "");

  if (
    url.origin !== baseUrl.origin ||
    (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
  ) {
    throw new Error("Arden API path must stay within ARDEN_API_URL");
  }

  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
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

async function getArdenAuth(): Promise<ArdenAuth> {
  const session = getCurrentArdenSession();

  if (session) {
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      await refreshArdenAccessToken(session);
    }

    return {
      accessToken: session.accessToken,
      permissionId: session.permissionId,
    };
  }

  if (!ARDEN_ACCESS_TOKEN) {
    throw new Error(
      "No Arden session is connected and ARDEN_ACCESS_TOKEN is missing in the Mastra environment",
    );
  }

  return {
    accessToken: ARDEN_ACCESS_TOKEN,
    permissionId: ARDEN_PERMISSION_ID,
  };
}

function makeArdenHeaders(auth: ArdenAuth) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "ngrok-skip-browser-warning": "true",
  };

  if (auth.permissionId) {
    headers["Permission-Id"] = auth.permissionId;
  }

  return headers;
}

async function readArdenResponse(response: Response) {
  const text = await response.text();
  return parseResponseBody(text, response.headers.get("content-type"));
}

export async function validateArdenSession(session: ArdenSession) {
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    await refreshArdenAccessToken(session);
  }

  const url = makeUrl("/admin-app/auto-login", undefined);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...makeArdenHeaders(session),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "AUTO" }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readArdenResponse(response);

  if (!response.ok) {
    const detail = JSON.stringify(data);
    throw new Error(
      `Arden token validation failed with ${response.status} ${response.statusText}: ${detail.slice(0, 2_000)}`,
    );
  }

  return {
    status: response.status,
    url: url.toString(),
    data,
  };
}

export async function ardenGet(path: string, options: ArdenGetOptions = {}) {
  const auth = await getArdenAuth();
  const url = makeUrl(path, options.query);

  const response = await fetch(url, {
    method: "GET",
    headers: makeArdenHeaders(auth),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readArdenResponse(response);

  if (!response.ok) {
    const detail = JSON.stringify(data);
    throw new Error(
      `Arden API GET ${path} failed with ${response.status} ${response.statusText}: ${detail.slice(0, 2_000)}`,
    );
  }

  return {
    status: response.status,
    url: url.toString(),
    data,
  };
}
