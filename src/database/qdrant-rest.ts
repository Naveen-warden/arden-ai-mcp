import dns from "node:dns";
import { Resolver } from "node:dns/promises";
import { Agent } from "undici";

import { QDRANT_API_KEY, QDRANT_URL } from "../environment";

const dispatcher = createDispatcher();

function createDispatcher() {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);

  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        resolver
          .resolve4(hostname)
          .then((addresses) => {
            const [address] = addresses;
            if (!address) throw new Error(`No IPv4 records for ${hostname}`);

            if (options?.all) {
              callback(null, [{ address, family: 4 }]);
            } else {
              callback(null, address, 4);
            }
          })
          .catch(() => dns.lookup(hostname, options, callback));
      },
    },
  });
}

function getBaseUrl() {
  return (QDRANT_URL ?? "http://localhost:6333").replace(/\/$/, "");
}

export async function qdrantRestRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    dispatcher,
  } as RequestInit & { dispatcher: Agent });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Qdrant ${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`,
    );
  }

  return (text ? JSON.parse(text) : null) as T;
}

export async function qdrantRestCollectionExists(collection: string) {
  const response = await fetch(
    `${getBaseUrl()}/collections/${encodeURIComponent(collection)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {}),
      },
      dispatcher,
    } as RequestInit & { dispatcher: Agent },
  );

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `Qdrant collection check failed with ${response.status}: ${(await response.text()).slice(0, 1_000)}`,
    );
  }

  return true;
}
