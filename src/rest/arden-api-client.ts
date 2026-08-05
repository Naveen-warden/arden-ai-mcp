import {
  ARDEN_ACCESS_TOKEN,
  ARDEN_API_URL,
  ARDEN_PERMISSION_ID,
} from "../environment";

export type ArdenQueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>;

type ArdenGetOptions = {
  query?: Record<string, ArdenQueryValue>;
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

export async function ardenGet(path: string, options: ArdenGetOptions = {}) {
  if (!ARDEN_ACCESS_TOKEN) {
    throw new Error("Missing ARDEN_ACCESS_TOKEN in the Mastra environment");
  }

  const url = makeUrl(path, options.query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ARDEN_ACCESS_TOKEN}`,
    Accept: "application/json",
    "ngrok-skip-browser-warning": "true",
  };

  if (ARDEN_PERMISSION_ID) {
    headers["Permission-Id"] = ARDEN_PERMISSION_ID;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const data = parseResponseBody(text, response.headers.get("content-type"));

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
