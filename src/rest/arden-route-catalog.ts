import generatedManifest from "../generated/arden-server-routes.json";
import type {
  ArdenAppScope,
  ArdenRoute,
} from "./arden-route-scanner";

type ArdenRouteManifest = {
  version: 1;
  generatedAt: string;
  sourceCommit: string;
  routes: ArdenRoute[];
};

const manifest = generatedManifest as ArdenRouteManifest;

export function getArdenRouteManifest() {
  return manifest;
}

export function getArdenRouteCatalog() {
  return manifest.routes;
}

function normalizedTokens(value: string) {
  const intentWords = new Set([
    "the",
    "my",
    "get",
    "fetch",
    "find",
    "show",
    "list",
    "latest",
    "recent",
    "newest",
    "oldest",
    "first",
    "last",
  ]);

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !intentWords.has(token))
    .map((token) =>
      token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token,
    );
}

function routeScore(route: ArdenRoute, query: string) {
  const queryTokens = normalizedTokens(query);
  const routeTokens = new Set(normalizedTokens(route.path));
  const matches = queryTokens.filter((token) => routeTokens.has(token)).length;
  const compactQuery = queryTokens.join("-");

  return (
    matches * 10 +
    (compactQuery && route.path.toLowerCase().includes(compactQuery) ? 5 : 0) -
    route.path.split("/").at(-1)!.length / 100
  );
}

export function resolveArdenRoutes(options: {
  query: string;
  method?: ArdenRoute["method"];
  appScope?: ArdenAppScope;
  limit?: number;
}) {
  const method = options.method ?? "GET";
  const limit = options.limit ?? 10;

  return getArdenRouteCatalog()
    .filter(
      (route) =>
        route.method === method &&
        (!options.appScope || route.appScope === options.appScope),
    )
    .map((route) => ({ route, score: routeScore(route, options.query) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.route.path.localeCompare(right.route.path),
    )
    .slice(0, limit)
    .map(({ route }) => route);
}

export function assertKnownArdenGetRoute(routePath: string) {
  const match = getArdenRouteCatalog().find(
    (route) => route.method === "GET" && route.path === routePath,
  );
  if (match) return match;

  const suggestions = resolveArdenRoutes({
    query: routePath,
    method: "GET",
    limit: 5,
  });
  const suggestionText = suggestions.length
    ? ` Closest registered GET routes: ${suggestions.map((route) => route.path).join(", ")}.`
    : "";

  throw new Error(
    `${routePath} is not a registered arden-server GET route.${suggestionText} Use arden-server-resolve-api-endpoint before fetching data.`,
  );
}

export type { ArdenAppScope, ArdenRoute } from "./arden-route-scanner";
