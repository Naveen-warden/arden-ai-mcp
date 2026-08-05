import "dotenv/config";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { scanArdenRoutes } from "../src/rest/arden-route-scanner";

const execFileAsync = promisify(execFile);

function discoverArdenServerPath() {
  if (process.env.ARDEN_SERVER_PATH) {
    return path.resolve(process.env.ARDEN_SERVER_PATH);
  }

  let directory = process.cwd();
  while (true) {
    const candidates = [directory, path.join(directory, "arden-server")];
    const match = candidates.find((candidate) =>
      existsSync(path.join(candidate, "src/routes")),
    );
    if (match) return match;

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    "Unable to discover arden-server. Set ARDEN_SERVER_PATH to its repository root.",
  );
}

async function getSourceCommit(repositoryPath: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryPath, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    );
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  const repositoryPath = discoverArdenServerPath();
  const routes = await scanArdenRoutes(repositoryPath);
  const outputPath = path.resolve(
    process.cwd(),
    "src/generated/arden-server-routes.json",
  );
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit: await getSourceCommit(repositoryPath),
    routes,
  } as const;

  if (process.argv.includes("--check")) {
    const current = JSON.parse(await readFile(outputPath, "utf8")) as {
      sourceCommit?: string;
      routes?: unknown[];
    };
    const isCurrent =
      current.sourceCommit === manifest.sourceCommit &&
      JSON.stringify(current.routes) === JSON.stringify(manifest.routes);

    if (!isCurrent) {
      throw new Error(
        "Arden route manifest is stale. Run npm run routes:generate and commit the result.",
      );
    }

    process.stdout.write(
      `Arden route manifest is current for commit ${manifest.sourceCommit} (${routes.length} routes)\n`,
    );
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Generated ${routes.length} Arden routes from commit ${manifest.sourceCommit} at ${outputPath}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
