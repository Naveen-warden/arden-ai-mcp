import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ARDEN_APP_PREFIXES = {
  "admin-app": "/admin-app",
  "booking-app": "/booking-app",
  "resident-app": "/resident-app",
  "super-admin": "/super-app",
  "external-app": "/external-app",
  "public-app": "/public-app",
} as const;

export type ArdenAppScope = keyof typeof ARDEN_APP_PREFIXES;

export type ArdenRoute = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  appScope: ArdenAppScope;
  access: string;
  sourceFile: string;
  sourceLine: number;
};

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );

  return files.flat();
}

function removeComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    )
    .replace(/^[^\S\r\n]*\/\/.*$/gm, (comment) => " ".repeat(comment.length));
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function extractRoutes(
  source: string,
  sourceFile: string,
  appScope: ArdenAppScope,
  access: string,
) {
  const routes: ArdenRoute[] = [];
  const uncommented = removeComments(source);
  const routePattern =
    /\brouter\s*\.\s*(get|post|put|delete|patch)\s*\(\s*([`'"])(\/[^`'"]*)\2/g;

  for (const match of uncommented.matchAll(routePattern)) {
    const method = match[1]?.toUpperCase() as ArdenRoute["method"];
    const routePath = match[3];
    if (!routePath || routePath.includes("${")) continue;

    routes.push({
      method,
      path: `${ARDEN_APP_PREFIXES[appScope]}${routePath}`,
      appScope,
      access,
      sourceFile,
      sourceLine: lineNumberAt(uncommented, match.index),
    });
  }

  return routes;
}

export async function scanArdenRoutes(ardenServerPath: string) {
  const routesDirectory = path.join(ardenServerPath, "src/routes");
  let files: string[];

  try {
    files = await listTypeScriptFiles(routesDirectory);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read arden-server routes at ${routesDirectory}. Set ARDEN_SERVER_PATH to the repository root. ${detail}`,
    );
  }

  const routes = await Promise.all(
    files.map(async (filePath) => {
      const relativePath = path.relative(routesDirectory, filePath);
      const [scopeDirectory, accessDirectory = "root"] = relativePath.split(
        path.sep,
      );
      if (!(scopeDirectory in ARDEN_APP_PREFIXES)) return [];

      const source = await readFile(filePath, "utf8");
      return extractRoutes(
        source,
        path.posix.join("src/routes", relativePath.replaceAll(path.sep, "/")),
        scopeDirectory as ArdenAppScope,
        accessDirectory.replace(/\.ts$/, ""),
      );
    }),
  );

  return routes
    .flat()
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.method.localeCompare(right.method) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.sourceLine - right.sourceLine,
    );
}
